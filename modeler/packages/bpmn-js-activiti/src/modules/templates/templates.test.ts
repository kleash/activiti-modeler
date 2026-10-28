import { parseConnectorModel } from '@activiti-modeler/activiti-project';
import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { exportProcess } from '../../export';
import type { ExtensionsStore } from '../extensions';
import type { PropertyAccessors } from '../accessors';
import { ProjectCatalog } from '../project/ProjectCatalog';
import { ElementTemplates } from './ElementTemplates';
import { buildTemplates, templateIconKind, TEMPLATE_ID_ATTRIBUTE } from './templates';
import type { DiagramElement } from '../../types';

let t: Built | undefined;
afterEach(() => {
  t?.destroy();
  t = undefined;
});

const CRM = (version = '1') =>
  parseConnectorModel(
    JSON.stringify({
      id: 'crm',
      name: 'crm',
      description: 'Customer lookups',
      version,
      actions: {
        LOOKUP: {
          id: 'LOOKUP',
          name: 'Look up a customer',
          inputs: [{ id: 'customerId', name: 'customerId', type: 'string', required: true }],
          outputs: [{ id: 'tier', name: 'tier', type: 'string' }, { id: 'found', name: 'found', type: 'boolean' }, { id: 'profile', name: 'profile', type: 'json' }],
        },
      },
    }),
  )!;

const catalog = (b: Built): ProjectCatalog => b.get<ProjectCatalog>('projectCatalog');
const store = (b: Built): ExtensionsStore => b.get<ExtensionsStore>('extensionsStore');
const templates = (b: Built): ElementTemplates => b.get<ElementTemplates>('elementTemplates');
const accessors = (b: Built): PropertyAccessors => b.get<PropertyAccessors>('propertyAccessors');
const ext = (b: Built) => store(b).getProcess('Process_1')!;
// naming a shape leaves an empty BPMNLabel in the diagram after an undo; it carries no information
const normalize = (xml: string): string => xml.replace(/<bpmndi:BPMNLabel\b[^>]*?(?:\/>|>[\s\S]*?<\/bpmndi:BPMNLabel>)/g, '').replace(/\n\s*\n/g, '\n').replace(/>\s+</g, '><');
const attr = (el: DiagramElement, name: string): unknown => el.businessObject.get(name);

describe('generated element templates', () => {
  it('has the built-ins and one template per connector action', () => {
    const list = buildTemplates([CRM()]);
    expect(list.map((x) => x.id)).toEqual(['builtin/mail', 'builtin/shell', 'builtin/decision', 'builtin/class', 'builtin/expression', 'builtin/delegateExpression', 'crm.LOOKUP']);
    const crm = list.at(-1)!;
    expect(crm).toMatchObject({ version: '1', name: 'crm: Look up a customer', kind: 'connector', category: { id: 'connectors' } });
    expect(crm.icon.contents.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('versions a template with the version of its connector, 1 without one', () => {
    expect(buildTemplates([CRM('7')]).at(-1)!.version).toBe('7');
    const noVersion = CRM();
    delete noVersion.version;
    expect(buildTemplates([noVersion]).at(-1)!.version).toBe('1');
  });

  it('knows the icon kind of a template id', () => {
    expect(templateIconKind('builtin/mail')).toBe('mail');
    expect(templateIconKind('builtin/nonsense')).toBeUndefined();
    expect(templateIconKind('crm.LOOKUP')).toBe('connector');
    expect(templateIconKind(undefined)).toBeUndefined();
  });
});

describe('applying a connector template', () => {
  it('sets the implementation, maps every input and output, declares the output targets and records the link, in one undo step', async () => {
    t = await createBuilt(undefined, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    catalog(t).set({ connectors: [CRM('3')] });
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    const before = (await exportProcess(t.modeler as never, 'p')).xml;
    accessors(t).set('svc', 'template.apply', { id: 'crm.LOOKUP' });
    const svc = t.element('svc');
    expect(svc.businessObject.get('implementation')).toBe('crm.LOOKUP');
    expect(svc.businessObject.get('name')).toBe('Look up a customer');
    expect(attr(svc, TEMPLATE_ID_ATTRIBUTE)).toBe('crm.LOOKUP');
    expect(attr(svc, 'activiti:templateVersion')).toBe('3');
    expect(ext(t).mappings['svc']).toEqual({
      inputs: { customerId: { type: 'VARIABLE', value: 'customerId' } },
      outputs: { tier: { type: 'VARIABLE', value: 'tier' }, found: { type: 'VARIABLE', value: 'found' }, profile: { type: 'VARIABLE', value: 'profile' } },
    });
    // the targets are declared with the types of the action's outputs
    expect(Object.values(ext(t).properties).map((p) => [p.name, p.type])).toEqual([['tier', 'string'], ['found', 'boolean'], ['profile', 'json']]);
    const exported = await exportProcess(t.modeler as never, 'p');
    expect(exported.xml).toContain('activiti:templateId="crm.LOOKUP"');
    expect(exported.xml).toContain('activiti:templateVersion="3"');
    expect(exported.xml).toContain('implementation="crm.LOOKUP"');
    t.commandStack.undo();
    expect(normalize((await exportProcess(t.modeler as never, 'p')).xml)).toBe(normalize(before));
    expect(ext(t)?.mappings['svc']).toBeUndefined();
    expect(Object.keys(ext(t)?.properties ?? {})).toEqual([]);
    t.commandStack.redo();
    expect(t.element('svc').businessObject.get('implementation')).toBe('crm.LOOKUP');
  });

  it('replaces an abstract task by a service task of the same id', async () => {
    t = await createBuilt();
    catalog(t).set({ connectors: [CRM()] });
    t.builder.createShape({ type: 'task', id: 'plain', name: 'Mine' });
    const element = templates(t).applyTemplate(t.element('plain'), 'crm.LOOKUP');
    expect(element.type).toBe('bpmn:ServiceTask');
    expect(element.id).toBe('plain');
    expect(element.businessObject.get('name')).toBe('Mine');
    expect(element.businessObject.get('implementation')).toBe('crm.LOOKUP');
  });

  it('keeps the mapping rows a task already has', async () => {
    t = await createBuilt(undefined, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    catalog(t).set({ connectors: [CRM()] });
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.setProperty('svc', 'mapping.inputs', { customerId: { type: 'VALUE', value: 'C-1' } });
    accessors(t).set('svc', 'template.apply', { id: 'crm.LOOKUP' });
    expect(ext(t).mappings['svc']!.inputs).toEqual({ customerId: { type: 'VALUE', value: 'C-1' } });
  });

  it('refuses an unknown template and a template for another element', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.createShape({ type: 'userTask', id: 'user' });
    expect(() => accessors(t!).set('svc', 'template.apply', { id: 'nope.GO' })).toThrow('no template');
    expect(() => accessors(t!).set('user', 'template.apply', { id: 'builtin/mail' })).toThrow('does not apply');
    expect(() => accessors(t!).set('svc', 'template.apply', {})).toThrow('id of the template');
  });
});

describe('built-in templates', () => {
  it.each([
    ['builtin/mail', 'activiti:type', 'mail'],
    ['builtin/shell', 'activiti:type', 'shell'],
    ['builtin/class', 'activiti:class', ''],
    ['builtin/expression', 'activiti:expression', ''],
    ['builtin/delegateExpression', 'activiti:delegateExpression', ''],
    ['builtin/decision', 'implementation', 'dmn-connector.EXECUTE_TABLE'],
  ])('%s sets %s and links the task', async (id, attribute, value) => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    accessors(t).set('svc', 'template.apply', { id });
    expect(t.element('svc').businessObject.get(attribute)).toBe(value);
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBe(id);
    expect(attr(t.element('svc'), 'activiti:templateVersion')).toBe('1');
  });

  it('the decision template also declares the decision constant', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    accessors(t).set('svc', 'template.apply', { id: 'builtin/decision' });
    expect(ext(t).constants['svc']).toEqual({ _activiti_dmn_table_: { value: '' } });
  });

  it('mail applies to a send task, the others do not', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'sendTask', id: 'send' });
    expect(() => accessors(t!).set('send', 'template.apply', { id: 'builtin/shell' })).toThrow('cannot be applied');
    accessors(t).set('send', 'template.apply', { id: 'builtin/mail' });
    expect(t.element('send').businessObject.get('activiti:type')).toBe('mail');
  });
});

describe('unlink and update', () => {
  const applied = async (version = '1'): Promise<Built> => {
    const b = await createBuilt(undefined, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    catalog(b).set({ connectors: [CRM(version)] });
    b.builder.createShape({ type: 'serviceTask', id: 'svc' });
    accessors(b).set('svc', 'template.apply', { id: 'crm.LOOKUP' });
    return b;
  };

  it('reports current, outdated and unknown', async () => {
    t = await applied('1');
    const info = () => accessors(t!).get<{ state: string; latestVersion?: string }>('svc', 'template.info');
    expect(info()).toMatchObject({ state: 'current', id: 'crm.LOOKUP', version: '1', name: 'crm: Look up a customer' });
    catalog(t).set({ connectors: [CRM('2')] });
    expect(info()).toMatchObject({ state: 'outdated', version: '1', latestVersion: '2' });
    catalog(t).set({ connectors: [] });
    expect(info()).toMatchObject({ state: 'unknown', version: '1' });
  });

  it('updating records the new version and adds the rows of new parameters, keeping the user rows', async () => {
    t = await applied('1');
    t.builder.setProperty('svc', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'cust' } });
    const next = CRM('2');
    next.actions['LOOKUP']!.inputs.push({ id: 'region', name: 'region', type: 'string' });
    next.actions['LOOKUP']!.outputs.push({ id: 'score', name: 'score', type: 'integer' });
    catalog(t).set({ connectors: [next] });
    accessors(t).set('svc', 'template.update', true);
    expect(attr(t.element('svc'), 'activiti:templateVersion')).toBe('2');
    const mapping = ext(t).mappings['svc']!;
    expect(mapping.inputs).toEqual({ customerId: { type: 'VARIABLE', value: 'cust' }, region: { type: 'VARIABLE', value: 'region' } });
    expect(Object.keys(mapping.outputs!)).toEqual(['tier', 'found', 'profile', 'score']);
    expect(Object.values(ext(t).properties).find((p) => p.name === 'score')?.type).toBe('integer');
    t.commandStack.undo();
    expect(attr(t.element('svc'), 'activiti:templateVersion')).toBe('1');
    expect(Object.keys(ext(t).mappings['svc']!.outputs!)).toEqual(['tier', 'found', 'profile']);
  });

  it('refuses to update when the action is gone', async () => {
    t = await applied('1');
    catalog(t).set({ connectors: [] });
    expect(() => accessors(t!).set('svc', 'template.update', true)).toThrow('no longer defined');
  });

  it('unlinking removes the link and nothing else, in one undo step', async () => {
    t = await applied('1');
    accessors(t).set('svc', 'template.unlink', true);
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBeUndefined();
    expect(attr(t.element('svc'), 'activiti:templateVersion')).toBeUndefined();
    expect(t.element('svc').businessObject.get('implementation')).toBe('crm.LOOKUP');
    expect(Object.keys(ext(t).mappings['svc']!.outputs!)).toHaveLength(3);
    t.commandStack.undo();
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBe('crm.LOOKUP');
  });

  it('a task stops being linked when its implementation is no longer the template\'s', async () => {
    t = await applied('1');
    accessors(t).set('svc', 'impl.type', 'class');
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBeUndefined();
    accessors(t).set('svc', 'template.apply', { id: 'crm.LOOKUP' });
    accessors(t).set('svc', 'impl.connector', 'crm.OTHER');
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBeUndefined();
    accessors(t).set('svc', 'template.apply', { id: 'builtin/mail' });
    accessors(t).set('svc', 'mail.to', 'a@b.c');
    expect(attr(t.element('svc'), TEMPLATE_ID_ATTRIBUTE)).toBe('builtin/mail');
  });
});

describe('the element templates service', () => {
  it('offers the templates of the project for a task, the task templates for another flow node', async () => {
    t = await createBuilt();
    catalog(t).set({ connectors: [CRM()] });
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.createShape({ type: 'sendTask', id: 'send' });
    expect(templates(t).getLatest(t.element('svc')).map((x) => x.id)).toContain('crm.LOOKUP');
    expect(templates(t).getLatest(t.element('send')).map((x) => x.id)).toEqual(['builtin/mail']);
    expect(templates(t).getLatest(t.element('StartEvent_1')).map((x) => x.id)).toContain('builtin/shell');
  });

  it('appends a templated service task after a flow node in one undo step', async () => {
    t = await createBuilt();
    catalog(t).set({ connectors: [CRM()] });
    const created = templates(t).applyTemplate(t.element('StartEvent_1'), 'crm.LOOKUP');
    expect(created.type).toBe('bpmn:ServiceTask');
    expect(created.businessObject.get('implementation')).toBe('crm.LOOKUP');
    expect(created.incoming?.length).toBe(1);
    const count = t.registry.getAll().length;
    t.commandStack.undo();
    expect(t.registry.getAll().length).toBeLessThan(count);
    expect(t.registry.get(created.id)).toBeUndefined();
  });

  it('announces a change of the project', async () => {
    t = await createBuilt();
    const seen: string[] = [];
    t.get<{ on(e: string, h: () => void): void }>('eventBus').on('elementTemplates.changed', () => seen.push('changed'));
    catalog(t).set({ connectors: [CRM()] });
    expect(seen).toEqual(['changed']);
  });
});

describe('mappings and variables of the extensions groups', () => {
  it('types the declared target of a decision output from its FEEL type and lists the matched flags', async () => {
    t = await createBuilt(undefined, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    catalog(t).set({
      dmn: [
        {
          path: 'processes/risk.dmn',
          baseName: 'risk',
          decisions: [{ id: 'riskLevel', inputs: ['age'], complexInputs: [], outputs: [{ name: 'level', type: 'string' }, { name: 'points', type: 'integer' }, { name: 'ok', type: 'boolean' }, { name: 'odd', type: 'Weird' }], sink: true }],
        },
      ],
    });
    t.builder.createShape({ type: 'serviceTask', id: 'dt', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    accessors(t).set('dt', 'decision.pick', { decision: 'riskLevel', matched: 'm', matchedRules: 'rules' });
    expect(ext(t).constants['dt']).toEqual({ _activiti_dmn_table_: { value: 'riskLevel' } });
    expect(ext(t).mappings['dt']!.inputs).toEqual({ age: { type: 'VARIABLE', value: 'age' } });
    expect(Object.values(ext(t).properties).map((p) => [p.name, p.type])).toEqual([
      ['level', 'string'], ['points', 'bigdecimal'], ['ok', 'boolean'], ['odd', 'json'], ['m', 'boolean'], ['rules', 'array'],
    ]);
    // picking again adds nothing
    const before = JSON.stringify(ext(t));
    accessors(t).set('dt', 'decision.pick', { decision: 'riskLevel', matched: 'm', matchedRules: 'rules' });
    expect(JSON.stringify(ext(t))).toBe(before);
  });

  it('lists where a declared variable is used by the mappings', async () => {
    t = await createBuilt(undefined, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    t.builder.createShape({ type: 'serviceTask', id: 'a', attrs: { implementation: 'x.Y' } });
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.setProperty('a', 'mapping.outputs', { total: { type: 'VARIABLE', value: 'sum' } });
    t.builder.setProperty('u', 'mapping.inputs', { amount: { type: 'VARIABLE', value: 'total' }, fixed: { type: 'VALUE', value: 1 } });
    expect(accessors(t).get('Process_1', 'variables.usage')).toEqual({
      total: [{ elementId: 'a', as: 'output' }, { elementId: 'u', as: 'input' }],
    });
    expect(() => accessors(t!).set('Process_1', 'variables.usage', {})).toThrow('derived');
  });

  it('refuses a default value that does not fit the variable type', async () => {
    t = await createBuilt();
    const set = (variable: Record<string, unknown>) => () => accessors(t!).set('Process_1', 'variables.list', [variable]);
    expect(set({ name: 'd', type: 'date', value: 'tomorrow' })).toThrow('does not fit');
    expect(set({ name: 'd', type: 'date', value: '2030-05-17T10:15:30Z' })).not.toThrow();
    expect(set({ name: 'a', type: 'array', value: { x: 1 } })).toThrow('does not fit');
    expect(set({ name: 'i', type: 'integer', value: 1.5 })).toThrow('does not fit');
    expect(set({ name: 'i', type: 'integer', value: '${count}' })).not.toThrow();
  });
});
