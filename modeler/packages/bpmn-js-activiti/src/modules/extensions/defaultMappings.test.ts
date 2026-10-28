import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { EMPTY_PROCESS } from '../../../test-support/modeler';
import { importProcess } from '../../export';
import type { ExtensionsStore } from '.';

let t: Built | undefined;
afterEach(() => {
  t?.destroy();
  t = undefined;
});

const store = (b: Built): ExtensionsStore => b.get<ExtensionsStore>('extensionsStore');
const mappings = (b: Built): Record<string, unknown> => ({ ...(store(b).getProcess('Process_1')?.mappings ?? {}) });
const MAP_ALL = { mappingType: 'MAP_ALL' };
const MAP_ALL_OUTPUTS = { mappingType: 'MAP_ALL_OUTPUTS' };

/** User task / call activity / catch events have the mapping the moment they exist. */
describe('default mappings for new elements (ADR 0006)', () => {
  it('gives a new user task MAP_ALL, and one undo removes the task and the mapping together', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'review' });
    expect(mappings(t)).toEqual({ review: MAP_ALL });
    t.commandStack.undo();
    expect(t.registry.get('review')).toBeUndefined();
    expect(mappings(t)).toEqual({});
    t.commandStack.redo();
    expect(t.registry.get('review')).toBeDefined();
    expect(mappings(t)).toEqual({ review: MAP_ALL });
  });

  it('gives a new call activity MAP_ALL', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'callActivity', id: 'call' });
    expect(mappings(t)).toEqual({ call: MAP_ALL });
  });

  it('gives message catch events MAP_ALL: intermediate, boundary and the start of an event sub process', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'waitMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'serviceTask', id: 'host' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'boundaryMsg', attachedTo: 'host', eventDefinition: 'message' });
    t.builder.createShape({ type: 'subProcess', id: 'eventSub', triggeredByEvent: true, isExpanded: true });
    t.builder.createShape({ type: 'startEvent', id: 'subStartMsg', parent: 'eventSub', eventDefinition: 'message' });
    expect(Object.keys(mappings(t)).sort()).toEqual(['boundaryMsg', 'subStartMsg', 'waitMsg']);
    expect(Object.values(mappings(t)).every((m) => JSON.stringify(m) === JSON.stringify(MAP_ALL))).toBe(true);
  });

  it('gives signal catch events nothing: the payload of a signal reaches the process without a mapping and Activiti applies none (engine finding 37)', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'waitSig', eventDefinition: 'signal' });
    t.builder.createShape({ type: 'serviceTask', id: 'host' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'boundarySig', attachedTo: 'host', eventDefinition: 'signal', interrupting: false });
    expect(mappings(t)).toEqual({});
    // turning a timer event into a signal event adds none either
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'timer' });
    t.builder.setProperty('wait', 'event.definition', 'signal');
    expect(mappings(t)).toEqual({});
  });

  it('gives nothing to elements that carry no payload: throw events, end events, timers, plain events, the process start, tasks, gateways', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'throwMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'throwSig', eventDefinition: 'signal' });
    t.builder.createShape({ type: 'endEvent', id: 'endMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'waitTimer', eventDefinition: 'timer' });
    t.builder.createShape({ type: 'startEvent', id: 'processStartMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.createShape({ type: 'scriptTask', id: 'script' });
    t.builder.createShape({ type: 'exclusiveGateway', id: 'gw' });
    t.builder.createShape({ type: 'subProcess', id: 'sub' });
    t.builder.createShape({ type: 'startEvent', id: 'plainStartInEventSub', parent: 'sub' });
    expect(mappings(t)).toEqual({});
  });

  it('gives a connector service task none: its template creates explicit mappings', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'notify' });
    t.builder.setProperty('notify', 'impl.type', 'connector');
    t.builder.setProperty('notify', 'impl.connector', 'mailer.SEND');
    expect(mappings(t)).toEqual({});
    t.builder.setMapping('notify', { inputs: { to: { type: 'VARIABLE', value: 'email' } } });
    expect(mappings(t)).toEqual({ notify: { inputs: { to: { type: 'VARIABLE', value: 'email' } } } });
  });

  it('applies when the type of an element is changed to one of them: a task becomes a user task, a timer event a message event', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'task', id: 'plain' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'timer' });
    t.builder.setProperty('wait', 'timer.definition', { type: 'duration', value: 'PT1H' });
    expect(mappings(t)).toEqual({});
    const replace = t.get<{ replaceElement(el: unknown, target: Record<string, unknown>): { id: string } }>('bpmnReplace');
    expect(replace.replaceElement(t.element('plain'), { type: 'bpmn:UserTask' }).id).toBe('plain');
    expect(mappings(t)).toEqual({ plain: MAP_ALL });
    t.builder.setProperty('wait', 'event.definition', 'message');
    expect(mappings(t)).toEqual({ plain: MAP_ALL, wait: MAP_ALL });
    // undoing the change of type undoes its mapping as well
    t.commandStack.undo();
    expect(mappings(t)).toEqual({ plain: MAP_ALL });
    t.commandStack.undo();
    expect(mappings(t)).toEqual({});
    t.commandStack.redo();
    t.commandStack.redo();
    expect(mappings(t)).toEqual({ plain: MAP_ALL, wait: MAP_ALL });
  });

  it('gives a new multi-instance user task MAP_ALL_OUTPUTS: MAP_ALL wedges a parallel multi-instance user task on the engine', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'plain' });
    t.builder.createShape({ type: 'userTask', id: 'par' });
    t.builder.setProperty('par', 'mi.type', 'parallel');
    expect(mappings(t)).toEqual({ plain: MAP_ALL, par: MAP_ALL_OUTPUTS });
  });

  it('switches the default when multi-instance is turned on and off, as one undoable change, parallel and sequential alike', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    expect(mappings(t)).toEqual({ u: MAP_ALL });
    t.builder.setProperty('u', 'mi.type', 'parallel');
    expect(mappings(t)).toEqual({ u: MAP_ALL_OUTPUTS });
    // parallel <-> sequential does not change the default
    t.builder.setProperty('u', 'mi.type', 'sequential');
    expect(mappings(t)).toEqual({ u: MAP_ALL_OUTPUTS });
    t.builder.setProperty('u', 'mi.type', 'none');
    expect(mappings(t)).toEqual({ u: MAP_ALL });
    // one undo takes the loop and the switched mapping back together, one redo restores both
    t.commandStack.undo();
    expect(t.builder.getProperty('u', 'mi.type')).toBe('sequential');
    expect(mappings(t)).toEqual({ u: MAP_ALL_OUTPUTS });
    t.commandStack.undo();
    t.commandStack.undo();
    expect(t.builder.getProperty('u', 'mi.type')).toBe('none');
    expect(mappings(t)).toEqual({ u: MAP_ALL });
    t.commandStack.redo();
    expect(t.builder.getProperty('u', 'mi.type')).toBe('parallel');
    expect(mappings(t)).toEqual({ u: MAP_ALL_OUTPUTS });
  });

  it('never overwrites a mapping the user chose when multi-instance is turned on or off', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'explicit' });
    t.builder.setMapping('explicit', { mappingType: 'MAP_ALL_INPUTS' });
    t.builder.setProperty('explicit', 'mi.type', 'parallel');
    expect(mappings(t).explicit).toEqual({ mappingType: 'MAP_ALL_INPUTS' });
    t.builder.setProperty('explicit', 'mi.type', 'none');
    expect(mappings(t).explicit).toEqual({ mappingType: 'MAP_ALL_INPUTS' });

    t.builder.createShape({ type: 'userTask', id: 'withRows' });
    t.builder.setMapping('withRows', { outputs: { decision: { type: 'VARIABLE', value: 'decision' } } });
    t.builder.setProperty('withRows', 'mi.type', 'parallel');
    expect(mappings(t).withRows).toEqual({ outputs: { decision: { type: 'VARIABLE', value: 'decision' } } });

    // a MAP_ALL_OUTPUTS the user picked on a plain task stays when the loop goes on and off
    t.builder.createShape({ type: 'userTask', id: 'chosen' });
    t.builder.setMapping('chosen', { mappingType: 'MAP_ALL_OUTPUTS' });
    t.builder.setProperty('chosen', 'mi.type', 'parallel');
    t.builder.setProperty('chosen', 'mi.type', 'none');
    expect(mappings(t).chosen).toEqual({ mappingType: 'MAP_ALL_OUTPUTS' });

    // a multi-instance default the user then picked again himself is kept when the loop goes
    t.builder.createShape({ type: 'userTask', id: 'touched' });
    t.builder.setProperty('touched', 'mi.type', 'parallel');
    t.builder.setMapping('touched', { mappingType: 'MAP_ALL_INPUTS' });
    t.builder.setMapping('touched', { mappingType: 'MAP_ALL_OUTPUTS' });
    t.builder.setProperty('touched', 'mi.type', 'none');
    expect(mappings(t).touched).toEqual({ mappingType: 'MAP_ALL_OUTPUTS' });
  });

  it('leaves tasks without a mapping alone when the loop changes, and does nothing when the setting is off or the task is not a user task', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'bare' });
    t.builder.setMapping('bare', undefined);
    t.builder.setProperty('bare', 'mi.type', 'parallel');
    expect(mappings(t)).toEqual({});
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.setProperty('svc', 'mi.type', 'parallel');
    t.builder.createShape({ type: 'callActivity', id: 'call' });
    t.builder.setProperty('call', 'mi.type', 'parallel');
    expect(mappings(t)).toEqual({ call: MAP_ALL });
    store(t).defaultMappings = 'none';
    t.builder.createShape({ type: 'userTask', id: 'off' });
    store(t).defaultMappings = 'mapAll';
    t.builder.setMapping('off', { mappingType: 'MAP_ALL' });
    store(t).defaultMappings = 'none';
    t.builder.setProperty('off', 'mi.type', 'parallel');
    expect(mappings(t).off).toEqual(MAP_ALL);
  });

  it('gives a user task that is replaced by a multi-instance one the multi-instance default', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'task', id: 'plain' });
    t.builder.setProperty('plain', 'mi.type', 'parallel');
    t.get<{ replaceElement(el: unknown, target: Record<string, unknown>): { id: string } }>('bpmnReplace').replaceElement(t.element('plain'), { type: 'bpmn:UserTask' });
    expect(mappings(t)).toEqual({ plain: MAP_ALL_OUTPUTS });
  });

  it('keeps a mapping that was set when the element is replaced by another kind that also gets one', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.setMapping('u', { outputs: { decision: { type: 'VARIABLE', value: 'decision' } } });
    t.get<{ replaceElement(el: unknown, target: Record<string, unknown>): unknown }>('bpmnReplace').replaceElement(t.element('u'), { type: 'bpmn:CallActivity' });
    expect(mappings(t)).toEqual({ u: { outputs: { decision: { type: 'VARIABLE', value: 'decision' } } } });
  });

  it('can be turned off with the option, at construction or at run time', async () => {
    t = await createBuilt(EMPTY_PROCESS, { config: { activitiExtensions: { defaultMappings: 'none' } } });
    expect(store(t).defaultMappings).toBe('none');
    t.builder.createShape({ type: 'userTask', id: 'u1' });
    expect(mappings(t)).toEqual({});
    store(t).defaultMappings = 'mapAll';
    t.builder.createShape({ type: 'userTask', id: 'u2' });
    expect(mappings(t)).toEqual({ u2: MAP_ALL });
    store(t).defaultMappings = 'none';
    t.builder.createShape({ type: 'callActivity', id: 'c1' });
    expect(Object.keys(mappings(t))).toEqual(['u2']);
  });

  it('defaults to MAP_ALL when nothing is configured', async () => {
    t = await createBuilt();
    expect(store(t).defaultMappings).toBe('mapAll');
  });

  it('declares nothing and sets no constants: a default mapping is only the mapping type', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    const ext = store(t).getProcess('Process_1')!;
    expect(ext.properties).toEqual({});
    expect(ext.constants).toEqual({});
  });
});

describe('imported elements are never modified', () => {
  const shape = (id: string, x: number, w = 100, h = 80): string =>
    `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${h === 80 ? 140 : 160}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
  const imported = EMPTY_PROCESS.replace(
    '<bpmn:startEvent id="StartEvent_1" />',
    '<bpmn:startEvent id="StartEvent_1" /><bpmn:userTask id="legacyTask" /><bpmn:callActivity id="legacyCall" calledElement="child" /><bpmn:intermediateCatchEvent id="legacyWait"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>',
  ).replace('</bpmndi:BPMNPlane>', `${shape('legacyTask', 300)}${shape('legacyCall', 450)}${shape('legacyWait', 600, 36, 36)}</bpmndi:BPMNPlane>`);

  it('leaves user tasks, call activities and catch events without a mapping as they were when a file is opened', async () => {
    t = await createBuilt(imported);
    await importProcess(t.modeler as never, { xml: imported, extensionsJson: '{"id":"e","extensions":{"Process_1":{"mappings":{"legacyCall":{"mappingType":"MAP_ALL_OUTPUTS"}}}}}' });
    expect(mappings(t)).toEqual({ legacyCall: { mappingType: 'MAP_ALL_OUTPUTS' } });
    expect(t.commandStack.canUndo()).toBe(false);
  });

  it('does not add one when an imported element is edited, renamed or moved', async () => {
    t = await createBuilt(imported);
    t.builder.setProperty('legacyTask', 'general.name', 'Legacy');
    t.builder.setProperty('legacyTask', 'user.assignee', 'kermit');
    t.builder.setProperty('legacyTask', 'general.id', 'renamedTask');
    t.modeling.moveElements([t.element('legacyWait')], { x: 20, y: 20 });
    t.builder.setProperty('legacyWait', 'message.ref', 'ping');
    expect(mappings(t)).toEqual({});
  });

  it('does not add one to a copy of an element that has none, but copies the mapping of one that has', async () => {
    t = await createBuilt(imported);
    t.builder.createShape({ type: 'userTask', id: 'fresh' });
    t.builder.setMapping('fresh', { mappingType: 'MAP_ALL_INPUTS' });
    const copyPaste = t.get<{ copy(elements: unknown[]): void; paste(context: Record<string, unknown>): void }>('copyPaste');
    const paste = (id: string): string => {
      const before = new Set(t!.registry.getAll().map((e) => e.id));
      copyPaste.copy([t!.element(id)]);
      copyPaste.paste({ element: t!.get<{ getRootElement(): unknown }>('canvas').getRootElement(), point: { x: 900, y: 500 } });
      const created = t!.registry.getAll().filter((e) => !before.has(e.id) && !e.waypoints && !e.labelTarget);
      expect(created).toHaveLength(1);
      return created[0]!.id;
    };
    const copyOfLegacy = paste('legacyTask');
    const copyOfFresh = paste('fresh');
    expect(mappings(t)[copyOfLegacy]).toBeUndefined();
    expect(mappings(t)[copyOfFresh]).toEqual({ mappingType: 'MAP_ALL_INPUTS' });
  });
});
