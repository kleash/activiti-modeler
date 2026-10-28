import { type ConnectorMeta, normalizeConnectorFiles, writeConnectorMeta } from './connectors';
import { type ExtensionsFile, parseExtensions, serializeExtensionsReport } from './extensions';
import { unknownFieldWarning } from './runtime-model';
import { assertBpmnExportable } from './verify';

/** A file of a modeler project, addressed by its project-relative path. */
export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProcessFileInput {
  /** Base name of the files, e.g. `loan` for `processes/loan.bpmn20.xml` and `processes/loan-extensions.json`. */
  name: string;
  xml: string;
  /**
   * The extensions of the process. Left out, no `-extensions.json` is written: the engine then has no entry for the process, which
   * differs from an empty entry (a called process without an entry drops the inputs a call activity maps to it, engine finding C11.2).
   */
  extensions?: ExtensionsFile | string;
}

export interface DmnFileInput {
  /** Base name, e.g. `risk` for `processes/risk.dmn`. */
  name: string;
  content: string;
}

export interface ProjectInput {
  name: string;
  version?: string;
  processes: ProcessFileInput[];
  /** Passed through unchanged (normalisation is the DMN editor's job). */
  dmn?: DmnFileInput[];
  /**
   * `connectors/<name>.json` descriptors. They are written with only the fields the Activiti runtime reads (ADR 0003): anything else
   * in them (template `version`, `config`, ...) moves to `project.json`, `connectors.<name>`, and is reported in the warnings.
   */
  connectors?: DmnFileInput[];
  /** Modeler metadata of the connectors by name (`project.json`, `connectors.<name>`); wins over what a descriptor carried. */
  connectorMeta?: Record<string, ConnectorMeta>;
  now?: () => Date;
}

export const ACTIVITI_TARGET_VERSION = '9.0.0';
const BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checkBaseName(kind: string, name: string): void {
  if (!BASE_NAME.test(name) || name.endsWith('.')) {
    throw new Error(`Invalid ${kind} name "${name}": use letters, digits, ".", "_" and "-" (no path separators or spaces)`);
  }
}

export interface AssembledProject {
  files: ProjectFile[];
  /** Non-fatal findings, e.g. foreign extension elements that were kept or extensions fields that were dropped. */
  warnings: string[];
}

/**
 * Lays the files out as in ADR 0003 (`project.json`, `processes/`, `connectors/`) and runs the serializer guarantees
 * on every BPMN. Throws ExportVerificationError (and writes nothing) when one is broken.
 */
export function assembleProject(input: ProjectInput): AssembledProject {
  checkBaseName('project', input.name);
  const now = (input.now ?? (() => new Date()))().toISOString();
  const files: ProjectFile[] = [];
  const warnings: string[] = [];
  const used = new Set<string>();
  const claim = (path: string): void => {
    if (used.has(path)) throw new Error(`Duplicate project file ${path}`);
    used.add(path);
  };

  files.push({
    path: 'project.json',
    content: `${JSON.stringify({ name: input.name, version: input.version ?? '1.0.0', activiti: ACTIVITI_TARGET_VERSION, created: now, modified: now }, null, 2)}\n`,
  });

  for (const process of input.processes) {
    checkBaseName('process file', process.name);
    for (const warning of assertBpmnExportable(process.xml, `processes/${process.name}.bpmn20.xml`)) warnings.push(`${process.name}: ${warning}`);
    claim(`processes/${process.name}.bpmn20.xml`);
    files.push({ path: `processes/${process.name}.bpmn20.xml`, content: process.xml });
    if (process.extensions === undefined) continue;
    const extensions = typeof process.extensions === 'string' ? parseExtensions(process.extensions, process.name) : process.extensions;
    claim(`processes/${process.name}-extensions.json`);
    const serialized = serializeExtensionsReport(extensions);
    for (const path of serialized.dropped) warnings.push(unknownFieldWarning(`${process.name}-extensions.json`, path, 'export'));
    files.push({ path: `processes/${process.name}-extensions.json`, content: serialized.text });
  }
  for (const dmn of input.dmn ?? []) {
    checkBaseName('DMN file', dmn.name);
    claim(`processes/${dmn.name}.dmn`);
    files.push({ path: `processes/${dmn.name}.dmn`, content: dmn.content });
  }
  for (const connector of input.connectors ?? []) {
    checkBaseName('connector file', connector.name);
    if (connector.name.includes('.')) throw new Error(`Connector name "${connector.name}" must not contain a dot (Activiti rejects it)`);
    claim(`connectors/${connector.name}.json`);
    files.push({ path: `connectors/${connector.name}.json`, content: connector.content });
  }
  const normalized = normalizeConnectorFiles(files);
  warnings.push(...normalized.warnings);
  let project = normalized.files.find((f) => f.path === 'project.json')!.content;
  for (const [name, meta] of Object.entries(input.connectorMeta ?? {})) {
    if (!used.has(`connectors/${name}.json`)) throw new Error(`Connector metadata for "${name}", but the project has no connectors/${name}.json`);
    const existing = (JSON.parse(project) as { connectors?: Record<string, ConnectorMeta> }).connectors?.[name];
    project = writeConnectorMeta(project, name, { ...(existing ?? {}), ...meta });
  }
  return { files: normalized.files.map((f) => (f.path === 'project.json' ? { path: f.path, content: project } : f)), warnings };
}
