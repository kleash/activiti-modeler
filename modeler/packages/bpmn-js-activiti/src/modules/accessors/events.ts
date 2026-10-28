import { allowedEventDefinitions, judge, placementOf, specOfBusinessObject, type ElementSpec, type Placement } from '../../support-matrix';
import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertOneOf, assertString, bo, createModdle, definitionsOf, extensionsOfType, formalExpression, nestedAttr, orUndefined, renameModdleElement, replaceExtensions, shapeOfEventDefinition } from './helpers';
import { createField, readField, type FieldInput } from './implementation';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

const EVENTS = ['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent'];
const isEvent = (el: DiagramElement): boolean => EVENTS.some((t) => is(el, t)) && !el.labelTarget;

/** First event definition of the given type (`bpmn:TimerEventDefinition`). */
const definitionOf = (el: DiagramElement, type: string): ModdleElement | undefined =>
  ((bo(el).get('eventDefinitions') as ModdleElement[] | undefined) ?? []).find((d) => d.$instanceOf(type));
const holderFor = (type: string) => (el: DiagramElement): ModdleElement | undefined => (isEvent(el) ? definitionOf(el, type) : undefined);
const hasDefinition = (type: string) => (el: DiagramElement): boolean => isEvent(el) && definitionOf(el, type) !== undefined;

// --- event definition type ------------------------------------------------------------------------------------------------

export type EventDefinitionName = 'none' | 'message' | 'timer' | 'signal' | 'error' | 'terminate' | 'cancel' | 'compensate' | 'link';
const DEFINITION_NAMES: readonly EventDefinitionName[] = ['none', 'message', 'timer', 'signal', 'error', 'terminate', 'cancel', 'compensate', 'link'];
const typeName = (name: EventDefinitionName): string | undefined => (name === 'none' ? undefined : `bpmn:${name[0]!.toUpperCase()}${name.slice(1)}EventDefinition`);
const nameOf = (type: string | undefined): EventDefinitionName | string => (type ? type.replace(/^bpmn:/, '').replace(/EventDefinition$/, '').replace(/^./, (c) => c.toLowerCase()) : 'none');

/** Placement of an existing event for the support-matrix check. */
export function placementOfElement(el: DiagramElement): Placement {
  return placementOf(el.parent?.businessObject, el.host?.businessObject);
}

const eventDefinition: PropertyAccessor<EventDefinitionName | string> = {
  key: 'event.definition',
  group: 'Event definitions',
  label: 'Event type',
  writes: 'xml',
  appliesTo: isEvent,
  get: (_c, el) => {
    const definitions = (bo(el).get('eventDefinitions') as ModdleElement[] | undefined) ?? [];
    return definitions.length === 0 ? 'none' : nameOf(definitions[0]!.$type);
  },
  set: (ctx, el, value) => {
    assertOneOf('event.definition', value, DEFINITION_NAMES, 'event type');
    const spec: ElementSpec = { ...specOfBusinessObject(bo(el)), eventDefinitionType: typeName(value) };
    delete spec.multipleDefinitions;
    // error and cancel events are always interrupting: the replacement is made interrupting, so judge that
    const interrupting = value === 'error' || value === 'cancel';
    if (is(el, 'bpmn:BoundaryEvent') && interrupting) spec.cancelActivity = true;
    const verdict = judge(spec, placementOfElement(el));
    if (!verdict.allowed) {
      const allowed = allowedEventDefinitions(el.type as never, placementOfElement(el)).map((t) => nameOf(t)).join(', ');
      throw new AccessorError('NOT_OFFERED', 'event.definition', `${verdict.reason ?? 'not offered'}; allowed here: ${allowed}`);
    }
    if (value !== 'none' && definitionOf(el, spec.eventDefinitionType ?? '')) return;
    const target: Record<string, unknown> = { type: el.type };
    if (spec.eventDefinitionType) target['eventDefinitionType'] = spec.eventDefinitionType;
    if (is(el, 'bpmn:StartEvent') && el.parent && bo(el.parent).get('triggeredByEvent') === true) target['isInterrupting'] = interrupting ? true : bo(el).get('isInterrupting') !== false;
    if (is(el, 'bpmn:BoundaryEvent')) target['cancelActivity'] = interrupting ? true : bo(el).get('cancelActivity') !== false;
    ctx.bpmnReplace.replaceElement(el, target);
  },
};

const firstDefinition = (el: DiagramElement): ModdleElement | undefined => ((bo(el).get('eventDefinitions') as ModdleElement[] | undefined) ?? [])[0];

/** The id of the event definition, which link events (and the catch event sources) refer to. */
const eventDefinitionId: PropertyAccessor<string> = {
  key: 'event.definitionId',
  group: 'Event definitions',
  label: 'Event definition ID',
  writes: 'xml',
  appliesTo: (el) => isEvent(el) && firstDefinition(el) !== undefined,
  get: (_c, el) => firstDefinition(el)!.id as string,
  set: (ctx, el, value) => renameModdleElement(ctx, 'event.definitionId', el, firstDefinition(el)!, value),
};

// --- timer ---------------------------------------------------------------------------------------------------------------

export interface TimerValue {
  type: 'date' | 'duration' | 'cycle';
  value: string;
  /** `activiti:endDate` of a cycle */
  endDate?: string;
}

const TIMER = 'bpmn:TimerEventDefinition';
const TIMER_PROP = { date: 'timeDate', duration: 'timeDuration', cycle: 'timeCycle' } as const;

const timerDefinition: PropertyAccessor<TimerValue | undefined> = {
  key: 'timer.definition',
  group: 'Timer',
  label: 'Timer',
  writes: 'xml',
  appliesTo: hasDefinition(TIMER),
  get: (_c, el) => {
    const def = definitionOf(el, TIMER);
    if (!def) return undefined;
    for (const [type, prop] of Object.entries(TIMER_PROP) as Array<['date' | 'duration' | 'cycle', string]>) {
      const expression = def.get(prop) as ModdleElement | undefined;
      if (expression) {
        const out: TimerValue = { type, value: (expression.get('body') as string | undefined) ?? '' };
        const end = expression.get('activiti:endDate') as string | undefined;
        if (end !== undefined) out.endDate = end;
        return out;
      }
    }
    return undefined;
  },
  set: (ctx, el, value) => {
    const def = definitionOf(el, TIMER);
    if (!def) throw new AccessorError('NOT_APPLICABLE', 'timer.definition', `${el.id} has no timer event definition`);
    const cleared: Record<string, unknown> = { timeDate: undefined, timeDuration: undefined, timeCycle: undefined };
    if (value) {
      assertOneOf('timer.definition', value.type, ['date', 'duration', 'cycle'], 'timer type');
      if (!value.value?.trim()) throw new AccessorError('INVALID_VALUE', 'timer.definition', 'a timer needs a value (ISO 8601 date or duration, repeating interval or cron)');
      if (value.endDate && value.type !== 'cycle') throw new AccessorError('INVALID_VALUE', 'timer.definition', 'endDate only applies to a cycle');
      const expression = formalExpression(ctx, value.value);
      if (value.endDate) expression.set('activiti:endDate', value.endDate);
      cleared[TIMER_PROP[value.type]] = expression;
    }
    ctx.modeling.updateModdleProperties(el, def, cleared);
  },
};

// --- message / signal / error ---------------------------------------------------------------------------------------------

function rootElementsOf(el: DiagramElement, type: string): ModdleElement[] {
  return ((definitionsOf(el).get('rootElements') as ModdleElement[] | undefined) ?? []).filter((r) => r.$instanceOf(type));
}

/** Name-based reference: reuses the definitions-level element with that name, or creates it (DefinitionsReferenceBehavior registers it). */
function refAccessor(options: { key: string; group: string; label: string; definition: string; refProperty: string; rootType: string; matchBy: 'name' | 'errorCode' }): PropertyAccessor<string | undefined> {
  return {
    key: options.key,
    group: options.group,
    label: options.label,
    writes: 'xml',
    appliesTo: hasDefinition(options.definition),
    get: (_c, el) => (definitionOf(el, options.definition)?.get(options.refProperty) as ModdleElement | undefined)?.get(options.matchBy) as string | undefined,
    set: (ctx, el, value) => {
      const def = definitionOf(el, options.definition);
      if (!def) throw new AccessorError('NOT_APPLICABLE', options.key, `${el.id} has no ${options.group} event definition`);
      if (value !== undefined) assertString(options.key, value);
      let target: ModdleElement | undefined;
      if (value) {
        target = rootElementsOf(el, options.rootType).find((r) => r.get(options.matchBy) === value);
        if (!target) {
          const attrs: Record<string, unknown> = options.matchBy === 'errorCode' ? { name: value, errorCode: value } : { name: value };
          target = ctx.bpmnFactory.create(options.rootType, attrs);
        }
      }
      ctx.modeling.updateModdleProperties(el, def, { [options.refProperty]: target });
    },
  };
}

const MESSAGE = 'bpmn:MessageEventDefinition';
const SIGNAL = 'bpmn:SignalEventDefinition';
const ERROR = 'bpmn:ErrorEventDefinition';

const messageFields: PropertyAccessor<FieldInput[]> = {
  key: 'message.fields',
  group: 'Message / Signal / Error / Link / Compensation / Terminate',
  label: 'Message payload fields',
  writes: 'xml',
  appliesTo: hasDefinition(MESSAGE),
  get: (_c, el) => extensionsOfType(definitionOf(el, MESSAGE)!, 'activiti:Field').map(readField),
  set: (ctx, el, value) => {
    const def = definitionOf(el, MESSAGE)!;
    replaceExtensions(ctx, el, def, (v) => v.$type === 'activiti:Field', value.map((f) => createField(ctx, 'message.fields', f)));
  },
};

const GROUP = 'Message / Signal / Error / Link / Compensation / Terminate';

// --- link ----------------------------------------------------------------------------------------------------------------

const LINK = 'bpmn:LinkEventDefinition';
const sourcesOf = (definition: ModdleElement): ModdleElement[] => ((definition.get('source') as ModdleElement[] | undefined) ?? []).slice();

/**
 * The link catch event a link throw event jumps to (its element id). Both ends of the link are written: the throw
 * event's `target` and the catch event's `source` list, which is what Activiti's parser and the engine read.
 */
const linkTarget: PropertyAccessor<string | undefined> = {
  key: 'link.target',
  group: GROUP,
  label: 'Link target (catch event)',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:IntermediateThrowEvent') && hasDefinition(LINK)(el),
  get: (ctx, el) => {
    const target = definitionOf(el, LINK)?.get('target') as ModdleElement | undefined;
    return target ? shapeOfEventDefinition(ctx.elementRegistry, target)?.id : undefined;
  },
  set: (ctx, el, value) => {
    const definition = definitionOf(el, LINK)!;
    let catchShape: DiagramElement | undefined;
    if (value) {
      assertString('link.target', value);
      catchShape = ctx.elementRegistry.get(value);
      if (!catchShape || !is(catchShape, 'bpmn:IntermediateCatchEvent') || !definitionOf(catchShape, LINK)) {
        throw new AccessorError('INVALID_VALUE', 'link.target', `"${value}" is not a link catch event`);
      }
    }
    const next = catchShape ? definitionOf(catchShape, LINK)! : undefined;
    const previous = definition.get('target') as ModdleElement | undefined;
    if (previous === next) return;
    ctx.batch(() => {
      ctx.modeling.updateModdleProperties(el, definition, { target: next });
      if (previous) {
        const previousShape = shapeOfEventDefinition(ctx.elementRegistry, previous);
        if (previousShape) ctx.modeling.updateModdleProperties(previousShape, previous, { source: sourcesOf(previous).filter((s) => s !== definition) });
      }
      if (next && catchShape) ctx.modeling.updateModdleProperties(catchShape, next, { source: [...sourcesOf(next), definition] });
    });
  },
};
/** Read only: the link throw events that jump to this catch event; they are changed from the throw event's `link.target`. */
const linkSourceIds = (ctx: AccessorContext, el: DiagramElement): string[] =>
  sourcesOf(definitionOf(el, LINK)!)
    .map((source) => shapeOfEventDefinition(ctx.elementRegistry, source)?.id)
    .filter((id): id is string => id !== undefined);

const linkSources: PropertyAccessor<string[]> = {
  key: 'link.sources',
  group: GROUP,
  label: 'Link sources (throw events)',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:IntermediateCatchEvent') && hasDefinition(LINK)(el),
  get: (ctx, el) => linkSourceIds(ctx, el),
  set: (ctx, el, value) => {
    if (JSON.stringify(value) !== JSON.stringify(linkSourceIds(ctx, el))) {
      throw new AccessorError('READ_ONLY', 'link.sources', 'the sources of a link catch event follow from the "link.target" of the throw events');
    }
  },
};
const signalScope: PropertyAccessor<string | undefined> = {
  key: 'signal.scope',
  group: GROUP,
  label: 'Signal scope',
  writes: 'xml',
  appliesTo: (el) => hasDefinition(SIGNAL)(el) && (definitionOf(el, SIGNAL)?.get('signalRef') as ModdleElement | undefined) !== undefined,
  get: (_c, el) => (definitionOf(el, SIGNAL)?.get('signalRef') as ModdleElement | undefined)?.get('activiti:scope') as string | undefined,
  set: (ctx, el, value) => {
    const signal = definitionOf(el, SIGNAL)?.get('signalRef') as ModdleElement | undefined;
    if (!signal) throw new AccessorError('NOT_APPLICABLE', 'signal.scope', 'pick a signal first');
    if (value !== undefined) assertOneOf('signal.scope', value, ['global', 'processInstance'], 'signal scope');
    ctx.modeling.updateModdleProperties(el, signal, { 'activiti:scope': value });
  },
};

const compensateActivity: PropertyAccessor<string | undefined> = {
  key: 'compensate.activityRef',
  group: GROUP,
  label: 'Activity to compensate',
  writes: 'xml',
  appliesTo: hasDefinition('bpmn:CompensateEventDefinition'),
  get: (_c, el) => (definitionOf(el, 'bpmn:CompensateEventDefinition')?.get('activityRef') as ModdleElement | undefined)?.id,
  set: (ctx, el, value) => {
    const def = definitionOf(el, 'bpmn:CompensateEventDefinition')!;
    let activity: ModdleElement | undefined;
    if (value) {
      const target = ctx.elementRegistry.get(value);
      if (!target || !is(target, 'bpmn:Activity')) throw new AccessorError('INVALID_VALUE', 'compensate.activityRef', `"${value}" is not an activity`);
      activity = target.businessObject;
    }
    ctx.modeling.updateModdleProperties(el, def, { activityRef: activity });
  },
};

const eventAttr = (key: string, definition: string, attr: string, label: string, boolean = false, defaultValue = false): PropertyAccessor<string | boolean | undefined> =>
  nestedAttr({ key, group: GROUP, attr, appliesTo: isEvent, holder: holderFor(definition), label, boolean, defaultValue });

export const eventAccessors: AnyAccessor[] = [
  eventDefinition,
  eventDefinitionId,
  timerDefinition,
  nestedAttr({ key: 'timer.businessCalendarName', group: 'Timer', attr: 'activiti:businessCalendarName', appliesTo: isEvent, holder: holderFor(TIMER), label: 'Business calendar' }),
  refAccessor({ key: 'message.ref', group: GROUP, label: 'Message', definition: MESSAGE, refProperty: 'messageRef', rootType: 'bpmn:Message', matchBy: 'name' }),
  eventAttr('message.expression', MESSAGE, 'activiti:messageExpression', 'Message expression'),
  eventAttr('message.correlationKey', MESSAGE, 'activiti:correlationKey', 'Correlation key'),
  eventAttr('message.class', MESSAGE, 'activiti:class', 'Throw delegate class'),
  eventAttr('message.delegateExpression', MESSAGE, 'activiti:delegateExpression', 'Throw delegate expression'),
  messageFields,
  refAccessor({ key: 'signal.ref', group: GROUP, label: 'Signal', definition: SIGNAL, refProperty: 'signalRef', rootType: 'bpmn:Signal', matchBy: 'name' }),
  signalScope,
  eventAttr('signal.expression', SIGNAL, 'activiti:signalExpression', 'Signal expression'),
  eventAttr('signal.async', SIGNAL, 'activiti:async', 'Asynchronous throw', true),
  refAccessor({ key: 'error.ref', group: GROUP, label: 'Error code', definition: ERROR, refProperty: 'errorRef', rootType: 'bpmn:Error', matchBy: 'errorCode' }),
  eventAttr('link.name', LINK, 'name', 'Link name'),
  linkTarget,
  linkSources,
  compensateActivity,
  eventAttr('compensate.waitForCompletion', 'bpmn:CompensateEventDefinition', 'waitForCompletion', 'Wait for completion', true, true),
  eventAttr('terminate.all', 'bpmn:TerminateEventDefinition', 'activiti:terminateAll', 'Terminate all', true),
  eventAttr('terminate.multiInstance', 'bpmn:TerminateEventDefinition', 'activiti:terminateMultiInstance', 'Terminate multi-instance', true),
];

export { orUndefined, createModdle };
export type { AccessorContext };
