/**
 * The per-process `<name>-extensions.json` model (ADR 0003 / 0006, R1 §6.2) and the pure operations on it.
 * Fields the Activiti 9.0.0 runtime does not know (runtime-model.ts) are kept in memory after an import, so the editor can
 * warn about them, and are dropped when the file is serialised: the runtime's ObjectMapper may reject them.
 */
import { findUnknownFields, stripUnknownFields } from './runtime-model';

export type VariableType =
  | 'boolean' | 'string' | 'integer' | 'bigdecimal' | 'json' | 'file' | 'folder' | 'content' | 'date' | 'datetime' | 'array';

export const VARIABLE_TYPES: readonly VariableType[] = [
  'boolean', 'string', 'integer', 'bigdecimal', 'json', 'file', 'folder', 'content', 'date', 'datetime', 'array',
];

export interface ProcessVariableDefinition {
  id: string;
  name: string;
  type: VariableType | string;
  required?: boolean;
  /** Default value, parsed per type by the engine. */
  value?: unknown;
  description?: string;
  display?: boolean;
  displayName?: string;
  analytics?: boolean;
  ephemeral?: boolean;
  [unknown: string]: unknown;
}

export type MappingType = 'MAP_ALL' | 'MAP_ALL_INPUTS' | 'MAP_ALL_OUTPUTS';
export type MappingValueType = 'VARIABLE' | 'VALUE' | 'JSONPATCH';

export interface MappingValue {
  /** Written upper-case; the runtime reads it case-insensitively, so lower-case files stay as they are. */
  type: MappingValueType | string;
  value?: unknown;
  [unknown: string]: unknown;
}

export interface ProcessVariablesMapping {
  mappingType?: MappingType | string;
  ephemeral?: boolean;
  inputs?: Record<string, MappingValue>;
  outputs?: Record<string, MappingValue>;
  [unknown: string]: unknown;
}

export interface ConstantValue {
  value: unknown;
  [unknown: string]: unknown;
}

export interface ProcessExtension {
  properties: Record<string, ProcessVariableDefinition>;
  mappings: Record<string, ProcessVariablesMapping>;
  constants: Record<string, Record<string, ConstantValue>>;
  /** Read by the runtime, not consumed by 9.0.0; kept as is. `templates.tasks` is keyed by user task id. */
  templates?: { default?: Record<string, unknown>; tasks?: Record<string, unknown>; [unknown: string]: unknown };
  /** Read by the runtime, not consumed by 9.0.0; keyed by element id. */
  assignments?: Record<string, unknown>;
  [unknown: string]: unknown;
}

/** `ProcessExtensionModel` of the runtime: only `id` and `extensions` are known to Activiti 9.0.0. */
export interface ExtensionsFile {
  id: string;
  extensions: Record<string, ProcessExtension>;
  /** Fields of an imported file that the runtime does not know; never written. */
  [unknown: string]: unknown;
}

export function emptyProcessExtension(): ProcessExtension {
  return { properties: {}, mappings: {}, constants: {} };
}

export function emptyExtensionsFile(name: string, processId?: string): ExtensionsFile {
  const file: ExtensionsFile = { id: `process-${name}`, extensions: {} };
  if (processId) file.extensions[processId] = emptyProcessExtension();
  return file;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses and normalises a `-extensions.json` text: the three maps always exist, everything else is kept. */
export function parseExtensions(json: string, fallbackName = 'process'): ExtensionsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid extensions JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (!isRecord(parsed)) throw new Error('Invalid extensions JSON: the top level must be an object');
  const file = parsed as ExtensionsFile;
  file.id = typeof file.id === 'string' ? file.id : `process-${fallbackName}`;
  if (!isRecord(file.extensions)) file.extensions = {};
  for (const [processId, ext] of Object.entries(file.extensions)) {
    const e = (isRecord(ext) ? ext : {}) as ProcessExtension;
    e.properties = isRecord(e.properties) ? e.properties : {};
    e.mappings = isRecord(e.mappings) ? e.mappings : {};
    e.constants = isRecord(e.constants) ? e.constants : {};
    file.extensions[processId] = e;
  }
  return file;
}

const TOP_ORDER = ['id', 'extensions'];
const EXT_ORDER = ['properties', 'mappings', 'constants', 'templates', 'assignments'];
const PROPERTY_ORDER = ['id', 'name', 'type', 'required', 'value', 'description', 'display', 'displayName', 'analytics', 'ephemeral'];
const MAPPING_ORDER = ['mappingType', 'ephemeral', 'inputs', 'outputs'];

function ordered<T extends Record<string, unknown>>(source: T, first: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of first) if (key in source) out[key] = source[key];
  for (const key of Object.keys(source)) if (!(key in out)) out[key] = source[key];
  return out;
}

/** Paths of the fields in `file` that the Activiti 9.0.0 runtime does not know (they are dropped by `serializeExtensions`). */
export function unknownExtensionFields(file: ExtensionsFile): string[] {
  return findUnknownFields(file);
}

/**
 * Stable, human-diffable JSON in a fixed field order. Only fields known to the Activiti 9.0.0 model classes are written
 * (see runtime-model.ts); `dropped` lists the JSON paths of the others.
 */
export function serializeExtensionsReport(file: ExtensionsFile): { text: string; dropped: string[] } {
  const { document, dropped } = stripUnknownFields(file);
  return { text: serializeKnown(document), dropped };
}

export function serializeExtensions(file: ExtensionsFile): string {
  return serializeExtensionsReport(file).text;
}

function serializeKnown(file: ExtensionsFile): string {
  const extensions: Record<string, unknown> = {};
  for (const [processId, ext] of Object.entries(file.extensions)) {
    const properties = Object.fromEntries(Object.entries(ext.properties).map(([key, p]) => [key, ordered(p, PROPERTY_ORDER)]));
    const mappings = Object.fromEntries(Object.entries(ext.mappings).map(([key, m]) => [key, ordered(m, MAPPING_ORDER)]));
    extensions[processId] = ordered({ ...ext, properties, mappings }, EXT_ORDER);
  }
  return `${JSON.stringify(ordered({ ...file, extensions }, TOP_ORDER), null, 2)}\n`;
}

export function cloneExtensions<T>(value: T): T {
  return structuredClone(value);
}

// --- element keyed operations -----------------------------------------------------------------------------------

/** Maps of a process extension whose keys are BPMN element ids. */
function elementMaps(ext: ProcessExtension): Array<Record<string, unknown>> {
  const maps: Array<Record<string, unknown>> = [ext.mappings, ext.constants];
  if (isRecord(ext.assignments)) maps.push(ext.assignments);
  const tasks = ext.templates?.tasks;
  if (isRecord(tasks)) maps.push(tasks);
  return maps;
}

/** Ids of the elements that have an entry in this process extension. */
export function keyedElementIds(ext: ProcessExtension): string[] {
  const ids = new Set<string>();
  for (const map of elementMaps(ext)) for (const id of Object.keys(map)) ids.add(id);
  return [...ids].sort();
}

/** Renames an element key in mappings, constants, assignments and templates.tasks. Returns whether anything changed. */
export function renameElementKey(ext: ProcessExtension, oldId: string, newId: string): boolean {
  if (oldId === newId) return false;
  let changed = false;
  for (const map of elementMaps(ext)) {
    if (!(oldId in map)) continue;
    const rebuilt: Record<string, unknown> = {};
    // keep the key position so diffs stay small
    for (const [key, value] of Object.entries(map)) rebuilt[key === oldId ? newId : key] = value;
    for (const key of Object.keys(map)) delete map[key];
    Object.assign(map, rebuilt);
    changed = true;
  }
  if (isRecord(ext.assignments)) {
    const entry = ext.assignments[newId];
    // assignments repeat their own element id in `id`
    if (isRecord(entry) && entry['id'] === oldId) entry['id'] = newId;
  }
  return changed;
}

/** Removes every entry keyed by `elementId`. Returns whether anything changed. */
export function removeElementKey(ext: ProcessExtension, elementId: string): boolean {
  let changed = false;
  for (const map of elementMaps(ext)) {
    if (elementId in map) {
      delete map[elementId];
      changed = true;
    }
  }
  return changed;
}

export type ElementEntries = Partial<Record<'mappings' | 'constants' | 'assignments' | 'templatesTask', unknown>>;

/** Snapshot of the entries of one element, for copy / paste (cloned, so later edits do not alias). */
export function readElementEntries(ext: ProcessExtension, elementId: string): ElementEntries {
  const out: ElementEntries = {};
  if (elementId in ext.mappings) out.mappings = cloneExtensions(ext.mappings[elementId]);
  if (elementId in ext.constants) out.constants = cloneExtensions(ext.constants[elementId]);
  if (isRecord(ext.assignments) && elementId in ext.assignments) out.assignments = cloneExtensions(ext.assignments[elementId]);
  const tasks = ext.templates?.tasks;
  if (isRecord(tasks) && elementId in tasks) out.templatesTask = cloneExtensions(tasks[elementId]);
  return out;
}

/** Writes a snapshot under another element id (assignments get their `id` rewritten). */
export function writeElementEntries(ext: ProcessExtension, elementId: string, entries: ElementEntries): boolean {
  let changed = false;
  if (entries.mappings !== undefined) {
    ext.mappings[elementId] = cloneExtensions(entries.mappings) as ProcessVariablesMapping;
    changed = true;
  }
  if (entries.constants !== undefined) {
    ext.constants[elementId] = cloneExtensions(entries.constants) as Record<string, ConstantValue>;
    changed = true;
  }
  if (entries.assignments !== undefined) {
    const copy = cloneExtensions(entries.assignments);
    if (isRecord(copy) && 'id' in copy) copy['id'] = elementId;
    ext.assignments = { ...(ext.assignments ?? {}), [elementId]: copy };
    changed = true;
  }
  if (entries.templatesTask !== undefined) {
    ext.templates = { ...(ext.templates ?? {}) };
    ext.templates.tasks = { ...(isRecord(ext.templates.tasks) ? ext.templates.tasks : {}), [elementId]: cloneExtensions(entries.templatesTask) };
    changed = true;
  }
  return changed;
}

// --- declared properties ------------------------------------------------------------------------------------------

/** Infers a property type from a literal output value; undefined for a non-literal. */
export function inferTypeFromLiteral(value: unknown): VariableType | undefined {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'bigdecimal';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'json';
  return undefined;
}

export interface DeclareHints {
  /** Types of connector / task outputs, by output name (VARIABLE outputs read the result variable of that name). */
  sourceTypes?: Record<string, string>;
  /** Types of already known variables, by name (e.g. an input mapped one-to-one). */
  knownTypes?: Record<string, string>;
}

export function findPropertyByName(ext: ProcessExtension, name: string): ProcessVariableDefinition | undefined {
  return Object.values(ext.properties).find((p) => p.name === name);
}

/**
 * Declares every output-mapping target in `properties` (the runtime skips undeclared targets, ADR 0003). The type is
 * inferred from the source when it is known, otherwise `json`. Returns the names that were added.
 */
export function declareOutputTargets(
  ext: ProcessExtension,
  mapping: ProcessVariablesMapping,
  newId: () => string,
  hints: DeclareHints = {},
): string[] {
  const added: string[] = [];
  for (const [target, output] of Object.entries(mapping.outputs ?? {})) {
    if (findPropertyByName(ext, target)) continue;
    const kind = String(output.type).toUpperCase();
    let type: string | undefined;
    if (kind === 'VALUE') type = inferTypeFromLiteral(output.value);
    else if (kind === 'VARIABLE') type = hints.sourceTypes?.[String(output.value)] ?? hints.knownTypes?.[String(output.value)];
    const id = newId();
    ext.properties[id] = { id, name: target, type: type ?? 'json', required: false };
    added.push(target);
  }
  return added;
}
