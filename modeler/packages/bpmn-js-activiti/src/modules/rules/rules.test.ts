import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { buildKitchenSink } from '../../../test-support/kitchen-sink';
import type { DiagramElement } from '../../types';

let t: Built | undefined;
afterEach(() => t?.destroy());

interface Rules {
  allowed(rule: string, context: Record<string, unknown>): unknown;
}
interface Factory {
  createShape(attrs: Record<string, unknown>): DiagramElement;
}
interface BpmnFactory {
  create(type: string, attrs?: Record<string, unknown>): { set(name: string, value: unknown): void };
}

async function setup(): Promise<{ t: Built; rules: Rules; shape: (type: string, definition?: string, extra?: Record<string, unknown>) => DiagramElement }> {
  t = await createBuilt();
  buildKitchenSink(t.builder);
  const factory = t.get<Factory>('elementFactory');
  const bpmnFactory = t.get<BpmnFactory>('bpmnFactory');
  return {
    t,
    rules: t.get<Rules>('rules'),
    shape: (type, definition, extra = {}) => {
      const bo = bpmnFactory.create(type, extra);
      if (definition) bo.set('eventDefinitions', [bpmnFactory.create(`bpmn:${definition}EventDefinition`)]);
      return factory.createShape({ type, businessObject: bo });
    },
  };
}

describe('creation rules (shape.create / elements.create)', () => {
  it.each([
    ['bpmn:StartEvent', undefined, 'Process_1', true],
    ['bpmn:StartEvent', 'Timer', 'Process_1', true],
    ['bpmn:StartEvent', 'Timer', 'sp', false],
    ['bpmn:StartEvent', 'Message', 'sp', false],
    ['bpmn:StartEvent', 'Signal', 'esp', false],
    ['bpmn:StartEvent', 'Timer', 'esp', false],
    ['bpmn:StartEvent', 'Message', 'esp', true],
    ['bpmn:StartEvent', 'Error', 'esp', true],
    ['bpmn:StartEvent', undefined, 'esp', false],
    ['bpmn:EndEvent', 'Cancel', 'Process_1', false],
    ['bpmn:EndEvent', 'Cancel', 'tx', true],
    ['bpmn:EndEvent', 'Signal', 'Process_1', false],
    ['bpmn:EndEvent', 'Terminate', 'Process_1', true],
    ['bpmn:IntermediateThrowEvent', 'Escalation', 'Process_1', false],
    ['bpmn:IntermediateCatchEvent', 'Conditional', 'Process_1', false],
    ['bpmn:BusinessRuleTask', undefined, 'Process_1', false],
    ['bpmn:ComplexGateway', undefined, 'Process_1', false],
    ['bpmn:AdHocSubProcess', undefined, 'Process_1', false],
    ['bpmn:Group', undefined, 'Process_1', false],
    ['bpmn:UserTask', undefined, 'sp', true],
    ['bpmn:EventBasedGateway', undefined, 'Process_1', true],
  ] as const)('%s %s in %s -> %s', async (type, definition, parentId, expected) => {
    const ctx = await setup();
    const shape = ctx.shape(type, definition);
    const target = ctx.t.element(parentId);
    expect(ctx.rules.allowed('shape.create', { shape, target, position: { x: 0, y: 0 } })).toBe(expected);
    expect(ctx.rules.allowed('elements.create', { elements: [shape], target, position: { x: 0, y: 0 } })).toBe(expected);
  });

  it('judges the children of a pasted container in their own container', async () => {
    const ctx = await setup();
    const subProcess = ctx.shape('bpmn:SubProcess', undefined, {});
    const timerStart = ctx.shape('bpmn:StartEvent', 'Timer');
    (timerStart as { parent?: DiagramElement }).parent = subProcess;
    expect(ctx.rules.allowed('elements.create', { elements: [subProcess, timerStart], target: ctx.t.element('Process_1'), position: { x: 0, y: 0 } })).toBe(false);
  });
});

describe('connection rules', () => {
  it('lets an event-based gateway reach intermediate catch events only', async () => {
    const ctx = await setup();
    const gateway = ctx.t.element('g_e');
    expect(ctx.rules.allowed('connection.create', { source: gateway, target: ctx.t.element('ic_timer') })).toBeTruthy();
    expect(ctx.rules.allowed('connection.create', { source: gateway, target: ctx.t.element('t_receive') })).toBe(false);
    expect(ctx.rules.allowed('connection.create', { source: gateway, target: ctx.t.element('t_user') })).toBe(false);
    expect(ctx.rules.allowed('connection.create', { source: gateway, target: ctx.t.element('e_none') })).toBe(false);
    // other connection types are not touched
    expect(ctx.rules.allowed('connection.create', { source: gateway, target: ctx.t.element('note') })).toBeTruthy();
    expect(ctx.rules.allowed('connection.create', { source: ctx.t.element('g_x'), target: ctx.t.element('t_receive') })).toBeTruthy();
  });

  it('the builder refuses what the rules refuse', async () => {
    const ctx = await setup();
    expect(() => ctx.t.builder.connect('g_e', 't_receive')).toThrow('is not allowed');
    expect(ctx.t.builder.connect('g_e', 'ic_timer')).toBeTruthy();
  });

  it('reconnecting a flow of an event-based gateway to a receive task is refused', async () => {
    const ctx = await setup();
    const flow = ctx.t.element('f_eg_msg');
    expect(ctx.rules.allowed('connection.reconnect', { connection: flow, source: ctx.t.element('g_e'), target: ctx.t.element('t_receive') })).toBe(false);
  });
});

describe('moving and attaching', () => {
  it('refuses to move a typed start event into an embedded sub process', async () => {
    const ctx = await setup();
    expect(ctx.rules.allowed('elements.move', { shapes: [ctx.t.element('s_timer')], target: ctx.t.element('sp'), delta: { x: 0, y: 0 }, position: { x: 0, y: 0 } })).toBe(false);
    expect(ctx.rules.allowed('elements.move', { shapes: [ctx.t.element('t_task')], target: ctx.t.element('sp'), delta: { x: 0, y: 0 }, position: { x: 0, y: 0 } })).not.toBe(false);
  });

  it('refuses to move an end cancel event out of its transaction', async () => {
    const ctx = await setup();
    expect(ctx.rules.allowed('elements.move', { shapes: [ctx.t.element('tx_cancel')], target: ctx.t.element('Process_1'), delta: { x: 0, y: 0 }, position: { x: 0, y: 0 } })).toBe(false);
  });

  it('allows one compensation boundary per activity and one cancel boundary per transaction', async () => {
    const ctx = await setup();
    const compensation = ctx.shape('bpmn:BoundaryEvent', 'Compensate');
    // t_script already has b_comp, t_user has none
    expect(ctx.rules.allowed('shape.attach', { shape: compensation, target: ctx.t.element('t_script') })).toBe(false);
    expect(ctx.rules.allowed('shape.attach', { shape: compensation, target: ctx.t.element('t_user') })).not.toBe(false);
    const cancel = ctx.shape('bpmn:BoundaryEvent', 'Cancel');
    // tx already has b_cancel
    expect(ctx.rules.allowed('shape.attach', { shape: cancel, target: ctx.t.element('tx') })).toBe(false);
  });

  it('attaches a cancel boundary to a transaction only', async () => {
    const ctx = await setup();
    const cancel = ctx.shape('bpmn:BoundaryEvent', 'Cancel');
    expect(ctx.rules.allowed('shape.attach', { shape: cancel, target: ctx.t.element('t_user') })).toBe(false);
    expect(ctx.rules.allowed('shape.attach', { shape: cancel, target: ctx.t.element('tx') })).toBe(false); // one per transaction
  });
});
