export type ProjectFileKind = 'bpmn' | 'dmn' | 'extensions' | 'scenario' | 'connector' | 'other';

/** What a project file is, from its path alone (see docs/adr/0003-model-file-contract.md). */
export function classifyFile(path: string): ProjectFileKind {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.endsWith('-extensions.json')) return 'extensions';
  if (name.endsWith('.scenario.json')) return 'scenario';
  if (name.endsWith('.bpmn20.xml') || name.endsWith('.bpmn')) return 'bpmn';
  if (name.endsWith('.dmn')) return 'dmn';
  if (path.startsWith('connectors/') && name.endsWith('.json')) return 'connector';
  return 'other';
}

/** Path of the extensions sidecar that Activiti reads next to a process file: `a/x.bpmn20.xml` -> `a/x-extensions.json`. */
export function extensionsPathFor(bpmnPath: string): string {
  const base = bpmnPath.replace(/\.bpmn20\.xml$|\.bpmn$/, '');
  if (base === bpmnPath) {
    throw new Error(`Not a BPMN file path: ${bpmnPath}`);
  }
  return `${base}-extensions.json`;
}

/** Path of the process file that a sidecar belongs to, if it exists in `paths` (`a/x-extensions.json` -> `a/x.bpmn20.xml` or `a/x.bpmn`). */
export function bpmnPathForExtensions(extensionsPath: string, paths: Iterable<string>): string | undefined {
  if (!extensionsPath.endsWith('-extensions.json')) return undefined;
  const base = extensionsPath.slice(0, -'-extensions.json'.length);
  const all = new Set(paths);
  return [`${base}.bpmn20.xml`, `${base}.bpmn`].find((p) => all.has(p));
}

/** What a file is shown with: the editor family a tab opens (the app maps these to editor components). */
export type EditorKind = 'bpmn' | 'dmn' | 'json' | 'text';

const TEXT_EXTENSIONS = ['.xml', '.bpmn', '.dmn', '.json', '.form', '.md', '.txt', '.properties', '.yml', '.yaml'];

/** Files the modeler loads into a project (everything else in a folder is ignored): text formats only. */
export function isProjectTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function editorKindOf(path: string): EditorKind {
  const kind = classifyFile(path);
  if (kind === 'bpmn') return 'bpmn';
  if (kind === 'dmn') return 'dmn';
  if (kind === 'extensions' || kind === 'scenario' || kind === 'connector' || path.endsWith('.json') || path.endsWith('.form')) return 'json';
  return 'text';
}
