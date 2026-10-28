import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { compensationTargets, eventPlacement, linkCatchEvents, variableSuggestions, usageOf, type DefinitionsUsage } from '.';
import type { ElementRegistry } from '../../types';
import type { ExtensionsStore } from '../extensions';

let t: Built | undefined;
afterEach(() => {
  t?.destroy();
  t = undefined;
});

const usage = (b: Built): DefinitionsUsage => b.builder.getProperty('Process_1', 'definitions.usage') as DefinitionsUsage;

describe('references to messages, signals and errors', () => {
  it('counts the event definitions, tasks and message flows that refer to each root element', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'orderPlaced' }, { id: 'm2', name: 'unused' }]);
    t.builder.setProperty('Process_1', 'definitions.signals', [{ id: 's1', name: 'stockLow' }]);
    t.builder.setProperty('Process_1', 'definitions.errors', [{ id: 'e1', errorCode: 'E1' }]);
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'a', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'b', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'c', eventDefinition: 'signal' });
    t.builder.createShape({ type: 'endEvent', id: 'd', eventDefinition: 'error' });
    t.builder.setProperty('a', 'message.ref', 'orderPlaced');
    t.builder.setProperty('b', 'message.ref', 'orderPlaced');
    t.builder.setProperty('c', 'signal.ref', 'stockLow');
    t.builder.setProperty('d', 'error.ref', 'E1');
    expect(usage(t)).toEqual({ messages: { m1: 2, m2: 0 }, signals: { s1: 1 }, errors: { e1: 1 } });
    expect(usageOf((t.modeler.getDefinitions() as never))).toEqual(usage(t));
  });

  it('clears the references of a deleted message, signal or error in the same undo step', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'orderPlaced' }]);
    t.builder.setProperty('Process_1', 'definitions.signals', [{ id: 's1', name: 'stockLow' }]);
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'a', eventDefinition: 'message' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'bs', attachedTo: 'a', eventDefinition: 'signal', allowHidden: true });
    t.builder.setProperty('a', 'message.ref', 'orderPlaced');
    t.builder.setProperty('bs', 'signal.ref', 'stockLow');
    const before = (await t.builder.export('x')).xml;
    expect(before).toContain('messageRef="m1"');
    t.builder.setProperty('Process_1', 'definitions.messages', []);
    t.builder.setProperty('Process_1', 'definitions.signals', []);
    const after = (await t.builder.export('x')).xml;
    expect(after).not.toMatch(/messageRef|signalRef|<bpmn:message |<bpmn:signal /);
    expect(t.builder.getProperty('a', 'message.ref')).toBeUndefined();
    t.commandStack.undo();
    t.commandStack.undo();
    expect((await t.builder.export('x')).xml).toBe(before);
  });

  it('keeps the references of the elements that stay, and a rename does not touch them', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'one' }, { id: 'm2', name: 'two' }]);
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'a', eventDefinition: 'message' });
    t.builder.setProperty('a', 'message.ref', 'two');
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm2', name: 'second' }]);
    expect(t.builder.getProperty('a', 'message.ref')).toBe('second');
    expect(usage(t).messages).toEqual({ m2: 1 });
  });
});

describe('changing the id of a listed element', () => {
  it('renames a message in place, so the references to it stay', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'one' }, { id: 'm2', name: 'two' }]);
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'a', eventDefinition: 'message' });
    t.builder.setProperty('a', 'message.ref', 'two');
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'one' }, { id: 'renamed', name: 'two' }]);
    expect(t.builder.getProperty('Process_1', 'definitions.messages')).toEqual([{ id: 'm1', name: 'one' }, { id: 'renamed', name: 'two' }]);
    expect(t.builder.getProperty('a', 'message.ref')).toBe('two');
    expect(usage(t).messages).toEqual({ m1: 0, renamed: 1 });
    t.commandStack.undo();
    expect(t.builder.getProperty('Process_1', 'definitions.messages')).toEqual([{ id: 'm1', name: 'one' }, { id: 'm2', name: 'two' }]);
    expect(t.builder.getProperty('a', 'message.ref')).toBe('two');
  });

  it('renames a data object in place, even when a shape draws it', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'data.objects', [{ id: 'd1', name: 'amount', type: 'xsd:int' }]);
    t.builder.setProperty('Process_1', 'data.objects', [{ id: 'amountObject', name: 'amount', type: 'xsd:int' }]);
    expect(t.builder.getProperty('Process_1', 'data.objects')).toEqual([{ id: 'amountObject', name: 'amount', type: 'xsd:int' }]);
  });
});

describe('link sources', () => {
  it('lists the throw events that jump to a catch event, and follows the target of the throw event', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'catchLink', eventDefinition: 'link' });
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'throwA', eventDefinition: 'link' });
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'throwB', eventDefinition: 'link' });
    t.builder.setProperty('throwA', 'link.target', 'catchLink');
    t.builder.setProperty('throwB', 'link.target', 'catchLink');
    expect(t.builder.getProperty('catchLink', 'link.sources')).toEqual(['throwA', 'throwB']);
    t.builder.setProperty('throwA', 'link.target', undefined);
    expect(t.builder.getProperty('catchLink', 'link.sources')).toEqual(['throwB']);
    expect(linkCatchEvents(t.get<ElementRegistry>('elementRegistry')).map((c) => c.id)).toEqual(['catchLink']);
  });
});

describe('compensation targets', () => {
  it('offers handlers first, then sub processes, then other activities, and flags the ones a boundary event guards', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'book' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'comp', attachedTo: 'book', eventDefinition: 'compensate' });
    t.builder.createShape({ type: 'serviceTask', id: 'cancelBook', attrs: { isForCompensation: true } });
    t.builder.createShape({ type: 'subProcess', id: 'sub' });
    const targets = compensationTargets(t.get<ElementRegistry>('elementRegistry'));
    expect(targets.map((x) => [x.id, x.kind, x.hasCompensationBoundary])).toEqual([
      ['cancelBook', 'handler', false],
      ['sub', 'subProcess', false],
      ['book', 'activity', true],
    ]);
  });
});

describe('variable suggestions', () => {
  it('collects process properties, result variables, loop variables, data objects, the initiator and form properties', async () => {
    t = await createBuilt();
    const b = t.builder;
    b.createShape({ type: 'scriptTask', id: 'calc' });
    b.setProperty('calc', 'script.resultVariable', 'total');
    b.createShape({ type: 'serviceTask', id: 'svc' });
    b.setProperty('svc', 'impl.type', 'expression');
    b.setProperty('svc', 'impl.resultVariable', 'answer');
    b.createShape({ type: 'userTask', id: 'review' });
    b.setProperty('review', 'mi.type', 'parallel');
    b.setProperty('review', 'mi.elementVariable', 'reviewer');
    b.setProperty('review', 'mi.outputCollection', 'verdicts');
    b.setProperty('StartEvent_1', 'start.initiator', 'starter');
    b.setProperty('Process_1', 'data.objects', [{ name: 'region', type: 'xsd:string' }]);
    b.setProperty('Process_1', 'variables.list', [{ name: 'amount', type: 'integer' }]);
    b.createShape({ type: 'callActivity', id: 'call' });
    b.setProperty('call', 'call.out', [{ source: 'result', target: 'childResult' }]);
    b.createShape({ type: 'serviceTask', id: 'sh', attrs: { 'activiti:type': 'shell' } });
    b.setProperty('sh', 'shell.outputVariable', 'shellOut');

    const names = variableSuggestions(t.get<ElementRegistry>('elementRegistry'), t.get<ExtensionsStore>('extensionsStore'), t.element('svc'));
    const byName = new Map(names.map((v) => [v.name, v]));
    for (const expected of ['amount', 'total', 'answer', 'reviewer', 'loopCounter', 'verdicts', 'starter', 'region', 'childResult', 'shellOut', 'execution']) {
      expect(byName.has(expected), expected).toBe(true);
    }
    expect(byName.get('amount')).toMatchObject({ kind: 'property', type: 'integer' });
    expect(byName.get('region')).toMatchObject({ kind: 'dataObject', type: 'xsd:string' });
    // declared properties come first
    expect(names[0]?.name).toBe('amount');
    // the task object only exists where a user task is meant
    expect(byName.has('task')).toBe(false);
    const forTask = variableSuggestions(t.get<ElementRegistry>('elementRegistry'), t.get<ExtensionsStore>('extensionsStore'), t.element('review'));
    expect(forTask.some((v) => v.name === 'task')).toBe(true);
  });
});


describe('listeners that are being filled in', () => {
  it('keeps a listener whose implementation is still empty, so the panel can create it before the value is typed', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.setProperty('u', 'listeners.execution', [{ event: 'start', class: '' }]);
    t.builder.setProperty('u', 'listeners.task', [{ event: 'create', delegateExpression: '' }, { event: 'complete', expression: '${x}' }]);
    const { xml } = await t.builder.export('x');
    expect(xml).toContain('<activiti:executionListener event="start" class="" />');
    expect(xml).toContain('<activiti:taskListener event="create" delegateExpression="" />');
    expect(t.builder.getProperty('u', 'listeners.execution')).toEqual([{ event: 'start', class: '' }]);
    // no implementation at all, or two, is still refused
    expect(() => t!.builder.setProperty('u', 'listeners.execution', [{ event: 'start' }])).toThrow(/exactly one/);
    expect(() => t!.builder.setProperty('u', 'listeners.execution', [{ event: 'start', class: '', expression: '' }])).toThrow(/exactly one/);
    // a transaction dependent listener is not an expression, empty or not
    expect(() => t!.builder.setProperty('u', 'listeners.task', [{ event: 'create', expression: '', onTransaction: 'committed' }])).toThrow(/cannot be combined with an expression/);
  });

  it('keeps an event listener with an empty class or an empty signal name', async () => {
    t = await createBuilt();
    t.builder.setProperty('Process_1', 'listeners.event', [{ class: '' }, { throwEvent: 'signal', signalName: '', events: 'TASK_CREATED' }]);
    const { xml } = await t.builder.export('x');
    expect(xml).toContain('<activiti:eventListener class="" />');
    expect(xml).toMatch(/<activiti:eventListener events="TASK_CREATED" throwEvent="signal" signalName="" \/>/);
    expect(() => t!.builder.setProperty('Process_1', 'listeners.event', [{ throwEvent: 'signal' }])).toThrow(/needs signalName/);
  });
});

describe('event placement', () => {
  it('tells start, boundary, intermediate and end events apart, and whether they interrupt', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'bi', attachedTo: 'u', eventDefinition: 'timer' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'bn', attachedTo: 'u', eventDefinition: 'timer', interrupting: false });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'ic', eventDefinition: 'timer' });
    t.builder.createShape({ type: 'endEvent', id: 'e' });
    expect(eventPlacement(t.element('StartEvent_1'))).toEqual({ kind: 'start', interrupting: true });
    expect(eventPlacement(t.element('bi'))).toEqual({ kind: 'boundary', interrupting: true });
    expect(eventPlacement(t.element('bn'))).toEqual({ kind: 'boundary', interrupting: false });
    expect(eventPlacement(t.element('ic'))).toEqual({ kind: 'intermediate', interrupting: true });
    expect(eventPlacement(t.element('e'))).toEqual({ kind: 'end', interrupting: true });
  });
});
