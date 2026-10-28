import type { FieldInput } from '@activiti-modeler/bpmn-js-activiti';

import type { Row, RowColumn } from '../components/RowsEntry';

/** `activiti:field` rows: a name and a text that is a literal or an expression. */
export const FIELD_COLUMNS: RowColumn[] = [
  { key: 'name', kind: 'text', label: 'Field name', placeholder: 'tag' },
  { key: 'kind', kind: 'select', label: 'Value type', options: [{ value: 'string', label: 'Text' }, { value: 'expression', label: 'Expression' }] },
  {
    key: 'value',
    kind: 'text',
    label: 'Value',
    validate: (value, row) => (row['kind'] !== 'expression' && value && /[$#]\{/.test(value) ? { severity: 'warning', message: 'A text value is not evaluated. Choose "Expression" to evaluate ${...}.' } : undefined),
  },
];

export const fieldRow = (f: FieldInput): Row => ({ name: f.name, kind: f.expression !== undefined ? 'expression' : 'string', value: f.expression ?? f.string ?? '' });

export const fieldFromRow = (row: Row): FieldInput => {
  const name = String(row['name'] ?? '');
  const value = String(row['value'] ?? '');
  return row['kind'] === 'expression' ? { name, expression: value } : { name, string: value };
};

export const blankField = (): Row => ({ name: '', kind: 'string', value: '' });

export const missingField = (row: Row): string | undefined => (!row['name'] ? 'A field needs a name' : !row['value'] ? `Field "${String(row['name'])}" needs a value` : undefined);
