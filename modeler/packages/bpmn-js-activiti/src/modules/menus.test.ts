import { PopupEntries } from 'bpmn-js/lib/features/popup-menu/PopupEntries';
import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../test-support/builder';
import { buildKitchenSink } from '../../test-support/kitchen-sink';
import { HIDDEN_RULES, judge, placementOf, type ElementSpec } from '../support-matrix';
import type { DiagramElement } from '../types';

let t: Built | undefined;
afterEach(() => t?.destroy());

interface PopupMenu {
  registerProvider(id: string, provider: unknown): void;
  _getProviders(id: string): unknown[];
  _getEntries(target: DiagramElement, providers: unknown[]): Record<string, unknown>;
}

describe('palette', () => {
  it('drops the group, adds the decision task after the task and creates a DMN connector service task', async () => {
    t = await createBuilt();
    const entries = t.get<{ getEntries(): Record<string, { action?: Record<string, (e: Event) => void>; imageUrl?: string; title?: string; group?: string }> }>('palette').getEntries();
    const keys = Object.keys(entries);
    expect(keys).not.toContain('create.group');
    expect(keys.indexOf('create.decision-task')).toBe(keys.indexOf('create.task') + 1);
    expect(keys).toEqual(expect.arrayContaining(['create.start-event', 'create.end-event', 'create.exclusive-gateway', 'create.subprocess-expanded', 'create.participant-expanded', 'create.data-object', 'create.data-store']));
    expect(entries['create.decision-task']!.imageUrl).toContain('image/svg+xml');
    expect(entries['create.decision-task']!.group).toBe('activity');

    const create = t.get<{ start(event: Event, shape: DiagramElement): void }>('create');
    let created: DiagramElement | undefined;
    create.start = (_e, shape) => {
      created = shape;
    };
    entries['create.decision-task']!.action!['click']!({} as Event);
    expect(created!.businessObject.$type).toBe('bpmn:ServiceTask');
    expect(created!.businessObject.get('implementation')).toBe('dmn-connector.EXECUTE_TABLE');
    expect(created!.businessObject.get('name')).toBe('Decision task');
  });
});

describe('context pad', () => {
  it('after an event-based gateway offers intermediate catch events only', async () => {
    t = await createBuilt();
    buildKitchenSink(t.builder);
    const pad = t.get<{ getEntries(el: DiagramElement): Record<string, unknown> }>('contextPad');
    const gateway = Object.keys(pad.getEntries(t.element('g_e'))).filter((k) => k.startsWith('append.')).sort();
    expect(gateway).toEqual(['append.message-intermediate-event', 'append.signal-intermediate-event', 'append.text-annotation', 'append.timer-intermediate-event']);
    const exclusive = Object.keys(pad.getEntries(t.element('g_x'))).filter((k) => k.startsWith('append.')).sort();
    expect(exclusive).toEqual(['append.append-task', 'append.end-event', 'append.gateway', 'append.intermediate-event', 'append.template', 'append.text-annotation']);
  });
});

describe('create / append popup menu filter (hook for bpmn-js-create-append-anything)', () => {
  it('removes every entry whose target the support matrix hides, resolved from the shared popup-entry catalog', async () => {
    t = await createBuilt();
    const popup = t.get<PopupMenu>('popupMenu');
    const catalog = PopupEntries as unknown as Record<string, { target: ElementSpec & { isExpanded?: boolean } }>;
    // a provider like the one of bpmn-js-create-append-anything: one entry per catalog element
    const all = Object.fromEntries(Object.keys(catalog).map((id) => [`create-${id}`, { label: id }]));
    popup.registerProvider('bpmn-create', { getPopupMenuEntries: () => (entries: Record<string, unknown>) => ({ ...entries, ...all }) });
    const entries = popup._getEntries(t.element('StartEvent_1'), popup._getProviders('bpmn-create'));
    const kept = Object.keys(entries).map((k) => k.replace('create-', ''));
    const placement = placementOf(t.element('Process_1').businessObject);
    for (const [id, entry] of Object.entries(catalog)) {
      // two decisions are made by the menu, not by the matrix: a non-interrupting start event needs an event sub process
      // (the replace menu offers it there), and a boundary event is judged by an ordinary activity it could be dropped on
      const nonInterruptingStart = entry.target.type === 'bpmn:StartEvent' && entry.target.isInterrupting === false;
      const allowed = nonInterruptingStart ? false : entry.target.type === 'bpmn:BoundaryEvent' ? judge(entry.target, { ...placement, attachedTo: 'bpmn:Task' }).allowed : judge(entry.target, placement).allowed;
      expect(kept.includes(id), `${id} (${entry.target.type})`).toBe(allowed);
    }
    for (const dropped of ['rule-task', 'complex-gateway', 'collapsed-ad-hoc-subprocess', 'expanded-ad-hoc-subprocess', 'signal-end', 'escalation-start', 'conditional-start', 'compensation-end', 'escalation-end', 'escalation-boundary', 'conditional-boundary', 'non-interrupting-timer-start']) {
      expect(kept, dropped).not.toContain(dropped);
    }
    for (const kept1 of ['user-task', 'service-task', 'timer-start', 'message-start', 'exclusive-gateway', 'event-based-gateway', 'terminate-end', 'error-end', 'timer-boundary', 'error-boundary']) {
      expect(kept, kept1).toContain(kept1);
    }
    // entries that are not catalog elements pass through
    expect(HIDDEN_RULES.length).toBeGreaterThan(10);
  });

  it('keeps an entry that carries no target and honours an explicit target', async () => {
    t = await createBuilt();
    const popup = t.get<PopupMenu>('popupMenu');
    popup.registerProvider('bpmn-append', {
      getPopupMenuEntries: () => (entries: Record<string, unknown>) => ({
        ...entries,
        'append-custom': { label: 'custom' },
        'append-explicit-hidden': { label: 'x', target: { type: 'bpmn:ComplexGateway' } },
        'append-explicit-ok': { label: 'y', target: { type: 'bpmn:UserTask' } },
      }),
    });
    const keys = Object.keys(popup._getEntries(t.element('StartEvent_1'), popup._getProviders('bpmn-append')));
    expect(keys).toEqual(expect.arrayContaining(['append-custom', 'append-explicit-ok']));
    expect(keys).not.toContain('append-explicit-hidden');
  });
});
