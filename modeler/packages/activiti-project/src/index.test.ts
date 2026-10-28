import { describe, expect, it } from 'vitest';

import { classifyFile, extensionsPathFor } from './index';

describe('classifyFile', () => {
  it.each([
    ['processes/loan.bpmn20.xml', 'bpmn'],
    ['processes/loan.bpmn', 'bpmn'],
    ['processes/loan-extensions.json', 'extensions'],
    ['processes/risk.dmn', 'dmn'],
    ['scenarios/happy.scenario.json', 'scenario'],
    ['connectors/mail.json', 'connector'],
    ['README.md', 'other'],
  ] as const)('%s is %s', (path, kind) => {
    expect(classifyFile(path)).toBe(kind);
  });
});

describe('extensionsPathFor', () => {
  it('names the sidecar next to the process file', () => {
    expect(extensionsPathFor('processes/loan.bpmn20.xml')).toBe('processes/loan-extensions.json');
    expect(extensionsPathFor('loan.bpmn')).toBe('loan-extensions.json');
  });

  it('rejects other files', () => {
    expect(() => extensionsPathFor('risk.dmn')).toThrow('Not a BPMN file path');
  });
});
