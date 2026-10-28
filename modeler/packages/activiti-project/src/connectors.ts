/**
 * The connector catalog file `connectors/<name>.json` (feature U15): the shape of Activiti's connector descriptors, its validation and
 * its serialisation (ADR 0003, "Extensions rules").
 *
 * A service task calls `<connector name>.<ACTION>`: the runtime looks up the Spring bean of that name. The runtime reads every `.json`
 * file of `activiti.connectors.dir` into `ConnectorDefinition {id, name, description, actions}`, `ActionDefinition {id, name,
 * description, inputs, outputs}` and `VariableDefinition {id, name, description, type, required, display, displayName, analytics,
 * ephemeral}` with the host's ObjectMapper, which fails on any other field when the host has no lenient one. So the file holds those
 * fields and nothing else.
 *
 * What only the modeler needs, the template `version` (a task created from the template records it as `activiti:templateVersion`, and
 * lint rule L36 reports the tasks whose recorded version is older than the connector's), the Alfresco schema's `config`, `events`,
 * `template` and any other top-level field of a descriptor that came from elsewhere, lives in `project.json` under
 * `connectors.<name>` (`<name>` is the file name without `.json`). `project.json` is never deployed.
 */

/** `^[a-z]([-a-z0-9]{0,24}[a-z0-9])?$`: lower case, digits and hyphens, at most 26 characters, no dot (the dot separates the action). */
export const CONNECTOR_NAME_PATTERN = /^[a-z]([-a-z0-9]{0,24}[a-z0-9])?$/;
/** The connector schema's parameter types. */
export const CONNECTOR_PARAMETER_TYPES = ['string', 'integer', 'boolean', 'date', 'json', 'file', 'datetime', 'array'] as const;
export type ConnectorParameterType = (typeof CONNECTOR_PARAMETER_TYPES)[number];
/** The action part of `<connector>.<ACTION>`: no dot, no blank. */
export const CONNECTOR_ACTION_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The fields of the runtime's connector classes (activiti-connector-model 9.0.0): everything else is metadata of the modeler. */
export const CONNECTOR_FILE_FIELDS = ['id', 'name', 'description', 'actions'] as const;
export const CONNECTOR_ACTION_FIELDS = ['id', 'name', 'description', 'inputs', 'outputs'] as const;
export const CONNECTOR_VARIABLE_FIELDS = ['id', 'name', 'description', 'type', 'required', 'display', 'displayName', 'analytics', 'ephemeral'] as const;

export interface ConnectorParameter {
  id: string;
  name: string;
  description?: string;
  type: string;
  required?: boolean;
  display?: boolean;
  displayName?: string;
  analytics?: boolean;
  ephemeral?: boolean;
}

export interface ConnectorAction {
  id: string;
  name: string;
  description?: string;
  inputs: ConnectorParameter[];
  outputs: ConnectorParameter[];
}

export interface ConnectorConfigEntry {
  name: string;
  description?: string;
  value?: string;
  required?: boolean;
}

/** What the modeler keeps about a connector outside its file: `project.json`, `connectors.<name>` (see the file comment). */
export interface ConnectorMeta {
  /** Version of the element templates generated from the connector. */
  version?: string;
  template?: string;
  config?: ConnectorConfigEntry[];
  events?: Record<string, unknown>;
  /** Any other field of a descriptor that is not the runtime's. */
  [field: string]: unknown;
}

export interface ConnectorModel {
  id: string;
  name: string;
  description?: string;
  /** Modeler metadata (project.json): version of the element templates generated from this connector (see the file comment). */
  version?: string;
  template?: string;
  /** Actions in file order, keyed by their id. */
  actions: Record<string, ConnectorAction>;
  /** Modeler metadata: the events of an Alfresco descriptor, kept as they are. */
  events: Record<string, ConnectorAction>;
  /** Modeler metadata: the configuration of an Alfresco descriptor. */
  config: ConnectorConfigEntry[];
  /** Modeler metadata: other top-level fields of a descriptor. */
  unknown: Record<string, unknown>;
  /** Modeler-only fields the file itself carries (a descriptor from elsewhere): saving moves them to project.json. */
  legacyFields?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function parseParameters(value: unknown): ConnectorParameter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((raw) => {
    const name = text(raw['name']) ?? text(raw['id']) ?? '';
    const out: ConnectorParameter = { id: text(raw['id']) ?? name, name, type: text(raw['type']) ?? 'string' };
    if (text(raw['description'])) out.description = text(raw['description'])!;
    if (typeof raw['required'] === 'boolean') out.required = raw['required'];
    if (typeof raw['display'] === 'boolean') out.display = raw['display'];
    if (text(raw['displayName'])) out.displayName = text(raw['displayName'])!;
    if (typeof raw['analytics'] === 'boolean') out.analytics = raw['analytics'];
    if (typeof raw['ephemeral'] === 'boolean') out.ephemeral = raw['ephemeral'];
    return out;
  });
}

function parseActions(value: unknown): Record<string, ConnectorAction> {
  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(value)
    ? (value.filter(isRecord) as Array<Record<string, unknown>>).map((a) => [text(a['id']) ?? text(a['name']) ?? '', a])
    : isRecord(value)
      ? (Object.entries(value).filter(([, a]) => isRecord(a)) as Array<[string, Record<string, unknown>]>)
      : [];
  const out: Record<string, ConnectorAction> = {};
  for (const [key, raw] of entries) {
    const id = text(raw['id']) ?? key;
    const action: ConnectorAction = { id, name: text(raw['name']) ?? id, inputs: parseParameters(raw['inputs']), outputs: parseParameters(raw['outputs']) };
    if (text(raw['description'])) action.description = text(raw['description'])!;
    out[id] = action;
  }
  return out;
}

const MODELER_KNOWN = new Set(['version', 'template', 'config', 'events']);

const parseConfig = (value: unknown): ConnectorConfigEntry[] =>
  Array.isArray(value)
    ? (value.filter(isRecord) as Array<Record<string, unknown>>).map((c) => {
        const entry: ConnectorConfigEntry = { name: text(c['name']) ?? '' };
        if (text(c['description'])) entry.description = text(c['description'])!;
        if (typeof c['value'] === 'string') entry.value = c['value'];
        if (typeof c['required'] === 'boolean') entry.required = c['required'];
        return entry;
      })
    : [];

/** The modeler-only fields of a descriptor: every top-level field that is not the runtime's. */
function modelerFields(json: Record<string, unknown>): ConnectorMeta {
  return Object.fromEntries(Object.entries(json).filter(([key]) => !(CONNECTOR_FILE_FIELDS as readonly string[]).includes(key))) as ConnectorMeta;
}

/**
 * Reads a connector file. Lenient (a hand-written or imported file is shown, not refused); `validateConnector` says what is wrong.
 * `meta` is the entry of the connector in `project.json`; its fields win over the same fields in a file that still carries them (a
 * descriptor from elsewhere). Undefined for text that is not a JSON object.
 */
export function parseConnectorModel(source: string, fallbackName = '', meta?: ConnectorMeta): ConnectorModel | undefined {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;
  const name = text(json['name']) ?? fallbackName;
  const inFile = modelerFields(json);
  const modeler: ConnectorMeta = { ...inFile, ...(meta ?? {}) };
  const model: ConnectorModel = {
    id: text(json['id']) ?? name,
    name,
    actions: parseActions(json['actions']),
    events: parseActions(modeler['events']),
    config: parseConfig(modeler['config']),
    unknown: Object.fromEntries(Object.entries(modeler).filter(([key]) => !MODELER_KNOWN.has(key))),
  };
  if (text(json['description'])) model.description = text(json['description'])!;
  if (typeof modeler['version'] === 'string') model.version = modeler['version'];
  else if (typeof modeler['version'] === 'number') model.version = String(modeler['version']);
  if (text(modeler['template'])) model.template = text(modeler['template'])!;
  if (Object.keys(inFile).length > 0) model.legacyFields = Object.keys(inFile);
  return model;
}

export function emptyConnector(name: string): ConnectorModel {
  return { id: name, name, version: '1', actions: {}, events: {}, config: [], unknown: {} };
}

const parameterJson = (p: ConnectorParameter): Record<string, unknown> => ({
  id: p.id,
  name: p.name,
  ...(p.description ? { description: p.description } : {}),
  type: p.type,
  ...(p.required === true ? { required: true } : {}),
  ...(p.display !== undefined ? { display: p.display } : {}),
  ...(p.displayName ? { displayName: p.displayName } : {}),
  ...(p.analytics !== undefined ? { analytics: p.analytics } : {}),
  ...(p.ephemeral !== undefined ? { ephemeral: p.ephemeral } : {}),
});

const actionJson = (a: ConnectorAction): Record<string, unknown> => ({
  id: a.id,
  name: a.name,
  ...(a.description ? { description: a.description } : {}),
  inputs: a.inputs.map(parameterJson),
  outputs: a.outputs.map(parameterJson),
});

/** The file text: only the runtime's fields, 2-space JSON in a fixed field order, a newline at the end. */
export function serializeConnector(model: ConnectorModel): string {
  const json: Record<string, unknown> = { id: model.id, name: model.name };
  if (model.description) json['description'] = model.description;
  json['actions'] = Object.fromEntries(Object.values(model.actions).map((a) => [a.id, actionJson(a)]));
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** What goes to `project.json` under `connectors.<name>` for this connector; undefined when there is nothing to keep. */
export function connectorMetaOf(model: ConnectorModel): ConnectorMeta | undefined {
  const meta: ConnectorMeta = {};
  if (model.version) meta.version = model.version;
  if (model.template) meta.template = model.template;
  if (model.config.length > 0) {
    meta.config = model.config.map((c) => ({ name: c.name, ...(c.description ? { description: c.description } : {}), ...(c.value !== undefined ? { value: c.value } : {}), ...(c.required === true ? { required: true } : {}) }));
  }
  if (Object.keys(model.events).length > 0) meta.events = Object.fromEntries(Object.values(model.events).map((a) => [a.id, actionJson(a)]));
  for (const [key, value] of Object.entries(model.unknown)) meta[key] = value;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

// --- project.json ---------------------------------------------------------------------------------------------------------------------

/** The key of a connector file in `project.json`: the file name without folder and `.json`. */
export const connectorKeyOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');

/** The `connectors` section of a `project.json` text; empty for a missing, unreadable or section-less file. */
export function readConnectorMeta(projectJson: string | undefined): Record<string, ConnectorMeta> {
  if (projectJson === undefined) return {};
  try {
    const json: unknown = JSON.parse(projectJson);
    const section = isRecord(json) ? json['connectors'] : undefined;
    if (!isRecord(section)) return {};
    return Object.fromEntries(Object.entries(section).filter((entry): entry is [string, ConnectorMeta] => isRecord(entry[1])));
  } catch {
    return {};
  }
}

/**
 * `project.json` with the entry `connectors.<key>` set to `meta` (removed when `meta` is undefined, and the section with it when it is
 * empty); the other fields stay as they are. Without a project.json a minimal one is made. Throws when the text is not a JSON object.
 */
export function writeConnectorMeta(projectJson: string | undefined, key: string, meta: ConnectorMeta | undefined): string {
  let json: Record<string, unknown> = {};
  if (projectJson !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(projectJson);
    } catch (e) {
      throw new Error(`project.json is not valid JSON (${e instanceof Error ? e.message : String(e)}); fix it to keep the connector's version and configuration there.`, { cause: e });
    }
    if (!isRecord(parsed)) throw new Error('project.json is not a JSON object; fix it to keep the connector\'s version and configuration there.');
    json = parsed;
  }
  const section: Record<string, unknown> = isRecord(json['connectors']) ? { ...json['connectors'] } : {};
  if (meta === undefined) delete section[key];
  else section[key] = meta;
  const next = { ...json };
  if (Object.keys(section).length > 0) next['connectors'] = section;
  else delete next['connectors'];
  return `${JSON.stringify(next, null, 2)}\n`;
}

export interface SplitConnector {
  /** The file as the runtime reads it: only its fields. */
  content: string;
  /** What moved out of it, for `project.json`. */
  meta?: ConnectorMeta;
  /** Top-level fields that moved to `meta`. */
  moved: string[];
  /** Fields of actions and parameters that the runtime does not know and that were dropped (paths like `actions.SEND.inputs[0].default`). */
  dropped: string[];
}

const stripKnown = (value: unknown, known: readonly string[], path: string, dropped: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (!isRecord(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    if (known.includes(key)) out[key] = child;
    else dropped.push(`${path}.${key}`);
  }
  return out;
};

/**
 * Splits a connector file into what the runtime reads and the metadata that belongs to `project.json` (import and export). A
 * top-level field that is not the runtime's moves out; an unknown field inside an action or a parameter is dropped and reported.
 * Undefined when the text is not a JSON object. A file that is already clean comes back byte for byte.
 */
export function splitConnectorFile(source: string): SplitConnector | undefined {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;
  const meta = modelerFields(json);
  const moved = Object.keys(meta);
  const dropped: string[] = [];
  const actions = json['actions'];
  let nested = false;
  const cleanedActions: unknown = Array.isArray(actions)
    ? actions
    : isRecord(actions)
      ? Object.fromEntries(
          Object.entries(actions).map(([id, action]) => {
            const before = dropped.length;
            const cleaned = stripKnown(action, CONNECTOR_ACTION_FIELDS, `actions.${id}`, dropped);
            for (const direction of ['inputs', 'outputs'] as const) {
              const list = cleaned[direction];
              if (Array.isArray(list)) cleaned[direction] = list.map((p, index) => stripKnown(p, CONNECTOR_VARIABLE_FIELDS, `actions.${id}.${direction}[${index}]`, dropped));
            }
            if (dropped.length > before) nested = true;
            return [id, cleaned];
          }),
        )
      : actions;
  if (moved.length === 0 && !nested) return { content: source, moved, dropped };
  const clean = Object.fromEntries(Object.entries(json).filter(([key]) => (CONNECTOR_FILE_FIELDS as readonly string[]).includes(key)));
  if ('actions' in clean) clean['actions'] = cleanedActions;
  return { content: `${JSON.stringify(clean, null, 2)}\n`, ...(moved.length > 0 ? { meta } : {}), moved, dropped };
}

/** The warning for a connector file whose modeler-only fields were moved to `project.json`, and for fields that were dropped. */
export function connectorSplitWarnings(path: string, split: SplitConnector): string[] {
  const key = connectorKeyOf(path);
  const out: string[] = [];
  if (split.moved.length > 0) out.push(`${path}: the field${split.moved.length === 1 ? '' : 's'} ${split.moved.join(', ')} ${split.moved.length === 1 ? 'is' : 'are'} not read by the Activiti runtime and moved to project.json (connectors.${key})`);
  if (split.dropped.length > 0) out.push(`${path}: dropped ${split.dropped.join(', ')}, which the Activiti runtime does not know (its ObjectMapper may reject ${split.dropped.length === 1 ? 'it' : 'them'})`);
  return out;
}

/**
 * Puts a project's connector files in the shape of ADR 0003: every `connectors/*.json` holds only the runtime's fields, what was
 * in it besides moved into `project.json` (`connectors.<name>`, added when the project has none; entries already there win).
 * The input is not changed.
 */
export function normalizeConnectorFiles(files: readonly { path: string; content: string }[]): { files: Array<{ path: string; content: string }>; warnings: string[] } {
  const warnings: string[] = [];
  const moved: Record<string, ConnectorMeta> = {};
  const out = files.map((file) => {
    if (!/^connectors\/[^/]+\.json$/.test(file.path)) return { ...file };
    const split = splitConnectorFile(file.content);
    if (!split) return { ...file };
    warnings.push(...connectorSplitWarnings(file.path, split));
    if (split.meta) moved[connectorKeyOf(file.path)] = split.meta;
    return { path: file.path, content: split.content };
  });
  if (Object.keys(moved).length === 0) return { files: out, warnings };
  const index = out.findIndex((f) => f.path === 'project.json');
  let project = index >= 0 ? out[index]!.content : undefined;
  const existing = readConnectorMeta(project);
  try {
    for (const [key, meta] of Object.entries(moved)) project = writeConnectorMeta(project, key, { ...meta, ...(existing[key] ?? {}) });
  } catch (e) {
    warnings.push(`${e instanceof Error ? e.message : String(e)} The fields of the connector files could not be moved there.`);
    return { files: files.map((f) => ({ ...f })), warnings };
  }
  if (index >= 0) out[index] = { path: 'project.json', content: project! };
  else out.push({ path: 'project.json', content: project! });
  return { files: out, warnings };
}

export interface ConnectorProblem {
  severity: 'error' | 'warning';
  /** Where: `name`, `version`, `actions.SEND`, `actions.SEND.inputs[0].name`, `config[1].name`. */
  path: string;
  message: string;
}

/**
 * What is wrong with a connector file: the name rules (pattern of the schema, unique in the project, no dot), the action ids (no dot,
 * unique), typed parameters (known type, unique names) and the configuration. `otherNames` are the names of the project's other connectors.
 */
export function validateConnector(model: ConnectorModel, otherNames: readonly string[] = []): ConnectorProblem[] {
  const problems: ConnectorProblem[] = [];
  const error = (path: string, message: string): void => void problems.push({ severity: 'error', path, message });
  const warning = (path: string, message: string): void => void problems.push({ severity: 'warning', path, message });

  if (!model.name) error('name', 'The connector needs a name.');
  else if (model.name.includes('.')) error('name', `The connector name "${model.name}" must not contain a dot: the dot separates the connector from its action (<connector>.<ACTION>).`);
  else if (model.name.length > 26) error('name', `The connector name has ${model.name.length} characters, the limit is 26.`);
  else if (!CONNECTOR_NAME_PATTERN.test(model.name)) error('name', `The connector name "${model.name}" must start with a lower-case letter and then use only lower-case letters, digits and hyphens, not ending with a hyphen (${CONNECTOR_NAME_PATTERN.source}).`);
  if (model.name && otherNames.includes(model.name)) error('name', `Another connector of the project is already named "${model.name}": connector names must be unique.`);
  if (model.version !== undefined && model.version.trim() === '') error('version', 'The version must not be empty (leave the field out instead).');

  const checkFeatures = (kind: 'actions' | 'events', features: Record<string, ConnectorAction>): void => {
    for (const [key, action] of Object.entries(features)) {
      const where = `${kind}.${key}`;
      if (!action.id) error(where, `An ${kind === 'actions' ? 'action' : 'event'} needs an id.`);
      else if (!CONNECTOR_ACTION_PATTERN.test(action.id)) {
        error(`${where}.id`, action.id.includes('.') ? `The ${kind === 'actions' ? 'action' : 'event'} id "${action.id}" must not contain a dot.` : `The ${kind === 'actions' ? 'action' : 'event'} id "${action.id}" must start with a letter and use only letters, digits, "_" and "-".`);
      }
      if (!action.name) error(`${where}.name`, 'The name is required by the connector schema.');
      for (const direction of ['inputs', 'outputs'] as const) {
        const names = new Set<string>();
        action[direction].forEach((p, index) => {
          const at = `${where}.${direction}[${index}]`;
          if (!p.name) error(`${at}.name`, `An ${direction === 'inputs' ? 'input' : 'output'} needs a name.`);
          else if (names.has(p.name)) error(`${at}.name`, `The ${direction === 'inputs' ? 'input' : 'output'} "${p.name}" is declared twice.`);
          names.add(p.name);
          if (!p.id) error(`${at}.id`, 'The id is required by the connector schema.');
          if (!(CONNECTOR_PARAMETER_TYPES as readonly string[]).includes(p.type)) error(`${at}.type`, `The type "${p.type}" is not one of ${CONNECTOR_PARAMETER_TYPES.join(', ')}.`);
        });
      }
    }
  };
  checkFeatures('actions', model.actions);
  checkFeatures('events', model.events);
  const ids = Object.values(model.actions).map((a) => a.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) error(`actions.${id}`, `The action "${id}" is declared twice.`);
  if (Object.keys(model.actions).length === 0) warning('actions', 'The connector has no action: no service task can call it.');
  const configNames = new Set<string>();
  model.config.forEach((c, index) => {
    if (!c.name) error(`config[${index}].name`, 'A configuration entry needs a name.');
    else if (configNames.has(c.name)) error(`config[${index}].name`, `The configuration entry "${c.name}" is declared twice.`);
    configNames.add(c.name);
  });
  for (const key of model.legacyFields ?? []) warning(key, `The field "${key}" is not read by the Activiti runtime, whose ObjectMapper may reject it. The modeler moves it to project.json (connectors.${model.name || '<name>'}) when you save.`);
  return problems;
}

/** The next version after `version`: `1` gives `2`, `1.2` gives `1.3`, a missing version gives `1`. */
export function bumpVersion(version: string | undefined): string {
  if (version === undefined || version.trim() === '') return '1';
  const match = /^(.*?)(\d+)$/.exec(version.trim());
  if (!match) return `${version.trim()}.1`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

/** `<connector>.<ACTION>` split at the first dot; `action` is missing when there is no dot. */
export function splitImplementation(implementation: string): { connector: string; action?: string } {
  const dot = implementation.indexOf('.');
  return dot < 0 ? { connector: implementation } : { connector: implementation.slice(0, dot), action: implementation.slice(dot + 1) };
}
