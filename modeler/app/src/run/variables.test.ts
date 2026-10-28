import { describe, expect, it } from 'vitest';

import { convert, editorTypeOf, emptyRow, rowsForProperties, rowsToVariables, textOf, typeOf, variablesWithoutDefaults } from './variables';

describe('convert', () => {
  it('converts by type', () => {
    expect(convert('string', ' a ')).toEqual({ ok: true, value: ' a ' });
    expect(convert('integer', '42')).toEqual({ ok: true, value: 42 });
    expect(convert('integer', '4.2')).toEqual({ ok: false, error: 'not an integer' });
    expect(convert('bigdecimal', '12.50')).toEqual({ ok: true, value: 12.5 });
    expect(convert('boolean', 'true')).toEqual({ ok: true, value: true });
    expect(convert('boolean', 'yes').ok).toBe(false);
    expect(convert('json', '{"a":[1]}')).toEqual({ ok: true, value: { a: [1] } });
    expect(convert('array', '{"a":1}').ok).toBe(false);
    expect(convert('array', '["x"]')).toEqual({ ok: true, value: ['x'] });
    expect(convert('date', '2030-05-17')).toEqual({ ok: true, value: '2030-05-17' });
    expect(convert('date', '17.5.2030').ok).toBe(false);
    expect(convert('datetime', '2030-05-17T10:15:30Z').ok).toBe(true);
  });

  it('infers the type of "auto"', () => {
    expect(convert('auto', '5000')).toEqual({ ok: true, value: 5000 });
    expect(convert('auto', 'true')).toEqual({ ok: true, value: true });
    expect(convert('auto', 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(convert('auto', '[1,2]')).toEqual({ ok: true, value: [1, 2] });
    expect(convert('auto', '{broken')).toEqual({ ok: true, value: '{broken' });
  });
});

describe('rowsToVariables', () => {
  it('collects variables and reports errors by row', () => {
    const rows = [
      emptyRow({ name: 'amount', type: 'integer', text: '5000' }),
      emptyRow({ name: 'bad', type: 'integer', text: 'x' }),
      emptyRow({ name: '_hidden', text: '1' }),
      emptyRow({ name: 'amount', text: '1' }),
      emptyRow({ name: '', text: '' }),
      emptyRow({ name: '', text: 'orphan' }),
    ];
    const { variables, errors } = rowsToVariables(rows);
    expect(variables).toEqual({ amount: 5000 });
    expect(Object.values(errors)).toEqual(['not an integer', 'names that start with an underscore are refused by the engine', 'amount is listed twice', 'give the variable a name']);
  });

  it('reports an empty required string too', () => {
    const rows = [emptyRow({ name: 'orderId', type: 'string', text: '', required: true }), emptyRow({ name: 'note', type: 'string', text: '' })];
    const { errors, variables } = rowsToVariables(rows);
    expect(errors[rows[0]!.key]).toBe('required');
    expect(variables).toEqual({ note: '' });
  });

  it('leaves an empty optional value out and reports an empty required one', () => {
    const rows = [emptyRow({ name: 'a', type: 'integer', text: '' }), emptyRow({ name: 'b', type: 'integer', text: '', required: true })];
    const { variables, errors } = rowsToVariables(rows);
    expect(variables).toEqual({});
    expect(errors[rows[1]!.key]).toBe('required');
  });
});

describe('declared properties', () => {
  const entry = { properties: { p1: { id: 'p1', name: 'orderId', type: 'string', required: true }, p2: { id: 'p2', name: 'count', type: 'integer', value: 7 }, p3: { id: 'p3', name: 'config', type: 'json', value: { a: 1 } } } };

  it('prefills rows with the declared type and default', () => {
    const rows = rowsForProperties(entry);
    expect(rows.map((r) => [r.name, r.type, r.text, r.required ?? false])).toEqual([
      ['orderId', 'string', '', true],
      ['count', 'integer', '7', false],
      ['config', 'json', '{"a":1}', false],
    ]);
    expect(rowsForProperties(undefined)).toEqual([]);
  });

  it('does not send a default the person left alone', () => {
    const defaults = rowsForProperties(entry);
    const rows = defaults.map((r) => (r.name === 'orderId' ? { ...r, text: 'A-1' } : r));
    expect(variablesWithoutDefaults(rows, defaults).variables).toEqual({ orderId: 'A-1' });
  });
});

describe('helpers', () => {
  it('shows values as text and finds their type', () => {
    expect(textOf({ a: 1 })).toBe('{"a":1}');
    expect(textOf('x')).toBe('x');
    expect(textOf(undefined)).toBe('');
    expect(typeOf(3)).toBe('integer');
    expect(typeOf(3.5)).toBe('bigdecimal');
    expect(typeOf([1])).toBe('array');
    expect(typeOf({})).toBe('json');
    expect(editorTypeOf('FILE')).toBe('json');
  });
});
