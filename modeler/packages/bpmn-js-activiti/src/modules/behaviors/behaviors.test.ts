import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { EMPTY_PROCESS } from '../../../test-support/modeler';
import type { DiagramElement, ModdleElement } from '../../types';
import type { ExtensionsStore } from '../extensions';

let t: Built | undefined;
afterEach(() => t?.destroy());

const get = (el: DiagramElement, name: string): unknown => el.businessObject.get(name);

describe('ExecutableBehavior', () => {
  it('forces isExecutable on import', async () => {
    t = await createBuilt(EMPTY_PROCESS.replace('isExecutable="true"', 'isExecutable="false"'));
    expect(get(t.element('Process_1'), 'isExecutable')).toBe(true);
    const { xml } = await t.modeler.saveXML({ format: true });
    expect(xml).toContain('isExecutable="true"');
  });

  it('forces it on import when the attribute is missing and keeps it on update', async () => {
    t = await createBuilt(EMPTY_PROCESS.replace(' isExecutable="true"', ''));
    expect(get(t.element('Process_1'), 'isExecutable')).toBe(true);
    t.modeling.updateProperties(t.element('Process_1'), { isExecutable: false });
    expect(get(t.element('Process_1'), 'isExecutable')).toBe(true);
  });

  it('creates executable processes for new pools', async () => {
    t = await createBuilt();
    const id = t.builder.createShape({ type: 'participant', id: 'Pool_A' });
    const process = get(t.element(id), 'processRef') as ModdleElement;
    expect(process.get('isExecutable')).toBe(true);
  });
});

describe('ImplementationBehavior', () => {
  const task = async (): Promise<DiagramElement> => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    return t.element('svc');
  };

  it('setting one implementation attribute clears the others', async () => {
    const svc = await task();
    t!.modeling.updateProperties(svc, { 'activiti:class': 'a.B', 'activiti:resultVariableName': 'r' });
    t!.modeling.updateProperties(svc, { implementation: 'mailer.SEND' });
    expect(get(svc, 'activiti:class')).toBeUndefined();
    expect(get(svc, 'activiti:resultVariableName')).toBeUndefined();
    expect(get(svc, 'implementation')).toBe('mailer.SEND');
    t!.modeling.updateProperties(svc, { 'activiti:expression': '${x}' });
    expect(get(svc, 'implementation')).toBeUndefined();
    expect(get(svc, 'activiti:expression')).toBe('${x}');
    // undo is one step
    t!.commandStack.undo();
    expect(get(svc, 'implementation')).toBe('mailer.SEND');
  });

  it('removes injected fields when switching from Java class to a connector, keeps them for a delegate expression', async () => {
    const svc = await task();
    t!.builder.setProperty('svc', 'impl.type', 'class');
    t!.builder.setProperty('svc', 'impl.class', 'a.B');
    t!.builder.setProperty('svc', 'fields.list', [{ name: 'f', string: 'v' }]);
    t!.builder.setProperty('svc', 'impl.type', 'delegateExpression');
    expect(t!.builder.getProperty('svc', 'fields.list')).toEqual([{ name: 'f', string: 'v' }]);
    t!.builder.setProperty('svc', 'impl.type', 'connector');
    expect(t!.builder.getProperty('svc', 'fields.list')).toEqual([]);
    expect(get(svc, 'activiti:delegateExpression')).toBeUndefined();
    const { xml } = await t!.builder.export('x');
    expect(xml).not.toContain('activiti:field');
    expect(xml).not.toContain('extensionElements');
    // one undo brings back the delegate expression and the fields
    t!.commandStack.undo();
    expect(get(svc, 'activiti:delegateExpression')).toBe('');
    expect(t!.builder.getProperty('svc', 'fields.list')).toEqual([{ name: 'f', string: 'v' }]);
  });
});

describe('SendTaskBehavior', () => {
  it('gives a converted send task exactly activiti:type="mail"', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:type': 'shell' } });
    const result = t.get<{ replaceElement(el: DiagramElement, target: Record<string, unknown>): DiagramElement }>('bpmnReplace').replaceElement(t.element('svc'), { type: 'bpmn:SendTask' });
    expect(result.businessObject.get('activiti:type')).toBe('mail');
    expect(result.id).toBe('svc');
  });

  it('adds the mail type to a new send task', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'sendTask', id: 'send' });
    expect(get(t.element('send'), 'activiti:type')).toBe('mail');
  });
});

describe('DecisionTaskBehavior', () => {
  it('creates the decision constant with a decision task and drops it when the task stops being one', async () => {
    t = await createBuilt();
    const store = t.get<ExtensionsStore>('extensionsStore');
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    expect(store.getProcess('Process_1')!.constants['dec']).toEqual({ _activiti_dmn_table_: { value: '' } });
    t.builder.setProperty('dec', 'decision.table', 'risk');
    expect(store.getProcess('Process_1')!.constants['dec']).toEqual({ _activiti_dmn_table_: { value: 'risk' } });
    t.builder.setProperty('dec', 'impl.type', 'class');
    expect(store.getProcess('Process_1')!.constants['dec']).toBeUndefined();
    t.commandStack.undo();
    expect(store.getProcess('Process_1')!.constants['dec']).toEqual({ _activiti_dmn_table_: { value: 'risk' } });
    expect(get(t.element('dec'), 'implementation')).toBe('dmn-connector.EXECUTE_TABLE');
  });

  it('keeps other constants when the task stops being a decision task', async () => {
    t = await createBuilt();
    const store = t.get<ExtensionsStore>('extensionsStore');
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    t.builder.setConstants('dec', { mode: 'strict' });
    t.builder.setProperty('dec', 'impl.type', 'connector');
    expect(store.getProcess('Process_1')!.constants['dec']).toEqual({ mode: { value: 'strict' } });
  });
});

describe('BoundaryEventBehavior', () => {
  it('keeps error boundary events interrupting', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'b', attachedTo: 'u', eventDefinition: 'error' });
    t.modeling.updateProperties(t.element('b'), { cancelActivity: false });
    expect(get(t.element('b'), 'cancelActivity')).toBe(true);
  });

  it('makes a non-interrupting timer boundary interrupting when it becomes an error boundary', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'b', attachedTo: 'u', eventDefinition: 'timer', interrupting: false });
    expect(get(t.element('b'), 'cancelActivity')).toBe(false);
    t.builder.setProperty('b', 'event.definition', 'error');
    expect(get(t.element('b'), 'cancelActivity')).not.toBe(false);
    expect(t.builder.getProperty('b', 'event.definition')).toBe('error');
  });
});

describe('DefinitionsReferenceBehavior', () => {
  it('registers a new message at definitions level when it is picked, in one undo step', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'c', eventDefinition: 'message' });
    const definitions = (t.modeler as unknown as { getDefinitions(): ModdleElement }).getDefinitions();
    const before = (definitions.get('rootElements') as ModdleElement[]).length;
    t.builder.setProperty('c', 'message.ref', 'orderPlaced');
    const roots = definitions.get('rootElements') as ModdleElement[];
    expect(roots.length).toBe(before + 1);
    expect(roots.find((r) => r.$type === 'bpmn:Message')!.get('name')).toBe('orderPlaced');
    t.commandStack.undo();
    expect((definitions.get('rootElements') as ModdleElement[]).length).toBe(before);
    t.commandStack.redo();
    expect((definitions.get('rootElements') as ModdleElement[]).length).toBe(before + 1);
  });
});

describe('compensation (bpmn-js behaviour kept)', () => {
  it('connecting a compensation boundary to a task creates an association and marks the handler', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'work' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'comp', attachedTo: 'work', eventDefinition: 'compensate' });
    t.builder.createShape({ type: 'serviceTask', id: 'undo', at: { x: 400, y: 400 } });
    const flow = t.builder.connect('comp', 'undo', { type: 'association', attrs: { associationDirection: 'One' } });
    expect(t.element(flow).businessObject.$type).toBe('bpmn:Association');
    const { xml } = await t.builder.export('c');
    expect(xml).toMatch(/<bpmn:serviceTask id="undo"[^>]*isForCompensation="true"/);
  });
});

describe('FieldPlacementBehavior', () => {
  const DIRECT = EMPTY_PROCESS.replace(
    '<bpmn:startEvent id="StartEvent_1" />',
    '<bpmn:startEvent id="StartEvent_1" /><bpmn:serviceTask id="svc" activiti:class="a.B"><activiti:field name="tag"><activiti:string>S1</activiti:string></activiti:field></bpmn:serviceTask>' +
      '<bpmn:intermediateThrowEvent id="throwMsg"><bpmn:messageEventDefinition activiti:class="a.B"><activiti:field name="tag"><activiti:string>T1</activiti:string></activiti:field>' +
      '<bpmn:extensionElements><activiti:field name="first" stringValue="1" /></bpmn:extensionElements></bpmn:messageEventDefinition></bpmn:intermediateThrowEvent>',
  ).replace(
    '</bpmndi:BPMNPlane>',
    '<bpmndi:BPMNShape id="svc_di" bpmnElement="svc"><dc:Bounds x="300" y="140" width="100" height="80" /></bpmndi:BPMNShape><bpmndi:BPMNShape id="throwMsg_di" bpmnElement="throwMsg"><dc:Bounds x="500" y="160" width="36" height="36" /></bpmndi:BPMNShape></bpmndi:BPMNPlane>',
  );

  it('moves fields written as direct children into extensionElements on import, so the accessors see them and the export writes that form', async () => {
    t = await createBuilt(DIRECT);
    expect((t.builder.getProperty('svc', 'fields.list') as Array<{ name: string }>).map((f) => f.name)).toEqual(['tag']);
    // the extensionElements fields come first, then the direct ones, as the engine reads them in document order
    expect((t.builder.getProperty('throwMsg', 'message.fields') as Array<{ name: string }>).map((f) => f.name)).toEqual(['first', 'tag']);
    const { xml } = await t.builder.export('fields');
    expect(xml).toMatch(/<bpmn:serviceTask id="svc"[^>]*>\s*<bpmn:extensionElements>\s*<activiti:field name="tag">/);
    expect(xml).toMatch(/<bpmn:messageEventDefinition[^>]*>\s*<bpmn:extensionElements>\s*<activiti:field name="first"[^>]*\/>\s*<activiti:field name="tag">/);
    expect(xml).not.toMatch(/<\/bpmn:extensionElements>\s*<activiti:field/);
    expect(t.commandStack.canUndo()).toBe(false);
  });

  it('keeps the extensionElements form unchanged', async () => {
    t = await createBuilt(DIRECT);
    const first = (await t.builder.export('fields')).xml;
    const again = await createBuilt(first);
    try {
      expect((await again.builder.export('fields')).xml).toBe(first);
    } finally {
      again.destroy();
    }
  });
});
