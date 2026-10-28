// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { inputsKey, literalText, loadInputs, parseInput, saveInputs } from './inputs';

describe('parseInput', () => {
  it('types the text by the FEEL type of the input', () => {
    expect(parseInput('number', ' 42 ')).toEqual({ value: 42 });
    expect(parseInput('number', '3.5')).toEqual({ value: 3.5 });
    expect(parseInput('number', 'abc')).toEqual({ error: '"abc" is not a number' });
    expect(parseInput('boolean', 'true')).toEqual({ value: true });
    expect(parseInput('boolean', 'yes')).toEqual({ error: 'enter true or false' });
    expect(parseInput('string', ' DE ')).toEqual({ value: ' DE ' });
    expect(parseInput('date', '2026-10-27')).toEqual({ value: '2026-10-27' });
    expect(parseInput('date', '27.10.2026')).toEqual({ error: 'use the form 2026-10-27' });
    expect(parseInput('date and time', '2026-10-27T14:30:00')).toEqual({ value: '2026-10-27T14:30:00' });
    expect(parseInput('time', '14:30')).toEqual({ value: '14:30' });
    expect(parseInput('Any', '[1,2]')).toEqual({ value: [1, 2] });
    expect(parseInput('Any', 'hello')).toEqual({ value: 'hello' });
  });

  it('leaves out an empty field: the variable is then null in FEEL', () => {
    expect(parseInput('number', '')).toEqual({ omit: true });
    expect(parseInput('string', '   ')).toEqual({ omit: true });
  });

  it('reads the text of a FEEL string literal', () => {
    expect(literalText('"gold"')).toBe('gold');
    expect(literalText('"a\\"b"')).toBe('a"b');
    expect(literalText('10')).toBe('10');
  });
});

describe('remembered inputs', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps what was typed per file and decision, and starts empty for another file', () => {
    const key = inputsKey('shop', 'processes/risk.dmn');
    saveInputs(key, { decision: 'riskLevel', inputs: { riskLevel: { age: '19', region: 'DE' } } });
    expect(loadInputs(key)).toEqual({ decision: 'riskLevel', inputs: { riskLevel: { age: '19', region: 'DE' } } });
    expect(loadInputs(inputsKey('shop', 'processes/other.dmn'))).toEqual({ inputs: {} });
  });

  it('survives garbage and storage that throws', () => {
    const key = inputsKey('p', 'a.dmn');
    window.localStorage.setItem(key, '{not json');
    expect(loadInputs(key)).toEqual({ inputs: {} });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(() => saveInputs(key, { inputs: {} })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
