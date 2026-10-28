import * as replaceOptions from 'bpmn-js/lib/features/replace/ReplaceOptions';
import { PopupEntries } from 'bpmn-js/lib/features/popup-menu/PopupEntries';

import { DMN_DECISION_IMPLEMENTATION, judge, placementOf, type ElementSpec, type Placement } from '../../support-matrix';
import type { DiagramElement, ModdleElement } from '../../types';
import { DECISION_TASK_ICON } from '../palette/ActivitiPaletteProvider';
import { entryInfo } from './entryInfo';

interface PopupMenuLike {
  registerProvider(id: string, priority: number, provider: unknown): void;
}
type Entries = Record<string, Record<string, unknown>>;

interface Target {
  type: string;
  isExpanded?: boolean;
  isInterrupting?: boolean;
  triggeredByEvent?: boolean;
  instantiate?: boolean;
  eventGatewayType?: string;
  cancelActivity?: boolean;
  eventDefinitionType?: string;
}

const LOW_PRIORITY = 500;

/** `replace-with-*` action name -> what that replace option creates, from bpmn-js' own option lists. */
const REPLACE_TARGETS: Map<string, Target> = (() => {
  const map = new Map<string, Target>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const option = value as { actionName?: string; target?: Target };
      if (typeof option.actionName === 'string') {
        if (option.target) map.set(option.actionName, option.target);
      } else Object.values(value).forEach(visit);
    }
  };
  visit(replaceOptions);
  return map;
})();

/** catalog id -> target, for the shared popup entry catalog that create / append menus are built from */
const CATALOG: Record<string, { target: Target }> = PopupEntries as never;

function specFromTarget(target: Target): ElementSpec {
  const spec: ElementSpec = { type: target.type };
  if (target.eventDefinitionType) spec.eventDefinitionType = target.eventDefinitionType;
  if (target.isInterrupting !== undefined) spec.isInterrupting = target.isInterrupting;
  if (target.cancelActivity !== undefined) spec.cancelActivity = target.cancelActivity;
  if (target.triggeredByEvent !== undefined) spec.triggeredByEvent = target.triggeredByEvent;
  if (target.isExpanded !== undefined) spec.isExpanded = target.isExpanded;
  if (target.instantiate !== undefined) spec.instantiate = target.instantiate;
  if (target.eventGatewayType !== undefined) spec.eventGatewayType = target.eventGatewayType;
  return spec;
}

/** The target an entry creates: a replace option, a catalog entry (`create-<id>`, `append-<id>`), or an explicit `target`. */
function targetOfEntry(id: string, entry: Record<string, unknown>): Target | undefined {
  const explicit = entry['target'];
  if (explicit && typeof explicit === 'object' && typeof (explicit as Target).type === 'string') return explicit as Target;
  const replace = REPLACE_TARGETS.get(id);
  if (replace) return replace;
  return CATALOG[catalogIdOf(id)]?.target;
}

function filterEntries(entries: Entries, placementFor: () => ReturnType<typeof placementOf>): Entries {
  const placement = placementFor();
  const out: Entries = {};
  for (const [id, entry] of Object.entries(entries)) {
    const target = targetOfEntry(id, entry);
    if (target && !judge(specFromTarget(target), placement).allowed) continue;
    out[id] = entry;
  }
  return out;
}

/** Replace menu: only offers replacements the support matrix allows in that place. */
export class ActivitiReplaceMenuProvider {
  static $inject = ['popupMenu'];

  constructor(popupMenu: PopupMenuLike) {
    popupMenu.registerProvider('bpmn-replace', LOW_PRIORITY, this);
  }

  getPopupMenuEntries(element: DiagramElement): (entries: Entries) => Entries {
    return (entries) => {
      if (!element?.businessObject) return entries;
      return filterEntries(entries, () => placementOf(element.parent?.businessObject ?? undefined, element.host?.businessObject));
    };
  }

  /** Removes the standard loop marker; keeps the multi-instance toggles; the non-interrupting toggle only where the result is allowed. */
  getPopupMenuHeaderEntries(element: DiagramElement): (entries: Entries) => Entries {
    return (entries) => {
      if (!element?.businessObject) return entries;
      const out: Entries = {};
      for (const [id, entry] of Object.entries(entries)) {
        if (id === 'toggle-loop') continue;
        if (id === 'toggle-non-interrupting') {
          const bo = element.businessObject;
          const spec: ElementSpec = { type: bo.$type, eventDefinitionType: (bo.get('eventDefinitions') as Array<{ $type: string }> | undefined)?.[0]?.$type };
          if (bo.$instanceOf('bpmn:BoundaryEvent')) spec.cancelActivity = bo.get('cancelActivity') === false;
          else spec.isInterrupting = bo.get('isInterrupting') === false;
          if (!judge(spec, placementOf(element.parent?.businessObject ?? undefined, element.host?.businessObject)).allowed) continue;
        }
        out[id] = entry;
      }
      return out;
    };
  }
}

interface Entry extends Record<string, unknown> {
  group?: { id: string; name: string };
  description?: string;
}

interface Shape {
  id?: string;
  businessObject: ModdleElement;
}
interface ElementFactoryLike {
  create(kind: 'shape', attrs: Record<string, unknown>): Shape;
}
interface BpmnFactoryLike {
  create(type: string, attrs?: Record<string, unknown>): ModdleElement;
}
interface CreateLike {
  start(event: unknown, shape: unknown, context?: Record<string, unknown>): void;
}
interface AutoPlaceLike {
  append(source: DiagramElement, shape: unknown): unknown;
}
interface MouseLike {
  getLastMoveEvent(): unknown;
}
interface RulesLike {
  allowed(action: string, context: Record<string, unknown>): unknown;
}
interface InjectorLike {
  get<T>(name: string, strict?: boolean): T | null;
}

type MenuKind = 'create' | 'append';

const TASK_GROUP = { id: 'tasks', name: 'Tasks' };
const DECISION_ENTRY_ID = 'decision-task';

/** The catalog id of an entry id the module built: `create-user-task`, `append-user-task`, `create-replace-with-non-interrupting-message-start`, `replace-with-user-task`. */
function catalogIdOf(id: string): string {
  return id.replace(/^(?:create|append|replace-with)[.-]/, '').replace(/^replace-with-/, '');
}

/**
 * Hook for the create / append popup menus of `bpmn-js-create-append-anything` (feature U5). It
 *  - removes every entry whose target the support matrix hides (resolved from the entry itself, from the shared popup-entry
 *    catalog of bpmn-js, or from the replace options),
 *  - judges boundary events by the activity they would attach to (append) or by an ordinary activity (create),
 *  - leaves only intermediate catch events behind an event-based gateway,
 *  - adds the Decision task, a description of each element and a link to its page of the user guide.
 */
export class ActivitiCreateAppendFilter {
  static $inject = ['popupMenu', 'elementFactory', 'bpmnFactory', 'create', 'injector', 'translate'];

  private readonly elementFactory: ElementFactoryLike;
  private readonly bpmnFactory: BpmnFactoryLike;
  private readonly create: CreateLike;
  private readonly injector: InjectorLike;
  private readonly translate: (text: string) => string;
  private readonly popupMenu: PopupMenuLike & { close?(): void };

  constructor(popupMenu: PopupMenuLike, elementFactory: ElementFactoryLike, bpmnFactory: BpmnFactoryLike, create: CreateLike, injector: InjectorLike, translate: (text: string) => string) {
    this.popupMenu = popupMenu;
    this.elementFactory = elementFactory;
    this.bpmnFactory = bpmnFactory;
    this.create = create;
    this.injector = injector;
    this.translate = translate;
    popupMenu.registerProvider('bpmn-create', LOW_PRIORITY, this.providerFor('create'));
    popupMenu.registerProvider('bpmn-append', LOW_PRIORITY, this.providerFor('append'));
  }

  private providerFor(kind: MenuKind): { getPopupMenuEntries(element: DiagramElement): (entries: Entries) => Entries } {
    return { getPopupMenuEntries: (element) => (entries) => this.refine(kind, element, entries) };
  }

  private refine(kind: MenuKind, element: DiagramElement, entries: Entries): Entries {
    const bo = element?.businessObject;
    const placement: Placement = kind === 'append' ? placementOf(element?.parent?.businessObject ?? undefined) : { container: 'process' };
    const fromEventGateway = kind === 'append' && bo?.$instanceOf?.('bpmn:EventBasedGateway') === true;
    const host = kind === 'append' && bo?.$instanceOf?.('bpmn:Activity') ? bo : undefined;

    const out: Entries = {};
    for (const [id, entry] of Object.entries(entries)) {
      const target = targetOfEntry(id, entry);
      if (target) {
        const spec = specFromTarget(target);
        if (!this.allowed(kind, spec, placement, host)) continue;
        if (fromEventGateway && spec.type !== 'bpmn:IntermediateCatchEvent') continue;
      }
      out[id] = this.decorate(id, entry);
      if (id === `${kind}-service-task`) this.addDecisionTask(kind, element, placement, fromEventGateway, out);
    }
    // a menu without a service task entry (filtered, or another provider) still gets the Decision task
    if (!(`${kind}-${DECISION_ENTRY_ID}` in out)) this.addDecisionTask(kind, element, placement, fromEventGateway, out);
    return out;
  }

  private allowed(kind: MenuKind, spec: ElementSpec, placement: Placement, host: ModdleElement | undefined): boolean {
    // a non-interrupting start event only means something in an event sub process, where the replace menu offers it
    if (spec.type === 'bpmn:StartEvent' && spec.isInterrupting === false) return false;
    if (spec.type === 'bpmn:BoundaryEvent') {
      // the append menu attaches to the element it was opened on; the create menu does not know its host yet and offers
      // what fits an ordinary activity (a cancel boundary event is for transactions: append it to one)
      return judge(spec, host ? { ...placement, attachedTo: host.$type } : kind === 'create' ? { ...placement, attachedTo: 'bpmn:Task' } : placement).allowed;
    }
    return judge(spec, placement).allowed;
  }

  private decorate(id: string, entry: Record<string, unknown>): Record<string, unknown> {
    const info = entryInfo(catalogIdOf(id));
    if (!info) return entry;
    const e = entry as Entry;
    const decorated: Entry = { ...e };
    if (e.description === undefined) decorated.description = this.translate(info.description);
    if (info.documentationRef && e['documentationRef'] === undefined) decorated['documentationRef'] = info.documentationRef;
    return decorated;
  }

  /** Decision task: a service task that calls the DMN connector. Offered wherever a service task is. */
  private addDecisionTask(kind: MenuKind, element: DiagramElement, placement: Placement, fromEventGateway: boolean, out: Entries): void {
    const id = `${kind}-${DECISION_ENTRY_ID}`;
    if (id in out || fromEventGateway) return;
    if (!judge({ type: 'bpmn:ServiceTask', implementation: DMN_DECISION_IMPLEMENTATION }, placement).allowed) return;
    if (kind === 'append' && this.injector.get<RulesLike>('rules', false)?.allowed('shape.append', { element }) === false) return;
    const info = entryInfo(DECISION_ENTRY_ID);
    const newShape = (): Shape => {
      const businessObject = this.bpmnFactory.create('bpmn:ServiceTask', { implementation: DMN_DECISION_IMPLEMENTATION, name: this.translate('Decision task') });
      return this.elementFactory.create('shape', { type: 'bpmn:ServiceTask', businessObject });
    };
    const mouse = this.injector.get<MouseLike>('mouse', false);
    const pointer = (event: unknown): unknown => (typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent && mouse ? mouse.getLastMoveEvent() : event);
    const place = (event: unknown): void => {
      this.popupMenu.close?.();
      this.create.start(pointer(event), newShape(), kind === 'append' ? { source: element } : undefined);
    };
    const autoPlace = this.injector.get<AutoPlaceLike>('autoPlace', false);
    out[id] = {
      label: this.translate('Decision task'),
      imageUrl: DECISION_TASK_ICON,
      description: this.translate(info?.description ?? ''),
      ...(info?.documentationRef ? { documentationRef: info.documentationRef } : {}),
      group: TASK_GROUP,
      search: 'decision dmn rule table business rule',
      action:
        kind === 'append' && autoPlace
          ? { click: () => void autoPlace.append(element, newShape()), dragstart: place }
          : { click: place, dragstart: place },
    };
  }
}

export const PopupMenuModule = {
  __init__: ['activitiReplaceMenuProvider', 'activitiCreateAppendFilter'],
  activitiReplaceMenuProvider: ['type', ActivitiReplaceMenuProvider],
  activitiCreateAppendFilter: ['type', ActivitiCreateAppendFilter],
};
