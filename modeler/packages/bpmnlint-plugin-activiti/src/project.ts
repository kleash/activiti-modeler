/**
 * Project level lint: reads the files of a project (text only, so it runs in the browser, in Node and in the CLI), builds
 * the index the cross-document rules read (connectors, DMN decisions, the other processes), and lints every file.
 * `lintProject()` is the API that blocks a deploy: a project with an `error` problem must not be deployed.
 */
import { classifyFile, connectorKeyOf, emptyExtensionsFile, extensionsPathFor, parseExtensions, readConnectorMeta, type ConnectorMeta, type ExtensionsFile, type ProjectFile } from '@activiti-modeler/activiti-project';

import { scanDmn } from './dmn';
import { lintRaw, toProblems } from './linter';
import { parseBpmn } from './parse';
import { basenameOf } from './paths';
import { DOCS_BASE } from './define';
import { checkDmnFile } from './rules/file-rules';
import type { ConnectorAction, ConnectorDefinition, LintContext, ME, Problem, ProjectIndex } from './types';
import { allFlowElements, is, list, processesOf, str } from './model';
import type { LinterConfig } from 'bpmnlint';

export interface LintProjectOptions {
  /** `false` when the engine's async executor is known to be off. */
  asyncExecutorActive?: boolean;
  scriptEngines?: string[];
  dmnProfile?: 'operaton' | 'kie';
  /** Rule configuration; defaults to `plugin:activiti/recommended`. */
  config?: LinterConfig;
  /** Lint only these files (the rest of the project is still read as context). */
  only?: readonly string[];
}

export interface ProjectLintResult {
  problems: Problem[];
  /** Problems by file path (every linted file has an entry, possibly empty). */
  byFile: Record<string, Problem[]>;
  counts: { error: number; warning: number; info: number };
  /** Files that were linted. */
  files: string[];
  /** True when no problem has the severity `error`: the project may be deployed. */
  deployable: boolean;
  /** What the lint learned about the project (connectors, DMN decisions, processes): the context of the open editors. */
  index: ProjectIndex;
}

export function countProblems(problems: readonly Problem[]): { error: number; warning: number; info: number } {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity] += 1;
  return counts;
}

/**
 * Normalises a connector JSON to the definition the rules read (`actions` as a map or as a list). The version of the connector's
 * templates comes from `project.json` (`meta`, ADR 0003); a file that still carries a `version` itself is read as before.
 */
export function parseConnector(path: string, text: string, meta?: ConnectorMeta): ConnectorDefinition | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null) return undefined;
  const raw = json as Record<string, unknown>;
  const name = typeof raw['name'] === 'string' ? raw['name'] : basenameOf(path).replace(/\.json$/, '');
  const actions: Record<string, ConnectorAction> = {};
  const rawActions = raw['actions'];
  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(rawActions)
    ? (rawActions as Array<Record<string, unknown>>).map((a) => [String(a['id'] ?? a['name'] ?? ''), a])
    : Object.entries((rawActions ?? {}) as Record<string, Record<string, unknown>>);
  for (const [key, action] of entries) {
    const id = String(action['id'] ?? key);
    const mapVars = (v: unknown): Array<{ id: string; name: string; type?: string; required?: boolean }> =>
      (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []).map((x) => ({
        id: String(x['id'] ?? x['name'] ?? ''),
        name: String(x['name'] ?? x['id'] ?? ''),
        ...(typeof x['type'] === 'string' ? { type: x['type'] } : {}),
        ...(typeof x['required'] === 'boolean' ? { required: x['required'] } : {}),
      }));
    actions[id] = { id, ...(typeof action['name'] === 'string' ? { name: action['name'] } : {}), inputs: mapVars(action['inputs']), outputs: mapVars(action['outputs']) };
  }
  const version = meta?.version ?? raw['version'];
  return { id: String(raw['id'] ?? name), name, ...(typeof version === 'string' ? { version } : typeof version === 'number' ? { version: String(version) } : {}), actions };
}

interface ParsedProcessFile {
  path: string;
  definitions?: ME;
  unresolved: Map<object, Record<string, string>>;
  duplicateIds: Array<{ id: string; tag: string }>;
  error?: string;
  text: string;
  extensions?: ExtensionsFile;
  extensionsError?: string;
}

const messageNameOf = (definition: ME): string | undefined => {
  const ref = definition.get('messageRef') as ME | undefined;
  return ref ? str(ref, 'name') : undefined;
};

/** Summary of the processes of a parsed file for the project index. */
function indexProcesses(parsed: ParsedProcessFile, index: ProjectIndex): void {
  if (!parsed.definitions) return;
  for (const process of processesOf(parsed.definitions)) {
    const starts: string[] = [];
    for (const element of allFlowElements(process)) {
      if (!is(element, 'bpmn:Event')) continue;
      for (const definition of list(element, 'eventDefinitions')) {
        if (!is(definition, 'bpmn:MessageEventDefinition')) continue;
        const message = messageNameOf(definition);
        if (!message) continue;
        const kind = is(element, 'bpmn:BoundaryEvent')
          ? 'boundary'
          : is(element, 'bpmn:StartEvent')
            ? element.$parent && is(element.$parent, 'bpmn:SubProcess') ? 'eventSubProcess' : 'start'
            : is(element, 'bpmn:IntermediateCatchEvent') ? 'catch' : undefined;
        if (!kind) continue;
        if (kind === 'start') starts.push(message);
        (index.messageCatches ??= []).push({
          path: parsed.path,
          processId: process.id ?? '',
          message,
          elementId: element.id ?? '',
          hasCorrelationKey: !!str(definition, 'activiti:correlationKey'),
          kind,
        });
      }
    }
    index.processes.push({ path: parsed.path, id: process.id ?? '', ...(str(process, 'name') ? { name: str(process, 'name')! } : {}), executable: process.get('isExecutable') !== false, messageStarts: starts });
  }
}

async function parseProcessFile(file: ProjectFile, files: readonly ProjectFile[]): Promise<ParsedProcessFile> {
  const parsed: ParsedProcessFile = { path: file.path, unresolved: new Map(), duplicateIds: [], text: file.content };
  try {
    const result = await parseBpmn(file.content);
    parsed.definitions = result.definitions;
    parsed.unresolved = result.unresolved;
    parsed.duplicateIds = result.duplicateIds;
  } catch (e) {
    parsed.error = e instanceof Error ? e.message : String(e);
  }
  const sidecar = extensionsPathFor(file.path);
  const extensionsFile = files.find((f) => f.path === sidecar);
  if (extensionsFile) {
    try {
      parsed.extensions = parseExtensions(extensionsFile.content, basenameOf(file.path));
    } catch (e) {
      parsed.extensionsError = e instanceof Error ? e.message : String(e);
    }
  }
  return parsed;
}

export async function buildProjectIndex(files: readonly ProjectFile[], parsedFiles?: ParsedProcessFile[]): Promise<ProjectIndex> {
  const index: ProjectIndex = { processes: [] };
  const connectors: ConnectorDefinition[] = [];
  const dmn = [];
  const extensions: Record<string, ExtensionsFile> = {};
  const parsedList = parsedFiles ?? (await Promise.all(files.filter((f) => classifyFile(f.path) === 'bpmn').map((f) => parseProcessFile(f, files))));
  for (const parsed of parsedList) {
    indexProcesses(parsed, index);
    if (parsed.extensions) extensions[parsed.path] = parsed.extensions;
  }
  const connectorMeta = readConnectorMeta(files.find((f) => f.path === 'project.json')?.content);
  for (const file of files) {
    const kind = classifyFile(file.path);
    if (kind === 'connector') {
      const connector = parseConnector(file.path, file.content, connectorMeta[connectorKeyOf(file.path)]);
      if (connector) connectors.push(connector);
    } else if (kind === 'dmn') dmn.push(scanDmn(file.path, file.content));
  }
  index.connectors = connectors;
  index.dmn = dmn;
  index.extensions = extensions;
  return index;
}

/** For the fixtures of the cross-document rules: an index of `files` (path -> text). */
export async function fixtureProjectIndex(files: Record<string, string>): Promise<ProjectIndex> {
  return buildProjectIndex(Object.entries(files).map(([path, content]) => ({ path, content })));
}

/** The context for linting one parsed process file of a project. */
export function contextFor(parsed: ParsedProcessFile, index: ProjectIndex, options: LintProjectOptions): LintContext {
  return {
    path: parsed.path,
    unresolved: parsed.unresolved,
    duplicateIds: parsed.duplicateIds,
    // a process without a sidecar behaves like one with an empty extensions file (the modeler's store is empty then)
    ...(parsed.extensions ? { extensions: parsed.extensions } : parsed.extensionsError ? {} : { extensions: emptyExtensionsFile(basenameOf(parsed.path)) }),
    project: index,
    text: parsed.text,
    ...(options.asyncExecutorActive !== undefined ? { asyncExecutorActive: options.asyncExecutorActive } : {}),
    ...(options.scriptEngines ? { scriptEngines: options.scriptEngines } : {}),
  };
}

const fileProblem = (path: string, rule: string, severity: Problem['severity'], message: string, extra: Partial<Problem> = {}): Problem => ({
  id: `${path}|${rule}|${extra.elementId ?? ''}|1`,
  path,
  rule,
  severity,
  message,
  source: 'client',
  documentationUrl: `${DOCS_BASE}${rule.replace('activiti/', '')}.md`,
  ...extra,
});

/** Lints every file of a project. */
export async function lintProject(files: readonly ProjectFile[], options: LintProjectOptions = {}): Promise<ProjectLintResult> {
  const bpmnFiles = files.filter((f) => classifyFile(f.path) === 'bpmn');
  const parsedList = await Promise.all(bpmnFiles.map((f) => parseProcessFile(f, files)));
  const index = await buildProjectIndex(files, parsedList);
  const only = options.only ? new Set(options.only) : undefined;
  const byFile: Record<string, Problem[]> = {};
  const wanted = (path: string): boolean => !only || only.has(path);

  for (const parsed of parsedList) {
    if (!wanted(parsed.path)) continue;
    const problems: Problem[] = [];
    if (!parsed.definitions) {
      problems.push(fileProblem(parsed.path, 'activiti/bpmn-unreadable', 'error', `The BPMN file cannot be read: ${parsed.error ?? 'unknown error'}`));
    } else {
      const raw = await lintRaw(parsed.definitions, { context: contextFor(parsed, index, options), ...(options.config ? { config: options.config } : {}) });
      problems.push(...toProblems(raw, parsed.path));
    }
    if (parsed.extensionsError) problems.push(fileProblem(extensionsPathFor(parsed.path), 'activiti/extensions-unreadable', 'error', `The extensions file cannot be read: ${parsed.extensionsError}`));
    byFile[parsed.path] = problems;
  }

  // sidecars without a process file, and unreadable ones of files that did not parse
  const bpmnPaths = new Set(bpmnFiles.map((f) => f.path));
  for (const file of files) {
    if (classifyFile(file.path) !== 'extensions' || !wanted(file.path)) continue;
    const base = file.path.slice(0, -'-extensions.json'.length);
    if (![`${base}.bpmn20.xml`, `${base}.bpmn`].some((p) => bpmnPaths.has(p))) {
      (byFile[file.path] ??= []).push(fileProblem(file.path, 'activiti/extensions-orphan-file', 'warning', `No process file belongs to ${basenameOf(file.path)}: Activiti only reads it next to a process of the same name`));
    }
  }

  for (const file of files) {
    if (classifyFile(file.path) !== 'dmn' || !wanted(file.path)) continue;
    byFile[file.path] = checkDmnFile(scanDmn(file.path, file.content), { dmnProfile: options.dmnProfile ?? 'operaton' });
  }

  const problems = Object.values(byFile).flat();
  const counts = countProblems(problems);
  return { problems, byFile, counts, files: Object.keys(byFile), deployable: counts.error === 0, index };
}

