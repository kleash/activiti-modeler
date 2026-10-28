/**
 * Typed variable rows, as the start form, the task completion form and the variables tab edit them. The types are those of the
 * process variables of the extensions file (ADR 0003) plus `auto`, which infers the JSON type from the text.
 */

export const VARIABLE_TYPES = ['auto', 'string', 'integer', 'bigdecimal', 'boolean', 'json', 'array', 'date', 'datetime'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface VariableRow {
  /** Stable key for React. */
  key: string;
  name: string;
  type: VariableType;
  /** The text in the input field. */
  text: string;
  /** Declared in the process' extensions file. */
  declared?: boolean;
  required?: boolean;
  description?: string;
}

export type Converted = { ok: true; value: unknown } | { ok: false; error: string };

let counter = 0;
export const newRowKey = (): string => `row-${++counter}`;

export function emptyRow(partial: Partial<VariableRow> = {}): VariableRow {
  return { key: newRowKey(), name: '', type: 'auto', text: '', ...partial };
}

/** The text a stored value is shown as in an input field. */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The type that fits a JSON value best. */
export function typeOf(value: unknown): VariableType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'bigdecimal';
  if (Array.isArray(value)) return 'array';
  return value === null || value === undefined ? 'auto' : 'json';
}

/** Maps a type name of a process property (`string`, `integer`, `file`, ...) to an editor type. */
export function editorTypeOf(propertyType: string | undefined): VariableType {
  switch ((propertyType ?? '').toLowerCase()) {
    case 'string':
      return 'string';
    case 'integer':
    case 'int':
    case 'long':
      return 'integer';
    case 'bigdecimal':
    case 'double':
    case 'number':
      return 'bigdecimal';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'json':
    case 'file':
    case 'folder':
    case 'content':
      return 'json';
    default:
      return 'auto';
  }
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const INTEGER = /^[-+]?\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[-+]\d{2}:?\d{2})?$/;

/** Converts the text of a row to the JSON value the API takes. */
export function convert(type: VariableType, text: string): Converted {
  const trimmed = text.trim();
  switch (type) {
    case 'string':
      return { ok: true, value: text };
    case 'integer':
      return INTEGER.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false, error: 'not an integer' };
    case 'bigdecimal':
      return NUMBER.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false, error: 'not a number' };
    case 'boolean':
      return trimmed === 'true' || trimmed === 'false' ? { ok: true, value: trimmed === 'true' } : { ok: false, error: 'must be true or false' };
    case 'date':
      return DATE.test(trimmed) ? { ok: true, value: trimmed } : { ok: false, error: 'use yyyy-mm-dd' };
    case 'datetime':
      return DATETIME.test(trimmed) ? { ok: true, value: trimmed } : { ok: false, error: 'use an ISO date and time, e.g. 2030-01-31T09:30:00Z' };
    case 'json':
    case 'array': {
      try {
        const value: unknown = JSON.parse(trimmed);
        if (type === 'array' && !Array.isArray(value)) return { ok: false, error: 'must be a JSON array' };
        return { ok: true, value };
      } catch {
        return { ok: false, error: 'not valid JSON' };
      }
    }
    case 'auto': {
      if (trimmed === '') return { ok: true, value: '' };
      if (trimmed === 'true' || trimmed === 'false') return { ok: true, value: trimmed === 'true' };
      if (trimmed === 'null') return { ok: true, value: null };
      if (NUMBER.test(trimmed)) return { ok: true, value: Number(trimmed) };
      if (/^[[{"]/.test(trimmed)) {
        try {
          return { ok: true, value: JSON.parse(trimmed) as unknown };
        } catch {
          return { ok: true, value: text };
        }
      }
      return { ok: true, value: text };
    }
  }
}

export interface RowsResult {
  variables: Record<string, unknown>;
  /** Problems by row key. */
  errors: Record<string, string>;
}

/** The variables of the rows (rows without a name and without text are ignored; a required row must have a value). */
export function rowsToVariables(rows: readonly VariableRow[]): RowsResult {
  const variables: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name === '' && row.text.trim() === '') continue;
    if (name === '') {
      errors[row.key] = 'give the variable a name';
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
      errors[row.key] = 'a variable name uses letters, digits, "_", "." and "-"';
      continue;
    }
    if (name.startsWith('_')) {
      errors[row.key] = 'names that start with an underscore are refused by the engine';
      continue;
    }
    if (seen.has(name)) {
      errors[row.key] = `${name} is listed twice`;
      continue;
    }
    seen.add(name);
    if (row.required && row.text.trim() === '') {
      errors[row.key] = 'required';
      continue;
    }
    if (row.text.trim() === '' && row.type !== 'string' && row.type !== 'auto') {
      if (row.required) errors[row.key] = 'required';
      // an empty optional value is not sent: the declared default (or nothing) applies
      continue;
    }
    if (row.text === '' && row.type === 'auto') {
      if (row.required) errors[row.key] = 'required';
      continue;
    }
    const converted = convert(row.type, row.text);
    if (converted.ok) variables[name] = converted.value;
    else errors[row.key] = converted.error;
  }
  return { variables, errors };
}

/** One declared process property of an extensions entry. */
export interface PropertyLike {
  name?: string;
  type?: string;
  required?: boolean;
  description?: string;
  value?: unknown;
}

/** The rows for the declared properties of a process (the `extensions` of `getProcessDefinitionExtensions`). */
export function rowsForProperties(entry: unknown): VariableRow[] {
  const properties = (entry as { properties?: Record<string, PropertyLike> } | null | undefined)?.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.values(properties)
    .filter((p): p is PropertyLike & { name: string } => typeof p?.name === 'string' && p.name !== '')
    .map((p) =>
      emptyRow({
        name: p.name,
        type: editorTypeOf(p.type),
        // the default is shown, not sent: a row whose text is the default is left out by the form (see `withoutDefaults`)
        text: p.value === undefined ? '' : textOf(p.value),
        declared: true,
        ...(p.required ? { required: true } : {}),
        ...(p.description ? { description: p.description } : {}),
      }),
    );
}

/** The rows as variables, without the values that are just the declared defaults (the engine applies those itself). */
export function variablesWithoutDefaults(rows: readonly VariableRow[], defaults: readonly VariableRow[]): RowsResult {
  const result = rowsToVariables(rows);
  for (const d of defaults) {
    const row = rows.find((r) => r.name === d.name);
    if (row && row.text === d.text && !d.required) delete result.variables[d.name];
  }
  return result;
}
