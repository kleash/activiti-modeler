// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { checkBpmnXml, checkExtensionsJson, diagnosticsFromError, offsetOf } from './diagnostics';

const GOOD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" id="D" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:userTask id="T" activiti:assignee="kermit" />
  </bpmn:process>
</bpmn:definitions>
`;

describe('offsetOf', () => {
  it('maps line and column to a document offset', () => {
    const text = 'ab\ncd\nef';
    expect(offsetOf(text, 1, 1)).toBe(0);
    expect(offsetOf(text, 2, 2)).toBe(4);
    expect(offsetOf(text, 3, 2)).toBe(7);
    expect(offsetOf(text, 9, 1)).toBe(text.length);
  });
});

describe('checkBpmnXml', () => {
  it('accepts well-formed BPMN with activiti attributes', async () => {
    expect(await checkBpmnXml(GOOD)).toEqual({ diagnostics: [], warnings: [] });
  });

  it('marks the line and column of a syntax error', async () => {
    const broken = GOOD.replace('<bpmn:userTask id="T" activiti:assignee="kermit" />', '<bpmn:userTask id="T" activiti:assignee=kermit />');
    const { diagnostics } = await checkBpmnXml(broken);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe('error');
    const line = broken.slice(0, diagnostics[0]!.from).split('\n').length;
    expect(line).toBe(4);
    expect(diagnostics[0]!.message.length).toBeGreaterThan(5);
  });

  it('reports a document that is not XML at its start', async () => {
    const { diagnostics } = await checkBpmnXml('this is not xml');
    expect(diagnostics).toHaveLength(1);
    expect('this is not xml'.slice(0, diagnostics[0]!.from)).not.toContain('\n');
  });

  it('marks an unclosed element', async () => {
    const { diagnostics } = await checkBpmnXml(GOOD.replace('</bpmn:process>', ''));
    expect(diagnostics).toHaveLength(1);
  });
});

describe('diagnosticsFromError', () => {
  it('reads moddle style messages', () => {
    const [d] = diagnosticsFromError(new Error('unparsable content <x> detected\n\tline: 2\n\tcolumn: 3\n\tnested error: boom'), 'ab\ncd <x>');
    expect(d!.from).toBe(5);
    expect(d!.message).toBe('unparsable content <x> detected: boom');
  });

  it('puts an error without a position on the first line', () => {
    expect(diagnosticsFromError(new Error('no diagram to display'), 'abc')[0]).toMatchObject({ from: 0, severity: 'error' });
  });
});

describe('checkExtensionsJson', () => {
  const good = JSON.stringify({ id: 'process-x', extensions: { P: { properties: {}, mappings: {}, constants: {} } } }, null, 2);

  it('accepts a valid file without markers', () => {
    expect(checkExtensionsJson(good)).toEqual({ valid: true, diagnostics: [] });
  });

  it('marks a syntax error and is not valid', () => {
    const result = checkExtensionsJson('{\n  "id": "x",\n  "extensions": {,}\n}');
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.severity).toBe('error');
    expect(result.diagnostics[0]!.message).toMatch(/Invalid JSON/);
  });

  it('marks a structure the runtime cannot read', () => {
    expect(checkExtensionsJson('[]').valid).toBe(false);
    expect(checkExtensionsJson('{"id":"x"}').valid).toBe(false);
    expect(checkExtensionsJson('{"extensions":{"P":{"mappings":[]}}}').diagnostics[0]!.message).toContain('extensions.P.mappings must be an object');
  });

  it('warns about fields Activiti 9.0.0 does not know, without blocking', () => {
    const result = checkExtensionsJson('{"id":"x","name":"APA style","extensions":{}}');
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'warning' });
    expect(result.diagnostics[0]!.message).toContain('dropped');
  });
});
