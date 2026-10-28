import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything';
import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import { buildKitchenSink } from '../../../test-support/kitchen-sink';
import { judge, placementOf, specOfBusinessObject } from '../../support-matrix';
import type { DiagramElement } from '../../types';
import { ENTRY_INFO_IDS, entryInfo, GUIDE_BASE } from './entryInfo';

/**
 * U5: the real `bpmn-js-create-append-anything` menus (the `N` and `A` keys open them), restricted to what Activiti 9 runs.
 * The menus are read through the popup menu service, which is what the popup renders.
 */

let t: Built | undefined;
afterEach(() => t?.destroy());

interface Entry {
  label?: string;
  description?: string;
  documentationRef?: string;
  group?: { id: string; name: string };
  rank?: number;
  imageUrl?: string;
  action?: { click?: (event: Event) => void; dragstart?: (event: Event) => void };
}
interface PopupMenu {
  _getProviders(id: string): unknown[];
  _getEntries(target: DiagramElement, providers: unknown[]): Record<string, Entry>;
  isEmpty(target: DiagramElement, id: string): boolean;
}

const open = () => createBuilt(undefined, { extraModules: [CreateAppendAnythingModule] });

const menu = (built: Built, kind: 'create' | 'append', element: DiagramElement): Record<string, Entry> => {
  const popup = built.get<PopupMenu>('popupMenu');
  return popup._getEntries(element, popup._getProviders(`bpmn-${kind}`));
};
const ids = (entries: Record<string, Entry>, kind: 'create' | 'append'): string[] => Object.keys(entries).map((k) => k.replace(`${kind}-`, ''));

describe('U5 the create menu (N) offers only what Activiti 9 runs', () => {
  it('has the tasks, gateways, events, sub processes, data and pools of FEATURE_MATRIX §A and the Decision task', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const found = ids(menu(t, 'create', root), 'create');
    for (const id of [
      'task', 'user-task', 'service-task', 'decision-task', 'send-task', 'receive-task', 'manual-task', 'script-task', 'call-activity',
      'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway', 'event-based-gateway',
      'transaction', 'event-subprocess', 'collapsed-subprocess', 'expanded-subprocess',
      'none-start-event', 'message-start', 'timer-start', 'signal-start', 'none-intermediate-throwing', 'none-end-event',
      'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch', 'link-intermediate-catch', 'link-intermediate-throw',
      'compensation-intermediate-throw', 'signal-intermediate-catch', 'signal-intermediate-throw',
      'message-end', 'error-end', 'terminate-end', 'data-store-reference', 'data-object-reference', 'expanded-pool', 'collapsed-pool',
      'message-boundary', 'timer-boundary', 'error-boundary', 'signal-boundary', 'compensation-boundary', 'non-interrupting-timer-boundary',
    ]) {
      expect(found, id).toContain(id);
    }
  });

  it('has no conditional or escalation events, no complex gateway, no ad-hoc sub process, no business rule task, no signal end event', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const found = ids(menu(t, 'create', root), 'create');
    const labels = Object.values(menu(t, 'create', root)).map((e) => String(e.label).toLowerCase());
    for (const id of [
      'conditional-start', 'conditional-intermediate-catch', 'conditional-boundary', 'non-interrupting-conditional-start', 'non-interrupting-conditional-boundary',
      'escalation-start', 'escalation-intermediate-throw', 'escalation-boundary', 'escalation-end', 'non-interrupting-escalation-start', 'non-interrupting-escalation-boundary',
      'complex-gateway', 'collapsed-ad-hoc-subprocess', 'expanded-ad-hoc-subprocess', 'rule-task', 'signal-end', 'compensation-end', 'compensation-start',
      // meaningful only in a place the create menu cannot know: an event sub process, a transaction
      'error-start', 'cancel-end', 'cancel-boundary', 'non-interrupting-message-start', 'non-interrupting-timer-start', 'non-interrupting-signal-start',
    ]) {
      expect(found, id).not.toContain(id);
    }
    for (const word of ['conditional', 'escalation', 'complex', 'ad-hoc', 'business rule']) expect(labels.filter((l) => l.includes(word)), word).toEqual([]);
  });

  it('judges every entry of the module by the support matrix (nothing that the matrix hides is left)', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const entries = menu(t, 'create', root);
    // a shape made by each entry's action, read back from create.start
    const create = t.get<{ start(event: unknown, shape: unknown): void }>('create');
    const original = create.start;
    const made: Array<{ id: string; spec: ReturnType<typeof specOfBusinessObject> }> = [];
    let current = '';
    create.start = (_event, shape) => {
      const bo = (([] as DiagramElement[]).concat(shape as DiagramElement)[0] as DiagramElement).businessObject;
      made.push({ id: current, spec: specOfBusinessObject(bo) });
    };
    for (const [id, entry] of Object.entries(entries)) {
      current = id;
      entry.action!.click!(new Event('click'));
    }
    create.start = original;
    expect(made.length).toBe(Object.keys(entries).length);
    expect(made.length).toBeGreaterThan(40);
    for (const { id, spec } of made) {
      const boundary = spec.type === 'bpmn:BoundaryEvent';
      // a boundary event is created free and attached on drop, where the attach rule judges the host
      const verdict = boundary ? judge(spec, { container: 'process', attachedTo: 'bpmn:Task' }) : judge(spec, placementOf(undefined));
      expect(verdict.allowed, `${id}: ${verdict.reason ?? ''}`).toBe(true);
    }
  });

  it('shows the less usual entries only when searching (rank), as the module designs it', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const entries = menu(t, 'create', root);
    expect(entries['create-inclusive-gateway']!.rank).toBe(-1);
    expect(entries['create-send-task']!.rank).toBe(-1);
    expect(entries['create-user-task']!.rank ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('describes every entry it knows and links the user guide page of the element', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const entries = menu(t, 'create', root);
    for (const [id, entry] of Object.entries(entries)) {
      const catalogId = id.replace(/^create-/, '').replace(/^replace-with-/, '');
      if (!ENTRY_INFO_IDS.includes(catalogId)) continue;
      expect(entry.description, id).toBeTruthy();
    }
    expect(entries['create-user-task']!.description).toMatch(/assign/i);
    expect(entries['create-user-task']!.documentationRef).toBe(`${GUIDE_BASE}user-assignment.md`);
    expect(entries['create-timer-boundary']!.documentationRef).toBe(`${GUIDE_BASE}timer.md`);
    // the entries the matrix allows are either described or deliberately plain
    const plain = Object.keys(entries).map((k) => k.replace('create-', '')).filter((id) => !ENTRY_INFO_IDS.includes(id));
    expect(plain.length, `undescribed: ${plain.join(', ')}`).toBeLessThanOrEqual(2);
  });

  it('every guide page an entry links to exists in docs/user-guide/properties', () => {
    const dir = resolve(__dirname, '../../../../../../docs/user-guide/properties');
    for (const id of ENTRY_INFO_IDS) {
      const info = entryInfo(id)!;
      if (info.page) expect(existsSync(resolve(dir, `${info.page}.md`)), `${id} -> ${info.page}.md`).toBe(true);
    }
  });

  it('offers the Decision task: a service task that calls the DMN connector', async () => {
    t = await open();
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();
    const entry = menu(t, 'create', root)['create-decision-task']!;
    expect(entry.label).toBe('Decision task');
    expect(entry.group?.id).toBe('tasks');
    expect(entry.imageUrl).toContain('image/svg+xml');
    const create = t.get<{ start(event: unknown, shape: unknown): void }>('create');
    let made: DiagramElement | undefined;
    create.start = (_event, shape) => void (made = shape as DiagramElement);
    entry.action!.click!(new Event('click'));
    expect(made!.businessObject.$type).toBe('bpmn:ServiceTask');
    expect(made!.businessObject.get('implementation')).toBe('dmn-connector.EXECUTE_TABLE');
    // it sits right behind the service task
    const keys = Object.keys(menu(t, 'create', root));
    expect(keys.indexOf('create-decision-task')).toBe(keys.indexOf('create-service-task') + 1);
  });
});

describe('U5 the append menu (A) offers what may follow the selected element', () => {
  it('after a task: tasks, gateways, intermediate and end events, boundary events of the task; no start event, no participant', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    const found = ids(menu(t, 'append', t.element('t_user')), 'append');
    for (const id of ['user-task', 'service-task', 'decision-task', 'exclusive-gateway', 'parallel-gateway', 'none-end-event', 'terminate-end', 'error-end', 'timer-intermediate-catch', 'timer-boundary', 'error-boundary', 'message-boundary', 'signal-boundary', 'compensation-boundary', 'expanded-subprocess', 'data-object-reference']) {
      expect(found, id).toContain(id);
    }
    for (const id of [
      'none-start-event', 'message-start', 'expanded-pool', 'collapsed-pool', 'cancel-boundary', 'cancel-end', 'error-start',
      'conditional-intermediate-catch', 'escalation-intermediate-throw', 'escalation-end', 'escalation-boundary', 'conditional-boundary', 'signal-end', 'complex-gateway', 'rule-task', 'expanded-ad-hoc-subprocess', 'collapsed-ad-hoc-subprocess',
    ]) {
      expect(found, id).not.toContain(id);
    }
  });

  it('on a transaction the cancel boundary event is offered; on a task it is not', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    expect(ids(menu(t, 'append', t.element('tx')), 'append')).toContain('cancel-boundary');
    expect(ids(menu(t, 'append', t.element('t_user')), 'append')).not.toContain('cancel-boundary');
  });

  it('boundary events are not offered on a gateway, which cannot host them', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    const found = ids(menu(t, 'append', t.element('g_x')), 'append');
    expect(found.filter((id) => id.endsWith('-boundary'))).toEqual([]);
    expect(found).toContain('user-task');
  });

  it('behind an event-based gateway only intermediate catch events are offered', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    const found = ids(menu(t, 'append', t.element('g_e')), 'append');
    expect(found.sort()).toEqual(['link-intermediate-catch', 'message-intermediate-catch', 'signal-intermediate-catch', 'timer-intermediate-catch']);
  });

  it('appends no element after an end event, a link throw event or a compensation handler', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    expect(menu(t, 'append', t.element('e_none'))).toEqual({});
    const popup = t.get<PopupMenu>('popupMenu');
    expect(popup.isEmpty(t.element('e_none'), 'bpmn-append')).toBe(true);
  });

  it('appending the Decision task after a task places a connected service task with the DMN implementation', async () => {
    t = await open();
    const task = t.builder.createShape({ type: 'userTask', id: 'review', after: 'StartEvent_1' });
    const entry = menu(t, 'append', t.element(task))['append-decision-task']!;
    expect(entry).toBeTruthy();
    entry.action!.click!(new Event('click'));
    const decision = t.registry.getAll().find((e) => e.businessObject?.$type === 'bpmn:ServiceTask' && e.businessObject.get('implementation') === 'dmn-connector.EXECUTE_TABLE')!;
    expect(decision).toBeTruthy();
    expect(t.element(task).outgoing?.[0]?.target).toBe(decision);
  });

  it('inside a sub process a typed start event is never offered, and inside an event sub process neither', async () => {
    t = await open();
    buildKitchenSink(t.builder);
    const inner = t.builder.createShape({ type: 'userTask', id: 'inSub', parent: 'sp' });
    const found = ids(menu(t, 'append', t.element(inner)), 'append');
    expect(found.filter((id) => id.endsWith('-start') || id.includes('start-event'))).toEqual([]);
  });

  it('every entry of the append menu of every sample creates something the matrix allows', async () => {
    t = await open();
    const samples = buildKitchenSink(t.builder);
    const autoPlace = t.get<{ append(source: DiagramElement, shape: DiagramElement): void }>('autoPlace');
    const create = t.get<{ start(event: unknown, shape: unknown, context?: unknown): void }>('create');
    const modeling = t.get<{ createElements(shapes: unknown, position: unknown, target: unknown, hints?: unknown): DiagramElement[] }>('modeling');
    const originalPlace = autoPlace.append;
    const originalStart = create.start;
    const originalCreateElements = modeling.createElements;
    const captured: DiagramElement[] = [];
    autoPlace.append = (_s, shape) => void captured.push(shape);
    create.start = (_e, shape) => void captured.push(...([] as DiagramElement[]).concat(shape as DiagramElement));
    modeling.createElements = (shapes) => {
      captured.push(...([] as DiagramElement[]).concat(shapes as DiagramElement));
      return [];
    };
    let checked = 0;
    for (const sample of samples) {
      const element = t.element(sample.id);
      for (const [id, entry] of Object.entries(menu(t, 'append', element))) {
        captured.length = 0;
        (entry.action!.click ?? entry.action!.dragstart)!(new Event('click'));
        for (const shape of captured) {
          const bo = shape.businessObject;
          const spec = specOfBusinessObject(bo);
          const host = bo.$instanceOf('bpmn:BoundaryEvent') ? element.businessObject : undefined;
          const verdict = judge(spec, placementOf(element.parent?.businessObject, host));
          expect(verdict.allowed, `${id} after ${sample.id}: ${verdict.reason ?? ''}`).toBe(true);
          if (element.businessObject.$instanceOf('bpmn:EventBasedGateway')) expect(bo.$instanceOf('bpmn:IntermediateCatchEvent'), `${id} after the event gateway`).toBe(true);
          checked += 1;
        }
      }
    }
    autoPlace.append = originalPlace;
    create.start = originalStart;
    modeling.createElements = originalCreateElements;
    expect(checked).toBeGreaterThan(300);
  });
});
