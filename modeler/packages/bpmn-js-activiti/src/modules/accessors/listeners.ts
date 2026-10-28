import { type DiagramElement, type ModdleElement, is } from '../../types';
import { bo, createModdle, extensionsOfType, orUndefined, replaceExtensions } from './helpers';
import { createField, readField, type FieldInput } from './implementation';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

/** An execution or task listener as written in XML (attribute-shaped, plus its injected fields). */
export interface ListenerValue {
  event: string;
  class?: string;
  expression?: string;
  delegateExpression?: string;
  onTransaction?: string;
  customPropertiesResolverClass?: string;
  customPropertiesResolverExpression?: string;
  customPropertiesResolverDelegateExpression?: string;
  fields?: FieldInput[];
}

export const EXECUTION_EVENTS = ['start', 'end', 'take'] as const;
export const TASK_EVENTS = ['create', 'assignment', 'complete', 'delete', 'all'] as const;
export const TRANSACTION_MODES = ['before-commit', 'committed', 'rolled-back'] as const;
const LISTENER_ATTRS = ['class', 'expression', 'delegateExpression', 'onTransaction', 'customPropertiesResolverClass', 'customPropertiesResolverExpression', 'customPropertiesResolverDelegateExpression'] as const;

function readListener(l: ModdleElement): ListenerValue {
  const value: ListenerValue = { event: (l.get('event') as string | undefined) ?? '' };
  for (const attr of LISTENER_ATTRS) {
    const v = l.get(attr) as string | undefined;
    if (v !== undefined) value[attr] = v;
  }
  const fields = (l.get('fields') as ModdleElement[] | undefined) ?? [];
  if (fields.length > 0) value.fields = fields.map(readField);
  return value;
}

const IMPLEMENTATION_ATTRS = ['class', 'expression', 'delegateExpression'] as const;
const RESOLVER_ATTRS = ['customPropertiesResolverClass', 'customPropertiesResolverExpression', 'customPropertiesResolverDelegateExpression'] as const;

/**
 * A listener has exactly one implementation attribute. The attribute may be empty: the panel creates a listener when the
 * user picks its type and fills the value in afterwards (an empty `class=""` is a validation error of the engine and a lint
 * error until then), like the Camunda panel does. No attribute at all is refused.
 */
function validateListener(key: string, listener: ListenerValue, events: readonly string[]): void {
  if (!events.includes(listener.event)) throw new AccessorError('INVALID_LISTENER', key, `listener event "${listener.event}" is not one of ${events.join(', ')}`);
  const implementations = IMPLEMENTATION_ATTRS.filter((k) => listener[k] !== undefined);
  if (implementations.length !== 1) throw new AccessorError('INVALID_LISTENER', key, `a listener needs exactly one of class, expression, delegateExpression (found ${implementations.length})`);
  if (listener.onTransaction) {
    if (!TRANSACTION_MODES.includes(listener.onTransaction as never)) throw new AccessorError('INVALID_LISTENER', key, `onTransaction must be one of ${TRANSACTION_MODES.join(', ')}`);
    // transaction dependent listeners work with a delegate expression only (EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE)
    if (listener.expression !== undefined) throw new AccessorError('INVALID_LISTENER', key, 'onTransaction cannot be combined with an expression');
  }
  const resolvers = RESOLVER_ATTRS.filter((k) => listener[k] !== undefined);
  if (resolvers.length > 1) throw new AccessorError('INVALID_LISTENER', key, 'a custom properties resolver has one implementation');
}

function listenerAccessor(key: string, label: string, type: 'activiti:ExecutionListener' | 'activiti:TaskListener', events: readonly string[] | ((el: DiagramElement) => readonly string[]), appliesTo: (el: DiagramElement) => boolean): PropertyAccessor<ListenerValue[]> {
  return {
    key,
    group: type === 'activiti:TaskListener' ? 'Task listeners' : 'Execution listeners',
    label,
    writes: 'xml',
    appliesTo,
    get: (_c, el) => extensionsOfType(bo(el), type).map(readListener),
    set: (ctx, el, value) => {
      const allowed = typeof events === 'function' ? events(el) : events;
      for (const l of value) validateListener(key, l, allowed);
      const items = value.map((l) => {
        const attrs: Record<string, unknown> = { event: l.event };
        for (const attr of LISTENER_ATTRS) {
          // implementation and resolver attributes may be empty while the panel is filling them in
          const keepsEmpty = (IMPLEMENTATION_ATTRS as readonly string[]).includes(attr) || (RESOLVER_ATTRS as readonly string[]).includes(attr);
          if (keepsEmpty ? l[attr] !== undefined : orUndefined(l[attr]) !== undefined) attrs[attr] = l[attr];
        }
        const created = createModdle(ctx, type, attrs);
        if (l.fields?.length) created.set('fields', l.fields.map((f) => createField(ctx, key, f)));
        return created;
      });
      replaceExtensions(ctx, el, bo(el), (v) => v.$type === type, items);
    },
  };
}

/** Process-level event listener (engine events): class, delegateExpression or throwing an event. */
export interface EventListenerValue {
  events?: string;
  entityType?: string;
  class?: string;
  delegateExpression?: string;
  throwEvent?: 'signal' | 'globalSignal' | 'message' | 'error';
  signalName?: string;
  messageName?: string;
  errorCode?: string;
}

export const ENTITY_TYPES = ['attachment', 'comment', 'execution', 'identity-link', 'job', 'process-definition', 'process-instance', 'task'] as const;
const EVENT_LISTENER_ATTRS = ['events', 'entityType', 'class', 'delegateExpression', 'throwEvent', 'signalName', 'messageName', 'errorCode'] as const;

const eventListeners: PropertyAccessor<EventListenerValue[]> = {
  key: 'listeners.event',
  group: 'Event listeners',
  label: 'Event listeners',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:Process') && !el.labelTarget,
  get: (_c, el) =>
    extensionsOfType(bo(el), 'activiti:EventListener').map((l) => {
      const value: EventListenerValue = {};
      for (const attr of EVENT_LISTENER_ATTRS) {
        const v = l.get(attr) as string | undefined;
        if (v !== undefined) (value as Record<string, string>)[attr] = v;
      }
      return value;
    }),
  set: (ctx, el, value) => {
    for (const l of value) {
      // the implementation may be empty while it is being filled in (see validateListener)
      const implementations = (['class', 'delegateExpression', 'throwEvent'] as const).filter((k) => l[k] !== undefined);
      if (implementations.length !== 1) throw new AccessorError('INVALID_LISTENER', 'listeners.event', 'an event listener needs exactly one of class, delegateExpression, throwEvent');
      if (l.throwEvent) {
        const needed = { signal: 'signalName', globalSignal: 'signalName', message: 'messageName', error: 'errorCode' }[l.throwEvent];
        if (!needed) throw new AccessorError('INVALID_LISTENER', 'listeners.event', `throwEvent must be signal, globalSignal, message or error`);
        if (l[needed as keyof EventListenerValue] === undefined) throw new AccessorError('INVALID_LISTENER', 'listeners.event', `throwEvent ${l.throwEvent} needs ${needed}`);
      }
      if (l.entityType && !ENTITY_TYPES.includes(l.entityType as never)) throw new AccessorError('INVALID_LISTENER', 'listeners.event', `entityType must be one of ${ENTITY_TYPES.join(', ')}`);
    }
    const keptEmpty = new Set<string>(['class', 'delegateExpression', 'throwEvent', 'signalName', 'messageName', 'errorCode']);
    const items = value.map((l) =>
      createModdle(ctx, 'activiti:EventListener', Object.fromEntries(EVENT_LISTENER_ATTRS.filter((a) => (keptEmpty.has(a) ? l[a] !== undefined : orUndefined(l[a]) !== undefined)).map((a) => [a, l[a]]))),
    );
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:EventListener', items);
  },
};

export const listenerAccessors: AnyAccessor[] = [
  listenerAccessor('listeners.execution', 'Execution listeners', 'activiti:ExecutionListener', (el) => (is(el, 'bpmn:SequenceFlow') ? ['take'] : ['start', 'end']), (el) => !el.labelTarget && (is(el, 'bpmn:Process') || is(el, 'bpmn:FlowNode') || is(el, 'bpmn:SequenceFlow'))),
  listenerAccessor('listeners.task', 'Task listeners', 'activiti:TaskListener', TASK_EVENTS, (el) => is(el, 'bpmn:UserTask')),
  eventListeners,
];

export type { AccessorContext };
