import type { VariableUse } from '@activiti-modeler/bpmn-js-activiti';
import { VARIABLE_TYPES, type ProcessVariableDefinition } from '@activiti-modeler/activiti-project';

import { group, type Definition, type EntryBuilder } from '../builders';
import type { Row, RowColumn } from '../components/RowsEntry';
import { variableNameProblem } from '../validation/ids';
import { type Diagnostic, error } from '../validation/types';

const TYPE_LABELS: Record<string, string> = {
  boolean: 'boolean',
  string: 'string',
  integer: 'integer',
  bigdecimal: 'bigdecimal (a decimal number)',
  json: 'json (any JSON value)',
  file: 'file (a content reference)',
  folder: 'folder (a content reference)',
  content: 'content (a content reference)',
  date: 'date',
  datetime: 'datetime',
  array: 'array (a JSON list)',
};

const TRISTATE = [{ value: '', label: 'Not set' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }];
const JSON_TYPES = ['json', 'file', 'folder', 'content', 'array'];
const isExpression = (text: string): boolean => /\$\{[^}]*\}/.test(text);
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An id for a variable that is not in the file yet: the row keeps it, so that the file and the row agree on it from the first write. */
const newVariableId = (): string => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `v-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`);

/** The default value of a variable as the text of the field. */
export function defaultToText(variable: Pick<ProcessVariableDefinition, 'type' | 'value'>): string {
  const { value, type } = variable;
  if (value === undefined || value === null) return '';
  if (JSON_TYPES.includes(String(type))) return typeof value === 'string' && isExpression(value) ? value : JSON.stringify(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** What is wrong with a default value for the type (the engine rejects or mishandles it); undefined when it fits. */
export function defaultProblem(type: string, text: string): Diagnostic | undefined {
  if (text === '' || isExpression(text)) return undefined;
  switch (type) {
    case 'boolean':
      return text === 'true' || text === 'false' ? undefined : error('A boolean default is true or false (or an expression).');
    case 'integer':
      return /^-?\d+$/.test(text) ? undefined : error('An integer default is a whole number such as 7 (or an expression).');
    case 'bigdecimal':
      return text.trim() !== '' && !Number.isNaN(Number(text)) ? undefined : error('A bigdecimal default is a number such as 12.50 (or an expression).');
    case 'date':
    case 'datetime':
      return ISO.test(text) ? undefined : error(`A ${type} default is an ISO 8601 ${type === 'date' ? 'date such as 2030-05-17' : 'date-time such as 2030-05-17T10:15:30Z'} (or an expression).`);
    case 'string':
      return undefined;
    default: {
      if (!JSON_TYPES.includes(type)) return undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        return type === 'array' && !Array.isArray(parsed) ? error('An array default is a JSON list such as ["a", "b"].') : undefined;
      } catch {
        return error(`A ${type} default is JSON, for example ${type === 'array' ? '["a", "b"]' : '{ "id": "f-1" }'} (or an expression).`);
      }
    }
  }
}

/** The typed default for the text of the field (the text must pass `defaultProblem`). */
export function defaultFromText(type: string, text: string): unknown {
  if (text === '') return undefined;
  if (isExpression(text)) return text;
  switch (type) {
    case 'boolean':
      return text === 'true';
    case 'integer':
      return Number(text);
    case 'bigdecimal':
      // keep the exact text of a decimal that a number would reformat (12.50)
      return String(Number(text)) === text.trim() ? Number(text) : text.trim();
    case 'string':
    case 'date':
    case 'datetime':
      return text;
    default:
      return JSON_TYPES.includes(type) ? (JSON.parse(text) as unknown) : text;
  }
}

const triState = (value: boolean | undefined): string => (value === undefined ? '' : String(value));
const fromTriState = (value: unknown): boolean | undefined => (value === 'true' ? true : value === 'false' ? false : undefined);

const placeholderFor = (row: Row): string | undefined => {
  switch (row['type']) {
    case 'boolean': return 'true';
    case 'integer': return '7';
    case 'bigdecimal': return '12.50';
    case 'date': return '2030-05-17';
    case 'datetime': return '2030-05-17T10:15:30Z';
    case 'json': return '{ "retries": 3 }';
    case 'array': return '["a", "b"]';
    case 'file': case 'folder': case 'content': return '{ "id": "f-1" }';
    default: return 'initial value, or ${expression}';
  }
};

const defaultHint = (row: Row): string | undefined => {
  const type = String(row['type']);
  if (JSON_TYPES.includes(type) && !row['value']) return 'A property of this type without a default starts as a variable that holds JSON null (engine finding 4). Give it a default to avoid that.';
  if (type === 'string' && /^\s*[$#]\{/.test(String(row['value'] ?? ''))) return 'The expression is resolved against the start variables when the process starts.';
  return undefined;
};

export const VARIABLE_COLUMNS: RowColumn[] = [
  { key: 'name', kind: 'text', label: 'Name', placeholder: 'orderId', validate: (v) => (v ? variableNameProblem(v) : undefined) },
  { key: 'type', kind: 'select', label: 'Type', options: VARIABLE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t })) },
  { key: 'required', kind: 'check', label: 'Required: a start without it is rejected' },
  { key: 'value', kind: 'text', label: 'Default value', placeholder: placeholderFor, hint: defaultHint, validate: (v, row) => defaultProblem(String(row['type']), v ?? '') },
  { key: 'description', kind: 'text', label: 'Description' },
  { key: 'displayName', kind: 'text', label: 'Display name', advanced: true },
  { key: 'display', kind: 'select', label: 'Display', options: TRISTATE, advanced: true },
  { key: 'analytics', kind: 'select', label: 'Analytics', options: TRISTATE, advanced: true },
  { key: 'ephemeral', kind: 'select', label: 'Ephemeral', options: TRISTATE, advanced: true },
];

export const variableToRow = (v: ProcessVariableDefinition): Row => ({
  id: v.id,
  name: v.name,
  type: String(v.type),
  required: v.required === true,
  value: defaultToText(v),
  description: v.description ?? '',
  displayName: v.displayName ?? '',
  display: triState(v.display),
  analytics: triState(v.analytics),
  ephemeral: triState(v.ephemeral),
});

export function variableFromRow(row: Row): ProcessVariableDefinition {
  const type = String(row['type']);
  const text = (key: string): string | undefined => (row[key] === '' || row[key] === undefined ? undefined : String(row[key]));
  // every field is given, so that a cleared one is removed from the stored variable
  return {
    id: String(row['id'] ?? '') || (undefined as never),
    name: String(row['name']),
    type,
    required: row['required'] === true,
    value: defaultFromText(type, String(row['value'] ?? '')),
    description: text('description'),
    displayName: text('displayName'),
    display: fromTriState(row['display']),
    analytics: fromTriState(row['analytics']),
    ephemeral: fromTriState(row['ephemeral']),
  };
}

const elementsOf = (uses: VariableUse[]): string => [...new Set(uses.map((u) => u.elementId))].join(', ');

/** The process variables: a typed list with default values checked against the type, and a warning before a variable that mappings use is removed. */
export function variablesGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'variables.list')) return [];
  const variables = env.get<ProcessVariableDefinition[]>(element, 'variables.list');
  const usage = env.get<Record<string, VariableUse[]>>(element, 'variables.usage');
  const entries: Definition[] = [
    b.info(
      'variables.list.hint',
      'Declare the variables of the process with a type and, if you like, a default. Output mappings can only write declared variables (the engine drops the others), so the modeler declares their targets for you. Declared defaults are created when an instance starts; a start payload is checked against the types, and a required variable that is missing rejects the start.',
      'info',
      'variables.list',
    ),
    b.info('variables.metadata.hint', 'Display, display name, analytics and ephemeral are kept in the file but Activiti 9.0.0 does nothing with them, and its variable model has no category, so the modeler cannot store one.', 'info', 'variables.list'),
    b.rowsRaw({
      id: 'variables.list',
      label: 'Variables',
      help: 'variables.list',
      addLabel: 'Add variable',
      rows: variables.map(variableToRow),
      columns: VARIABLE_COLUMNS,
      blank: () => ({ id: newVariableId(), name: '', type: 'string', required: false, value: '', description: '', displayName: '', display: '', analytics: '', ephemeral: '' }),
      missing: (row, rows) => {
        const name = String(row['name'] ?? '');
        if (!name) return 'A variable needs a name';
        const nameProblem = variableNameProblem(name);
        if (nameProblem) return nameProblem.message;
        if (rows.findIndex((r) => r['name'] === name) !== rows.indexOf(row)) return `The variable "${name}" is declared twice`;
        const problem = defaultProblem(String(row['type']), String(row['value'] ?? ''));
        return problem?.severity === 'error' ? problem.message : undefined;
      },
      commit: (rows) => void env.write(element, 'variables.list', rows.map(variableFromRow), 'variables.list'),
      rowTitle: (row) => String(row['name'] ?? ''),
      reorder: true,
      confirmRemove: (row) => {
        const uses = usage[String(row['name'])] ?? [];
        const targets = uses.filter((u) => u.as === 'output');
        const readers = uses.filter((u) => u.as === 'input');
        if (targets.length > 0) return `"${String(row['name'])}" is the target of the output mapping of ${elementsOf(targets)}. Without the declaration the engine silently drops that output.`;
        if (readers.length > 0) return `"${String(row['name'])}" is read by the input mapping of ${elementsOf(readers)}.`;
        return undefined;
      },
    }),
  ];
  const json = variables.filter((v) => JSON_TYPES.includes(String(v.type)) && (v.value === undefined || v.value === null));
  if (json.length > 0) {
    entries.push(
      b.info('variables.json.hint', `${json.map((v) => v.name).join(', ')} ${json.length === 1 ? 'has' : 'have'} no default: ${json.length === 1 ? 'it starts' : 'they start'} as a variable holding JSON null, and a MAP_ALL mapping passes that null on.`, 'warning', 'variables.list'),
    );
  }
  return [group({ id: 'variables', label: 'Process variables', entries })];
}

