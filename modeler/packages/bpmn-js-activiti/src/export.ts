import { assembleProject, assertBpmnExportable, unknownFieldWarning, type ConnectorMeta, type DmnFileInput, type ProjectFile } from '@activiti-modeler/activiti-project';

import type { ExtensionsStore } from './modules/extensions';
import type { ModdleElement } from './types';

/** The part of a bpmn-js Modeler that export needs. */
export interface ExportableModeler {
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>;
  getDefinitions(): ModdleElement | undefined;
  get<T>(name: string): T;
}

export interface ExportedProcess {
  /** BPMN XML, pretty-printed, diagram moved to the origin and verified against the ADR 0003 guarantees. */
  xml: string;
  /** Content of `<name>-extensions.json`, with an entry for every process. */
  extensionsJson: string;
  processIds: string[];
  warnings: string[];
}

interface Moved {
  target: ModdleElement;
  property: 'x' | 'y';
  value: number;
}

/** Every coordinate holder (shape bounds, label bounds, waypoints) of a BPMN diagram plane. */
function coordinateHolders(diagram: ModdleElement): ModdleElement[] {
  const holders: ModdleElement[] = [];
  const plane = diagram.get('plane') as ModdleElement | undefined;
  for (const element of (plane?.get('planeElement') as ModdleElement[] | undefined) ?? []) {
    const bounds = element.get('bounds') as ModdleElement | undefined;
    if (bounds) holders.push(bounds);
    for (const point of (element.get('waypoint') as ModdleElement[] | undefined) ?? []) holders.push(point);
    const labelBounds = (element.get('label') as ModdleElement | undefined)?.get('bounds') as ModdleElement | undefined;
    if (labelBounds) holders.push(labelBounds);
  }
  return holders;
}

/**
 * Moves each diagram so that its top-left corner is at (0, 0), for the duration of `fn`, then puts every coordinate
 * back: the editing session is not disturbed and nothing lands in the undo history.
 */
async function atOrigin<T>(definitions: ModdleElement | undefined, fn: () => Promise<T>): Promise<T> {
  const moved: Moved[] = [];
  for (const diagram of (definitions?.get('diagrams') as ModdleElement[] | undefined) ?? []) {
    const holders = coordinateHolders(diagram);
    if (holders.length === 0) continue;
    const minX = Math.min(...holders.map((h) => h.get('x') as number));
    const minY = Math.min(...holders.map((h) => h.get('y') as number));
    if (minX === 0 && minY === 0) continue;
    for (const holder of holders) {
      moved.push({ target: holder, property: 'x', value: holder.get('x') as number }, { target: holder, property: 'y', value: holder.get('y') as number });
      holder.set('x', (holder.get('x') as number) - minX);
      holder.set('y', (holder.get('y') as number) - minY);
    }
  }
  try {
    return await fn();
  } finally {
    for (const { target, property, value } of moved) target.set(property, value);
  }
}

/**
 * bpmn-js keeps the text annotations of a collaboration in the collaboration, also those drawn in a pool, and the associations to them
 * with them. Activiti reads the artifacts of a process only and warns about the diagram of the others (`DI_INVALID_REFERENCE`, engine
 * finding C18.7). For the duration of `fn` an annotation whose shape lies inside a pool that has a process is put into that process,
 * with the associations that connect it, then everything is put back: the editing session is not disturbed.
 */
async function artifactsInPools<T>(definitions: ModdleElement | undefined, fn: () => Promise<T>): Promise<T> {
  const bounds = new Map<ModdleElement, ModdleElement>();
  for (const diagram of (definitions?.get('diagrams') as ModdleElement[] | undefined) ?? []) {
    for (const element of ((diagram.get('plane') as ModdleElement | undefined)?.get('planeElement') as ModdleElement[] | undefined) ?? []) {
      const target = element.get('bpmnElement') as ModdleElement | undefined;
      const box = element.get('bounds') as ModdleElement | undefined;
      if (target && box) bounds.set(target, box);
    }
  }
  const n = (box: ModdleElement, property: string): number => box.get(property) as number;
  const centreInside = (inner: ModdleElement, outer: ModdleElement): boolean => {
    const x = n(inner, 'x') + n(inner, 'width') / 2;
    const y = n(inner, 'y') + n(inner, 'height') / 2;
    return x >= n(outer, 'x') && x <= n(outer, 'x') + n(outer, 'width') && y >= n(outer, 'y') && y <= n(outer, 'y') + n(outer, 'height');
  };
  const saved: Array<{ container: ModdleElement; artifacts: ModdleElement[] }> = [];
  const moved: Array<{ artifact: ModdleElement; parent: ModdleElement }> = [];
  for (const collaboration of ((definitions?.get('rootElements') as ModdleElement[] | undefined) ?? []).filter((r) => r.$instanceOf('bpmn:Collaboration'))) {
    const artifacts = (collaboration.get('artifacts') as ModdleElement[] | undefined) ?? [];
    const pools = ((collaboration.get('participants') as ModdleElement[] | undefined) ?? []).filter((p) => p.get('processRef') && bounds.has(p));
    const target = new Map<ModdleElement, ModdleElement>();
    for (const annotation of artifacts.filter((a) => a.$instanceOf('bpmn:TextAnnotation') && bounds.has(a))) {
      const pool = pools.find((p) => centreInside(bounds.get(annotation)!, bounds.get(p)!));
      if (pool) target.set(annotation, pool.get('processRef') as ModdleElement);
    }
    for (const association of artifacts.filter((a) => a.$instanceOf('bpmn:Association'))) {
      const end = [association.get('sourceRef'), association.get('targetRef')].find((e) => target.has(e as ModdleElement)) as ModdleElement | undefined;
      if (end) target.set(association, target.get(end)!);
    }
    if (target.size === 0) continue;
    saved.push({ container: collaboration, artifacts: [...artifacts] });
    for (const process of new Set(target.values())) saved.push({ container: process, artifacts: [...((process.get('artifacts') as ModdleElement[] | undefined) ?? [])] });
    for (const [artifact, process] of target) {
      artifacts.splice(artifacts.indexOf(artifact), 1);
      // an annotation goes before the associations that connect it (bpmn-js may have kept one of them in the process already)
      const into = process.get('artifacts') as ModdleElement[];
      const connecting = into.findIndex((a) => a.$instanceOf('bpmn:Association') && (a.get('sourceRef') === artifact || a.get('targetRef') === artifact));
      into.splice(connecting < 0 ? into.length : connecting, 0, artifact);
      moved.push({ artifact, parent: artifact.$parent as ModdleElement });
      artifact.$parent = process;
    }
  }
  try {
    return await fn();
  } finally {
    for (const { container, artifacts } of saved) (container.get('artifacts') as ModdleElement[]).splice(0, Infinity, ...artifacts);
    for (const { artifact, parent } of moved) artifact.$parent = parent;
  }
}

/**
 * Serialises the open diagram and its extensions. Fails (throws ExportVerificationError) instead of returning XML that
 * breaks an ADR 0003 guarantee, so a broken file can never be written.
 */
export async function exportProcess(modeler: ExportableModeler, name = 'process'): Promise<ExportedProcess> {
  const definitions = modeler.getDefinitions();
  const { xml } = await atOrigin(definitions, () => artifactsInPools(definitions, () => modeler.saveXML({ format: true })));
  if (!xml) throw new Error('saveXML returned no XML');
  const warnings = assertBpmnExportable(xml, `${name}.bpmn20.xml`);
  const processIds = ((definitions?.get('rootElements') as ModdleElement[] | undefined) ?? []).filter((r) => r.$instanceOf('bpmn:Process')).map((r) => r.id as string);
  const store = modeler.get<ExtensionsStore>('extensionsStore');
  const extensions = store.serializeWithReport(processIds, name);
  for (const path of extensions.dropped) warnings.push(unknownFieldWarning(`${name}-extensions.json`, path, 'export'));
  return { xml, extensionsJson: extensions.json, processIds, warnings };
}

export interface ExportProjectOptions {
  /** Project name (`project.json`). */
  project: string;
  /** Base name of the process files; defaults to the project name. */
  process?: string;
  dmn?: DmnFileInput[];
  connectors?: DmnFileInput[];
  /** Modeler metadata of the connectors by name, kept in `project.json` (`connectors.<name>`). */
  connectorMeta?: Record<string, ConnectorMeta>;
  now?: () => Date;
}

/** One-process project in the ADR 0003 layout, from the open diagram. */
export async function exportProject(modeler: ExportableModeler, options: ExportProjectOptions): Promise<{ files: ProjectFile[]; warnings: string[] }> {
  const name = options.process ?? options.project;
  const exported = await exportProcess(modeler, name);
  const assembled = assembleProject({
    name: options.project,
    now: options.now,
    processes: [{ name, xml: exported.xml, extensions: exported.extensionsJson }],
    dmn: options.dmn,
    connectors: options.connectors,
    ...(options.connectorMeta ? { connectorMeta: options.connectorMeta } : {}),
  });
  return { files: assembled.files, warnings: [...exported.warnings, ...assembled.warnings] };
}

/** The part of a bpmn-js Modeler that import needs. */
export interface ImportableModeler {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  get<T>(name: string): T;
}

/**
 * Opens a process: its BPMN, then its extensions JSON (the store is reset by the import and loaded after it). Fields of the
 * extensions JSON that Activiti 9.0.0 does not know are kept while the file is open, reported as warnings, and dropped on export.
 */
export async function importProcess(modeler: ImportableModeler, input: { xml: string; extensionsJson?: string; name?: string }): Promise<{ warnings: string[] }> {
  const { warnings } = await modeler.importXML(input.xml);
  const store = modeler.get<ExtensionsStore>('extensionsStore');
  store.load(input.extensionsJson, input.name);
  const extensionWarnings = store.unknownFields().map((path) => unknownFieldWarning(`${input.name ?? 'process'}-extensions.json`, path, 'import'));
  return { warnings: [...warnings.map((w) => String((w as { message?: string }).message ?? w)), ...extensionWarnings] };
}
