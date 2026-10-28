import { describe, expect, it } from 'vitest';

import { assembleProject } from './assemble';
import { emptyExtensionsFile } from './extensions';
import { ExportVerificationError } from './verify';

const GOOD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="s" />
  </bpmn:process>
</bpmn:definitions>
`;

const fixedNow = (): Date => new Date('2026-10-26T12:00:00.000Z');

describe('assembleProject', () => {
  it('lays the files out as in ADR 0003', () => {
    const { files } = assembleProject({
      name: 'loans',
      now: fixedNow,
      processes: [{ name: 'loan', xml: GOOD_XML, extensions: emptyExtensionsFile('loan', 'Process_1') }],
      dmn: [{ name: 'risk', content: '<definitions/>' }],
      connectors: [{ name: 'mail', content: '{}' }],
    });
    expect(files.map((f) => f.path)).toEqual([
      'project.json',
      'processes/loan.bpmn20.xml',
      'processes/loan-extensions.json',
      'processes/risk.dmn',
      'connectors/mail.json',
    ]);
    expect(JSON.parse(files[0]!.content)).toEqual({ name: 'loans', version: '1.0.0', activiti: '9.0.0', created: '2026-10-26T12:00:00.000Z', modified: '2026-10-26T12:00:00.000Z' });
    expect(files[1]!.content).toBe(GOOD_XML);
    expect(JSON.parse(files[2]!.content)).toEqual({ id: 'process-loan', extensions: { Process_1: { properties: {}, mappings: {}, constants: {} } } });
    expect(files[3]!.content).toBe('<definitions/>');
  });

  it('accepts extensions as text, drops fields the runtime does not know and says so', () => {
    const { files, warnings } = assembleProject({ name: 'p', processes: [{ name: 'a', xml: GOOD_XML, extensions: '{"id":"x","extra":1,"extensions":{}}' }] });
    expect(JSON.parse(files[2]!.content)).toEqual({ id: 'x', extensions: {} });
    expect(warnings).toEqual(['a-extensions.json: dropped field $.extra, which Activiti 9.0.0 does not know (its ObjectMapper may reject it)']);
  });

  it('refuses to produce any file when a BPMN breaks a guarantee', () => {
    expect(() => assembleProject({ name: 'p', processes: [{ name: 'a', xml: GOOD_XML.replace('"true"', '"false"'), extensions: emptyExtensionsFile('a') }] })).toThrow(ExportVerificationError);
  });

  it.each([['bad name'], ['../x'], ['a/b'], ['']])('rejects the file name %j', (name) => {
    expect(() => assembleProject({ name: 'p', processes: [{ name, xml: GOOD_XML, extensions: emptyExtensionsFile('a') }] })).toThrow('Invalid process file name');
  });

  it('rejects duplicates and connector names with a dot', () => {
    const process = { name: 'a', xml: GOOD_XML, extensions: emptyExtensionsFile('a') };
    expect(() => assembleProject({ name: 'p', processes: [process, process] })).toThrow('Duplicate project file');
    expect(() => assembleProject({ name: 'p', processes: [], connectors: [{ name: 'a.b', content: '{}' }] })).toThrow('must not contain a dot');
  });

  describe('connector files (ADR 0003: only the fields the runtime reads)', () => {
    const LEGACY = '{"id":"crm","name":"crm","version":"3","config":[{"name":"url","value":"http://x"}],"actions":{"GO":{"id":"GO","name":"Go","inputs":[],"outputs":[]}}}';

    it('moves the modeler metadata of a descriptor to project.json and says so', () => {
      const { files, warnings } = assembleProject({ name: 'p', now: fixedNow, processes: [], connectors: [{ name: 'crm', content: LEGACY }] });
      const connector = JSON.parse(files.find((f) => f.path === 'connectors/crm.json')!.content) as Record<string, unknown>;
      expect(Object.keys(connector)).toEqual(['id', 'name', 'actions']);
      const project = JSON.parse(files[0]!.content) as Record<string, unknown>;
      expect(project['connectors']).toEqual({ crm: { version: '3', config: [{ name: 'url', value: 'http://x' }] } });
      expect(project['name']).toBe('p');
      expect(warnings).toEqual(['connectors/crm.json: the fields version, config are not read by the Activiti runtime and moved to project.json (connectors.crm)']);
    });

    it('takes explicit metadata, which wins over the descriptor, and leaves a clean project.json alone', () => {
      const { files } = assembleProject({ name: 'p', now: fixedNow, processes: [], connectors: [{ name: 'crm', content: LEGACY }], connectorMeta: { crm: { version: '4' } } });
      expect((JSON.parse(files[0]!.content) as { connectors: Record<string, { version: string }> }).connectors['crm']!.version).toBe('4');
      const clean = assembleProject({ name: 'p', now: fixedNow, processes: [], connectors: [{ name: 'a', content: '{"id":"a","name":"a","actions":{}}' }] });
      expect(JSON.parse(clean.files[0]!.content)).not.toHaveProperty('connectors');
      expect(() => assembleProject({ name: 'p', processes: [], connectorMeta: { ghost: { version: '1' } } })).toThrow('no connectors/ghost.json');
    });
  });
});
