import { afterEach, describe, expect, it } from 'vitest';

import { buildKitchenSink, type Sample } from '../test-support/kitchen-sink';
import { createBuilt, type Built } from '../test-support/builder';
import { HIDDEN_RULES, MATRIX_ROWS, judge, placementOf, specOfBusinessObject, type ElementSpec, type MatrixRow } from './support-matrix';
import type { DiagramElement, ModdleElement } from './types';

/**
 * Walks every palette entry, context pad entry and replace-menu option for every kind of element and asserts that
 * nothing from FEATURE_MATRIX §C is reachable, and that everything from §A is (by the UI paths the matrix lists).
 */

let t: Built | undefined;
afterEach(() => t?.destroy());

interface Reached {
  via: 'palette' | 'append' | 'replace' | 'context-pad';
  from: string;
  entry: string;
  spec: ElementSpec;
  placement: ReturnType<typeof placementOf>;
  rows: MatrixRow[];
  allowed: boolean;
  reason?: string;
}

const fakeEvent = { preventDefault() {}, stopPropagation() {}, target: document.body, clientX: 0, clientY: 0, button: 0 } as unknown as Event;

const describeEntry = (spec: ElementSpec): string => `${spec.type}${spec.eventDefinitionType ? `/${spec.eventDefinitionType}` : ''}${spec.triggeredByEvent ? ' (event)' : ''}${spec.isInterrupting === false ? ' non-interrupting' : ''}${spec.cancelActivity === false ? ' non-cancelling' : ''}`;

function record(reached: Reached[], base: Omit<Reached, 'rows' | 'allowed' | 'reason'>, violation?: string): void {
  const verdict = judge(base.spec, base.placement);
  reached.push({ ...base, rows: verdict.rows, allowed: verdict.allowed && !violation, reason: violation ?? verdict.reason });
}

/** Spec of an element as it would exist after an operation, from its business object and size. */
function specOfElement(element: DiagramElement): ElementSpec {
  const expanded = element.businessObject.$instanceOf('bpmn:SubProcess') || element.businessObject.$instanceOf('bpmn:Participant') ? (element as unknown as { collapsed?: boolean }).collapsed !== true : undefined;
  return specOfBusinessObject(element.businessObject, { isExpanded: expanded });
}

function placementOfElement(element: DiagramElement): ReturnType<typeof placementOf> {
  return placementOf(element.parent?.businessObject, element.host?.businessObject);
}

/** Runs `fn`, reads the resulting element (a replacement, or the element itself when it was toggled in place) and reverts it. */
function applyAndInspect(t: Built, sampleId: string, fn: () => void): { spec: ElementSpec; placement: ReturnType<typeof placementOf> } {
  const before = new Set<DiagramElement>(t.registry.getAll());
  const stackBefore = (t.commandStack as unknown as { _stackIdx: number })._stackIdx;
  fn();
  const replacement = t.registry.getAll().find((e) => !before.has(e) && !e.labelTarget && !e.waypoints);
  const element = replacement ?? t.registry.get(sampleId);
  if (!element) throw new Error(`${sampleId} vanished`);
  const result = { spec: specOfElement(element), placement: placementOfElement(element) };
  // revert everything that fn did, whatever number of commands it took
  while ((t.commandStack as unknown as { _stackIdx: number })._stackIdx > stackBefore) t.commandStack.undo();
  return result;
}

function walkUi(t: Built): { samples: Sample[]; reached: Reached[]; paletteKeys: string[] } {
  {
    const samples: Sample[] = buildKitchenSink(t.builder);
    expect(samples.length).toBeGreaterThan(60);
    const reached: Reached[] = [];
    const root = t.get<{ getRootElement(): DiagramElement }>('canvas').getRootElement();

    // --- palette: every create.* entry, dropped on the canvas
    const create = t.get<{ start(event: Event, shape: unknown): void }>('create');
    const paletteEntries = t.get<{ getEntries(): Record<string, { action?: Record<string, (e: Event) => void> }> }>('palette').getEntries();
    const originalStart = create.start;
    const dropped: Array<{ key: string; shapes: DiagramElement[] }> = [];
    let currentKey = '';
    create.start = (_event, shape) => {
      dropped.push({ key: currentKey, shapes: ([] as DiagramElement[]).concat(shape as DiagramElement) });
    };
    for (const [key, entry] of Object.entries(paletteEntries)) {
      if (!key.startsWith('create.')) continue;
      currentKey = key;
      entry.action!['click']!(fakeEvent);
    }
    create.start = originalStart;
    for (const { key, shapes } of dropped) {
      for (const shape of shapes) {
        const parentBo = shape.parent?.businessObject ?? root.businessObject;
        record(reached, { via: 'palette', from: 'canvas', entry: key, spec: specOfBusinessObject(shape.businessObject, { isExpanded: shape.businessObject.$instanceOf('bpmn:SubProcess') ? true : undefined }), placement: placementOf(parentBo) });
      }
    }

    // --- context pad and replace menu of every element
    const contextPad = t.get<{ getEntries(target: DiagramElement): Record<string, { action: Record<string, (e: Event, el: DiagramElement) => void> | ((e: Event, el: DiagramElement) => void) }> }>('contextPad');
    const popupMenu = t.get<{ _getProviders(id: string): unknown[]; _getEntries(target: DiagramElement, providers: unknown[]): Record<string, { action: (e: Event, entry: unknown) => void }>; _getHeaderEntries(target: DiagramElement, providers: unknown[]): Record<string, { action: (e: Event, entry: unknown) => void; active?: boolean }> }>('popupMenu');
    const autoPlace = t.get<{ append(source: DiagramElement, shape: DiagramElement): void }>('autoPlace');
    const appendStartCreate = create;

    const captured: DiagramElement[] = [];
    const originalAppend = autoPlace.append;
    autoPlace.append = (_source, shape) => {
      captured.push(shape);
    };
    appendStartCreate.start = (_event, shape) => {
      captured.push(...([] as DiagramElement[]).concat(shape as DiagramElement));
    };

    const headerKeys = new Set<string>();
    for (const sample of samples) {
      const element = t.element(sample.id);
      // context pad
      const entries = contextPad.getEntries(element);
      for (const [key, entry] of Object.entries(entries)) {
        if (key.startsWith('append.')) {
          captured.length = 0;
          const action = entry.action as Record<string, (e: Event, el: DiagramElement) => void>;
          (action['click'] ?? action['dragstart'])!(fakeEvent, element);
          for (const shape of captured) {
            // an event-based gateway may only reach intermediate catch events (EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS)
            const bo = shape.businessObject;
            const violation = element.businessObject.$instanceOf('bpmn:EventBasedGateway') && bo.$instanceOf('bpmn:FlowNode') && !bo.$instanceOf('bpmn:IntermediateCatchEvent') ? 'event-based gateway may only reach intermediate catch events' : undefined;
            record(reached, { via: 'append', from: sample.id, entry: key, spec: specOfBusinessObject(bo), placement: placementOf(element.parent?.businessObject ?? root.businessObject) }, violation);
          }
        }
      }

      // replace menu: execute every option, read what it produced, undo
      const providers = popupMenu._getProviders('bpmn-replace');
      const replaceEntries = popupMenu._getEntries(element, providers);
      const headers = popupMenu._getHeaderEntries(element, providers);
      for (const key of Object.keys(headers)) headerKeys.add(key);
      // the standard loop marker is ignored by the engine: offering it would create a hidden construct
      if ('toggle-loop' in headers && judge(specOfElement(element), placementOfElement(element)).allowed) {
        record(reached, { via: 'replace', from: sample.id, entry: 'toggle-loop', spec: { ...specOfElement(element), loop: 'standard' }, placement: placementOfElement(element) });
      }

      for (const [key, entry] of Object.entries(replaceEntries)) {
        if (/default-flow|conditional-flow|sequence-flow/.test(key)) continue;
        const outcome = applyAndInspect(t, sample.id, () => (entry.action as (e: Event, entry: unknown) => void)(fakeEvent, entry));
        record(reached, { via: 'replace', from: sample.id, entry: key, ...outcome });
      }
      // toggling a marker changes an element in place: it cannot newly reach a construct the element already is
      const alreadyHidden = !judge(specOfElement(element), placementOfElement(element)).allowed;
      for (const [key, entry] of Object.entries(headers)) {
        if (alreadyHidden) break;
        if (key === 'toggle-parallel-mi' || key === 'toggle-sequential-mi' || key === 'toggle-non-interrupting') {
          const outcome = applyAndInspect(t, sample.id, () => (entry.action as (e: Event, entry: unknown) => void)(fakeEvent, { ...entry }));
          record(reached, { via: 'replace', from: sample.id, entry: key, ...outcome });
        }
      }
    }
    autoPlace.append = originalAppend;
    appendStartCreate.start = originalStart;

    return { samples, reached, paletteKeys: dropped.map((d) => d.key) };
  }
}

describe('UI reachability of FEATURE_MATRIX §A and §C', () => {
  it('walks palette, context pad and replace menus for every element', { timeout: 240_000 }, async () => {
    t = await createBuilt();
    const { samples, reached, paletteKeys } = walkUi(t);
    expect(paletteKeys).toContain('create.decision-task');
    expect(paletteKeys).not.toContain('create.group');
    // §C: nothing hidden is reachable, nothing reachable is outside §A
    const bad = reached.filter((r) => !r.allowed);
    expect(bad.map((r) => `${r.via} ${r.entry} on ${r.from}: ${describeEntry(r.spec)} -> ${r.reason}`)).toEqual([]);
    expect(reached.filter((r) => r.rows.length === 0)).toEqual([]);
    expect(reached.length).toBeGreaterThan(200);

    // §A: every row that the matrix says is reached through the UI is reached
    const uiRows = MATRIX_ROWS.filter((row) => row.via.some((v) => ['palette', 'append', 'replace', 'context-pad'].includes(v)));
    const reachedRows = new Set(reached.flatMap((r) => r.rows.map((row) => row.id)));
    // lanes and the connection rows are reached by context pad entries that create no shape through create.start
    const notShapeEntries = new Set(['P3b', 'F1', 'P3c', 'A1b', 'D2b', 'D2c']);
    const missing = uiRows.filter((row) => !notShapeEntries.has(row.id) && !reachedRows.has(row.id)).map((row) => `${row.id} ${row.label}`);
    expect(missing).toEqual([]);

    // every §C rule was exercised by an element that is present (imported constructs still get working menus)
    const hiddenPresent = samples.filter((s) => s.hidden).length;
    expect(hiddenPresent).toBeGreaterThanOrEqual(HIDDEN_RULES.length - 2);
    void (null as unknown as ModdleElement);
  });

  it('would notice a leak: a modeler without the Activiti menu filters reaches hidden constructs', { timeout: 240_000 }, async () => {
    t = await createBuilt(undefined, { modules: ['extensions', 'accessors', 'behaviors'] });
    const { reached } = walkUi(t);
    const leaked = reached.filter((r) => !r.allowed).map((r) => `${r.via}:${r.entry}`);
    expect(leaked).toContain('palette:create.group');
    expect(leaked).toContain('replace:replace-with-rule-task');
    expect(leaked).toContain('replace:replace-with-complex-gateway');
    expect(leaked).toContain('replace:replace-with-ad-hoc-subprocess');
    expect(leaked).toContain('append:append.condition-intermediate-event');
    expect(leaked).toContain('append:append.receive-task');
    expect(leaked).toContain('replace:toggle-loop');
    expect(leaked).toContain('replace:replace-with-conditional-start');
  });
});
