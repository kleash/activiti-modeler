import { describe, expect, it } from 'vitest';

import {
  bumpVersion, CONNECTOR_ACTION_FIELDS, CONNECTOR_FILE_FIELDS, CONNECTOR_VARIABLE_FIELDS, connectorMetaOf, connectorSplitWarnings, emptyConnector, normalizeConnectorFiles, parseConnectorModel, readConnectorMeta,
  serializeConnector, splitConnectorFile, splitImplementation, validateConnector, writeConnectorMeta,
} from './connectors';

const CRM = `{
  "id": "crm",
  "name": "crm",
  "description": "Customer lookups",
  "actions": {
    "LOOKUP": {
      "id": "LOOKUP",
      "name": "Look up a customer",
      "inputs": [ { "id": "customerId", "name": "customerId", "type": "string", "required": true } ],
      "outputs": [ { "id": "tier", "name": "tier", "type": "string" }, { "id": "found", "name": "found", "type": "boolean" } ]
    }
  }
}`;

describe('connector files', () => {
  it('parses a descriptor and writes it back in a stable shape', () => {
    const model = parseConnectorModel(CRM)!;
    expect(model.name).toBe('crm');
    expect(model.actions['LOOKUP']!.inputs).toEqual([{ id: 'customerId', name: 'customerId', type: 'string', required: true }]);
    const again = parseConnectorModel(serializeConnector(model))!;
    expect(again).toEqual(model);
    expect(serializeConnector(model).endsWith('}\n')).toBe(true);
  });

  it('reads actions given as a list and numbers as a version', () => {
    const model = parseConnectorModel('{"name":"a","version":2,"actions":[{"id":"GO","name":"Go"}]}')!;
    expect(Object.keys(model.actions)).toEqual(['GO']);
    expect(model.version).toBe('2');
  });

  it('is undefined for text that is not a JSON object', () => {
    expect(parseConnectorModel('nope')).toBeUndefined();
    expect(parseConnectorModel('[]')).toBeUndefined();
  });

  it('writes only the fields of the runtime classes, whatever the model carries', () => {
    const model = parseConnectorModel('{"name":"a","version":"3","template":"t","config":[{"name":"k","value":"v"}],"events":{"E":{"id":"E","name":"e"}},"extra":1,"actions":{"GO":{"id":"GO","name":"Go","inputs":[{"id":"x","name":"x","type":"string","display":true,"displayName":"X","analytics":false,"ephemeral":true}]}}}')!;
    const json = JSON.parse(serializeConnector(model)) as Record<string, unknown>;
    expect(Object.keys(json).every((k) => (CONNECTOR_FILE_FIELDS as readonly string[]).includes(k))).toBe(true);
    const action = (json['actions'] as Record<string, Record<string, unknown>>)['GO']!;
    expect(Object.keys(action).every((k) => (CONNECTOR_ACTION_FIELDS as readonly string[]).includes(k))).toBe(true);
    const input = (action['inputs'] as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(input).every((k) => (CONNECTOR_VARIABLE_FIELDS as readonly string[]).includes(k))).toBe(true);
    // the runtime's display, displayName, analytics and ephemeral are kept
    expect(input).toEqual({ id: 'x', name: 'x', type: 'string', display: true, displayName: 'X', analytics: false, ephemeral: true });
  });
});

describe('modeler metadata of a connector (project.json, connectors.<name>)', () => {
  const LEGACY = '{"id":"crm","name":"crm","version":"2","template":"t1","config":[{"name":"url","value":"http://x","required":true}],"events":{"CHANGED":{"id":"CHANGED","name":"changed","inputs":[],"outputs":[]}},"extra":{"a":1},"actions":{"GO":{"id":"GO","name":"Go","inputs":[],"outputs":[]}}}';

  it('moves version, template, config, events and unknown top-level fields out of the file', () => {
    const split = splitConnectorFile(LEGACY)!;
    expect(split.moved).toEqual(['version', 'template', 'config', 'events', 'extra']);
    expect(Object.keys(JSON.parse(split.content) as object)).toEqual(['id', 'name', 'actions']);
    expect(split.meta).toEqual({ version: '2', template: 't1', config: [{ name: 'url', value: 'http://x', required: true }], events: { CHANGED: { id: 'CHANGED', name: 'changed', inputs: [], outputs: [] } }, extra: { a: 1 } });
    expect(connectorSplitWarnings('connectors/crm.json', split)[0]).toContain('moved to project.json (connectors.crm)');
  });

  it('reads the moved fields back through the model: file + project.json give the connector that was split', () => {
    const split = splitConnectorFile(LEGACY)!;
    const whole = parseConnectorModel(LEGACY)!;
    const again = parseConnectorModel(split.content, 'crm', split.meta)!;
    expect(again).toEqual({ ...whole, legacyFields: undefined });
    expect(connectorMetaOf(again)).toEqual(split.meta);
    expect(serializeConnector(again)).toBe(split.content);
  });

  it('leaves a clean file byte for byte', () => {
    expect(splitConnectorFile(CRM)).toEqual({ content: CRM, moved: [], dropped: [] });
  });

  it('drops, and reports, unknown fields inside actions and parameters', () => {
    const split = splitConnectorFile('{"name":"a","actions":{"GO":{"id":"GO","name":"Go","icon":"x","inputs":[{"id":"p","name":"p","type":"string","default":"d"}]}}}')!;
    expect(split.dropped).toEqual(['actions.GO.icon', 'actions.GO.inputs[0].default']);
    expect(split.content).not.toContain('icon');
    expect(connectorSplitWarnings('connectors/a.json', split)[0]).toContain('actions.GO.icon, actions.GO.inputs[0].default');
  });

  it('reads and writes the connectors section of project.json and keeps the other fields', () => {
    const project = '{"name":"p","version":"1.0.0","connectors":{"crm":{"version":"2"}}}';
    expect(readConnectorMeta(project)).toEqual({ crm: { version: '2' } });
    const next = writeConnectorMeta(project, 'mailer', { version: '1' });
    expect(JSON.parse(next)).toEqual({ name: 'p', version: '1.0.0', connectors: { crm: { version: '2' }, mailer: { version: '1' } } });
    expect(JSON.parse(writeConnectorMeta(next, 'crm', undefined))).toEqual({ name: 'p', version: '1.0.0', connectors: { mailer: { version: '1' } } });
    expect(JSON.parse(writeConnectorMeta('{"name":"p","connectors":{"crm":{"version":"2"}}}', 'crm', undefined))).toEqual({ name: 'p' });
    expect(JSON.parse(writeConnectorMeta(undefined, 'crm', { version: '1' }))).toEqual({ connectors: { crm: { version: '1' } } });
    expect(readConnectorMeta('not json')).toEqual({});
    expect(() => writeConnectorMeta('not json', 'crm', { version: '1' })).toThrow('project.json is not valid JSON');
  });

  it('puts a project in the ADR 0003 shape: files clean, metadata in project.json, entries already there win', () => {
    const result = normalizeConnectorFiles([
      { path: 'project.json', content: '{"name":"p","connectors":{"crm":{"version":"5"}}}' },
      { path: 'connectors/crm.json', content: LEGACY },
      { path: 'connectors/clean.json', content: CRM },
      { path: 'processes/x.bpmn20.xml', content: '<x/>' },
    ]);
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]));
    expect(Object.keys(JSON.parse(byPath['connectors/crm.json']!) as object)).toEqual(['id', 'name', 'actions']);
    expect(byPath['connectors/clean.json']).toBe(CRM);
    expect((JSON.parse(byPath['project.json']!) as { connectors: Record<string, { version: string; template: string }> }).connectors['crm']).toMatchObject({ version: '5', template: 't1' });
    expect(result.warnings).toHaveLength(1);
  });

  it('makes a project.json when the project has none, and leaves the files alone when it cannot', () => {
    const made = normalizeConnectorFiles([{ path: 'connectors/crm.json', content: LEGACY }]);
    expect(made.files.map((f) => f.path)).toEqual(['connectors/crm.json', 'project.json']);
    expect(readConnectorMeta(made.files[1]!.content)['crm']).toMatchObject({ version: '2' });
    const broken = normalizeConnectorFiles([{ path: 'project.json', content: '{' }, { path: 'connectors/crm.json', content: LEGACY }]);
    expect(broken.files[1]!.content).toBe(LEGACY);
    expect(broken.warnings.join('\n')).toContain('could not be moved');
  });

  it('warns about the modeler-only fields a file still carries', () => {
    const model = parseConnectorModel('{"name":"a","actions":{},"extra":1}')!;
    expect(model.legacyFields).toEqual(['extra']);
    expect(validateConnector(model).some((p) => p.severity === 'warning' && p.path === 'extra' && p.message.includes('project.json'))).toBe(true);
    expect(validateConnector(parseConnectorModel('{"name":"a","actions":{}}', '', { extra: 1 })!).some((p) => p.path === 'extra')).toBe(false);
  });
});

describe('validateConnector', () => {
  const problems = (json: string, others: string[] = []) => validateConnector(parseConnectorModel(json)!, others).filter((p) => p.severity === 'error');

  it('accepts the seed connector', () => {
    expect(problems(CRM)).toEqual([]);
  });

  it.each([
    ['Mailer', 'lower-case'],
    ['mail.er', 'dot'],
    ['-mailer', 'lower-case'],
    ['mailer-', 'lower-case'],
    ['a'.repeat(27), '26'],
    ['', 'needs a name'],
  ])('refuses the name "%s"', (name, text) => {
    const found = problems(JSON.stringify({ name, actions: { GO: { id: 'GO', name: 'Go' } } }));
    expect(found.find((p) => p.path === 'name')?.message).toContain(text);
  });

  it('accepts names of one to 26 characters', () => {
    expect(problems('{"name":"a","actions":{"GO":{"id":"GO","name":"Go"}}}')).toEqual([]);
    expect(problems(`{"name":"${'a'.repeat(26)}","actions":{"GO":{"id":"GO","name":"Go"}}}`)).toEqual([]);
  });

  it('refuses a name another connector of the project has', () => {
    expect(problems(CRM, ['crm'])[0]!.message).toContain('unique');
  });

  it('refuses an action id with a dot, duplicate parameters and unknown types', () => {
    const found = problems(
      JSON.stringify({
        name: 'x',
        actions: {
          'A.B': { id: 'A.B', name: 'ab', inputs: [{ id: 'p', name: 'p', type: 'string' }, { id: 'p', name: 'p', type: 'decimal' }], outputs: [] },
        },
      }),
    );
    expect(found.map((p) => p.path)).toEqual(expect.arrayContaining(['actions.A.B.id', 'actions.A.B.inputs[1].name', 'actions.A.B.inputs[1].type']));
  });

  it('warns about a connector without actions', () => {
    expect(validateConnector(emptyConnector('empty')).map((p) => p.path)).toEqual(['actions']);
  });
});

describe('helpers', () => {
  it('bumps versions', () => {
    expect(bumpVersion(undefined)).toBe('1');
    expect(bumpVersion('1')).toBe('2');
    expect(bumpVersion('9')).toBe('10');
    expect(bumpVersion('1.4')).toBe('1.5');
    expect(bumpVersion('beta')).toBe('beta.1');
  });

  it('splits an implementation at the first dot', () => {
    expect(splitImplementation('crm.LOOKUP')).toEqual({ connector: 'crm', action: 'LOOKUP' });
    expect(splitImplementation('crm')).toEqual({ connector: 'crm' });
  });
});
