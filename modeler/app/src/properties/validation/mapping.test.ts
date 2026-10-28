import { describe, expect, it } from 'vitest';

import { inputValueDiagnostic, jsonPatchProblem, mappingNameProblem, outputValueDiagnostic, valueFromText, valueToText } from './mapping';

describe('value text', () => {
  it.each([
    ['hello', 'hello'],
    ['42', 42],
    ['0.25', 0.25],
    ['true', true],
    ['null', null],
    ['"42"', '42'],
    ['"a b"', 'a b'],
    ['${tier}', '${tier}'],
    ['${customerName} is ${tier}', '${customerName} is ${tier}'],
    ['[1,2]', [1, 2]],
    ['{"a":1}', { a: 1 }],
    ['Paris, France', 'Paris, France'],
  ])('reads %s', (text, value) => {
    expect(valueFromText(text)).toEqual(value);
  });

  it.each([['hello'], ['${tier}'], [42], [true], [null], ['42'], [{ a: [1] }], [['x']], ['Paris, France']])('round-trips %j', (value) => {
    expect(valueFromText(valueToText(value))).toEqual(value);
  });

  it('shows a text that looks like JSON with quotes', () => {
    expect(valueToText('42')).toBe('"42"');
    expect(valueToText('true')).toBe('"true"');
    expect(valueToText('hello')).toBe('hello');
    expect(valueToText(7)).toBe('7');
    expect(valueToText(undefined)).toBe('');
  });

  it('keeps an empty or blank text as it is', () => {
    expect(valueFromText('')).toBe('');
    expect(valueToText('')).toBe('');
    expect(valueFromText('   ')).toBe('   ');
  });
});

describe('mapping diagnostics', () => {
  it('checks the operations of a JSON patch', () => {
    expect(jsonPatchProblem('[{"op":"add","path":"/a","value":1}]')).toBeUndefined();
    expect(jsonPatchProblem('')?.message).toContain('needs its operations');
    expect(jsonPatchProblem('{}')?.message).toContain('array');
    expect(jsonPatchProblem('[{"op":"add"}]')?.message).toContain('"path"');
    expect(jsonPatchProblem('[{"op":"set","path":"/a"}]')?.message).toContain('one of');
    expect(jsonPatchProblem('[')?.message).toContain('not valid JSON');
  });

  it('refuses expressions in output values, checks them in input values', () => {
    expect(outputValueDiagnostic('${x}')?.severity).toBe('error');
    expect(outputValueDiagnostic('x')).toBeUndefined();
    expect(inputValueDiagnostic('${a + }')?.severity).toBe('error');
    expect(inputValueDiagnostic('${a} x')).toBeUndefined();
  });

  it('warns about names an expression cannot read', () => {
    expect(mappingNameProblem('customerId', 'It')).toBeUndefined();
    expect(mappingNameProblem('customer-id', 'It')?.severity).toBe('warning');
  });
});
