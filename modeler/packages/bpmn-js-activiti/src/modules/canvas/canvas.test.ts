import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything';
import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import type { DiagramElement } from '../../types';
import { APPEND_INDICATOR_CLASS, type AppendIndicator, isDangling } from './AppendIndicator';

let t: Built | undefined;
afterEach(() => t?.destroy());

const open = () => createBuilt(undefined, { extraModules: [CreateAppendAnythingModule] });
const indicator = (built: Built): AppendIndicator => built.get<AppendIndicator>('appendIndicator');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`.${APPEND_INDICATOR_CLASS}`)];

describe('U30 append indicator', () => {
  it('marks the start event of an empty process and the end of an unfinished flow, and follows the diagram', async () => {
    t = await open();
    await flush();
    expect(indicator(t).ids()).toEqual(['StartEvent_1']);

    t.builder.appendShape('StartEvent_1', { type: 'userTask', id: 'review' });
    await flush();
    // the start event continues now, the task ends the flow
    expect(indicator(t).ids()).toEqual(['review']);

    t.builder.appendShape('review', { type: 'endEvent', id: 'done' });
    await flush();
    // an end event takes no append menu, so a finished flow has no indicator
    expect(indicator(t).ids()).toEqual([]);
    expect(buttons()).toHaveLength(0);

    while (t.registry.get('done')) t.commandStack.undo();
    await flush();
    expect(indicator(t).ids()).toEqual(['review']);
    while (t.registry.get('review')) t.commandStack.undo();
    await flush();
    expect(indicator(t).ids()).toEqual(['StartEvent_1']);
  });

  it('is a labelled button next to the element that opens the append menu of that element', async () => {
    t = await open();
    t.builder.appendShape('StartEvent_1', { type: 'userTask', id: 'review', name: 'Review order' });
    await flush();
    const [button] = buttons();
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.dataset['elementId']).toBe('review');
    expect(button!.getAttribute('aria-label')).toBe('Append element after Review order');

    const popup = t.get<{ open(element: DiagramElement, id: string, position: unknown, options: unknown): void }>('popupMenu');
    const opened: Array<{ element: DiagramElement; id: string; options: Record<string, unknown> }> = [];
    popup.open = (element, id, _position, options) => void opened.push({ element, id, options: options as Record<string, unknown> });
    button!.click();
    expect(opened).toHaveLength(1);
    expect(opened[0]!.id).toBe('bpmn-append');
    expect(opened[0]!.element.id).toBe('review');
    expect(opened[0]!.options['search']).toBe(true);
  });

  it('marks a task on its own only when a flow reaches it, and a boundary event without a flow', async () => {
    t = await open();
    t.builder.createShape({ type: 'userTask', id: 'alone', at: { x: 500, y: 400 } });
    await flush();
    expect(isDangling(t.element('alone'))).toBe(false);
    expect(indicator(t).ids()).toEqual(['StartEvent_1']);

    t.builder.createShape({ type: 'boundaryEvent', id: 'timeout', attachedTo: 'alone', eventDefinition: 'timer' });
    await flush();
    expect(indicator(t).ids().sort()).toEqual(['StartEvent_1', 'timeout']);
    t.builder.appendShape('timeout', { type: 'endEvent', id: 'late' });
    await flush();
    expect(indicator(t).ids()).toEqual(['StartEvent_1']);
  });

  it('is absent for end events, link throw events, compensation handlers and event sub processes', async () => {
    t = await open();
    t.builder.createShape({ type: 'endEvent', id: 'end', after: 'StartEvent_1' });
    t.builder.connect('StartEvent_1', 'end');
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'jump', eventDefinition: 'link', at: { x: 400, y: 300 } });
    t.builder.createShape({ type: 'subProcess', id: 'esp', triggeredByEvent: true, at: { x: 400, y: 500 } });
    await flush();
    expect(indicator(t).ids()).toEqual([]);
    // the structure alone says an end event ends its flow; the append menu is what has nothing for it
    expect(isDangling(t.element('end'))).toBe(true);
    expect(t.get<{ isEmpty(el: DiagramElement, id: string): boolean }>('popupMenu').isEmpty(t.element('end'), 'bpmn-append')).toBe(true);
  });

  it('is cleared with the diagram and built again by the next import', async () => {
    t = await open();
    await flush();
    expect(buttons()).toHaveLength(1);
    await t.modeler.importXML(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="x">
  <bpmn:process id="P" isExecutable="true"><bpmn:startEvent id="s" /><bpmn:task id="a" /><bpmn:sequenceFlow id="f" sourceRef="s" targetRef="a" /></bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
    <bpmndi:BPMNShape id="s_di" bpmnElement="s"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="a_di" bpmnElement="a"><dc:Bounds x="200" y="80" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="f_di" bpmnElement="f"><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="136" y="118" /><di:waypoint xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="200" y="120" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`);
    await flush();
    expect(indicator(t).ids()).toEqual(['a']);
    expect(buttons().map((b) => b.dataset['elementId'])).toEqual(['a']);
  });
});

describe('U30 keyboard palette', () => {
  const palette = (): HTMLElement => document.querySelector<HTMLElement>('.djs-palette')!;
  const entries = (): HTMLElement[] => [...palette().querySelectorAll<HTMLElement>('.entry[data-action]')];
  const key = (target: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it('is a toolbar of named buttons with one Tab stop (roving tabindex)', async () => {
    t = await open();
    expect(palette().getAttribute('role')).toBe('toolbar');
    expect(palette().getAttribute('aria-label')).toBe('Palette');
    expect(palette().getAttribute('aria-orientation')).toBe('vertical');
    const all = entries();
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((e) => e.tabIndex === 0)).toHaveLength(1);
    expect(all[0]!.tabIndex).toBe(0);
    for (const entry of all) {
      expect(entry.getAttribute('role'), entry.dataset['action']).toBe('button');
      expect(entry.getAttribute('aria-label'), entry.dataset['action']).toBeTruthy();
    }
  });

  it('moves with the arrow keys, wraps around and jumps with Home and End', async () => {
    t = await open();
    const all = entries();
    all[0]!.focus();
    expect(key(all[0]!, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(all[1]);
    expect(all[1]!.tabIndex).toBe(0);
    expect(all[0]!.tabIndex).toBe(-1);
    key(all[1]!, 'ArrowUp');
    expect(document.activeElement).toBe(all[0]);
    key(all[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(all[all.length - 1]);
    key(all[all.length - 1]!, 'ArrowRight');
    expect(document.activeElement).toBe(all[0]);
    key(all[0]!, 'End');
    expect(document.activeElement).toBe(all[all.length - 1]);
    key(all[all.length - 1]!, 'Home');
    expect(document.activeElement).toBe(all[0]);
    // a mouse click on an entry makes it the Tab stop too
    all[3]!.focus();
    expect(all.filter((e) => e.tabIndex === 0)).toEqual([all[3]]);
  });

  it('Enter on a tool entry activates the tool and Space does the same', async () => {
    t = await open();
    const hand = entries().find((e) => e.dataset['action'] === 'hand-tool')!;
    hand.focus();
    key(hand, 'Enter');
    expect(t.get<{ isActive(): boolean }>('handTool').isActive()).toBe(true);
    expect(hand.getAttribute('aria-pressed')).toBe('true');
    const lasso = entries().find((e) => e.dataset['action'] === 'lasso-tool')!;
    key(lasso, ' ');
    expect(t.get<{ isActive(): boolean }>('lassoTool').isActive()).toBe(true);
    expect(entries().find((e) => e.dataset['action'] === 'hand-tool')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('Enter on a create entry puts the element on the canvas, selects it and gives the focus back to the canvas', async () => {
    t = await open();
    const before = new Set(t.registry.getAll().map((e) => e.id));
    const task = entries().find((e) => e.dataset['action'] === 'create.task')!;
    task.focus();
    key(task, 'Enter');
    const added = t.registry.getAll().filter((e) => !before.has(e.id) && !e.labelTarget);
    expect(added).toHaveLength(1);
    expect(added[0]!.businessObject.$type).toBe('bpmn:Task');
    expect(t.get<{ get(): DiagramElement[] }>('selection').get()).toEqual(added);
    expect(t.get<{ _focused?: boolean }>('canvas')._focused).toBe(true);

    // an entry the support matrix hides cannot be created: the decision task is a service task of the DMN connector
    const decision = entries().find((e) => e.dataset['action'] === 'create.decision-task')!;
    key(decision, 'Enter');
    const service = t.registry.getAll().find((e) => e.businessObject?.$type === 'bpmn:ServiceTask');
    expect(service?.businessObject.get('implementation')).toBe('dmn-connector.EXECUTE_TABLE');
  });

  it('creates a pool with its process; one undo takes it away', async () => {
    t = await open();
    const pool = entries().find((e) => e.dataset['action'] === 'create.participant-expanded')!;
    key(pool, 'Enter');
    expect(t.registry.getAll().some((e) => e.businessObject?.$type === 'bpmn:Participant')).toBe(true);
    t.commandStack.undo();
    expect(t.registry.getAll().some((e) => e.businessObject?.$type === 'bpmn:Participant')).toBe(false);
  });

  it('Escape returns to the canvas and keys with a modifier are left alone', async () => {
    t = await open();
    const first = entries()[0]!;
    first.focus();
    expect(key(first, 'Escape').defaultPrevented).toBe(true);
    expect(t.get<{ _focused?: boolean }>('canvas')._focused).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
