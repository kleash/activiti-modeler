import { ENTITY_TYPES, TASK_EVENTS, TRANSACTION_MODES, type EventListenerValue, type FieldInput, type ListenerValue } from '@activiti-modeler/bpmn-js-activiti';

import type { Definition, EntryBuilder } from '../builders';
import { EventTypesEntry } from '../components/EventTypesEntry';
import { ItemTools } from '../components/ItemTools';
import { helpTooltip } from '../help';
import { classNameProblem } from '../validation/ids';
import { error, warning } from '../validation/types';
import { blankField, FIELD_COLUMNS, fieldFromRow, fieldRow, missingField } from './fields';
import { listGroup, moved } from './lists';

type ImplementationType = 'class' | 'expression' | 'delegateExpression';
const IMPLEMENTATIONS: ImplementationType[] = ['class', 'expression', 'delegateExpression'];
const IMPLEMENTATION_LABELS: Record<ImplementationType, string> = { class: 'Java class', expression: 'Expression', delegateExpression: 'Delegate expression' };
const typeOf = (l: ListenerValue): ImplementationType => (l.class !== undefined ? 'class' : l.expression !== undefined ? 'expression' : 'delegateExpression');
const valueOf = (l: ListenerValue): string => l[typeOf(l)] ?? '';

const EVENT_LABELS: Record<string, string> = { start: 'start', end: 'end', take: 'take (the flow is taken)', create: 'create', assignment: 'assignment', complete: 'complete', delete: 'delete', all: 'all events' };

type RowKind = 'execution' | 'task';

/** Execution listeners (process, flow nodes, sequence flows) and task listeners (user tasks): the same list editor with other events. */
export function listenerGroup(b: EntryBuilder, kind: RowKind): Definition | undefined {
  const { env, element } = b;
  const key = kind === 'execution' ? 'listeners.execution' : 'listeners.task';
  if (!env.has(element, key)) return undefined;
  const list = env.get<ListenerValue[]>(element, key);
  const events = kind === 'task' ? [...TASK_EVENTS] : element.type === 'bpmn:SequenceFlow' ? ['take'] : ['start', 'end'];
  const groupId = kind === 'execution' ? 'executionListeners' : 'taskListeners';
  const write = (next: ListenerValue[], entryId: string): void => void env.write(element, key, next, entryId);
  const isGatewayExclusive = element.type === 'bpmn:ExclusiveGateway';
  const isProcess = element.type === 'bpmn:Process';

  return listGroup({
    id: groupId,
    label: kind === 'execution' ? 'Execution listeners' : 'Task listeners',
    add: () => write([...list, { event: events[0] as string, class: '' }], key),
    items: list.map((listener, i) => {
      const base = `${key}[${i}]`;
      const type = typeOf(listener);
      const update = (patch: Partial<ListenerValue>, entryId: string): void => write(list.map((l, j) => (j === i ? ({ ...l, ...patch } as ListenerValue) : l)), entryId);
      const implementationId = `${base}.${type}`;

      const entries: Definition[] = [
        { id: `${base}.order`, component: ItemTools, canMoveUp: i > 0, canMoveDown: i < list.length - 1, onMove: (delta: -1 | 1) => write(moved(list, i, delta), `${base}.order`) },
        b.selectRaw({ id: `${base}.event`, label: 'Event type', help: groupId, value: listener.event, options: events.map((e) => ({ value: e, label: EVENT_LABELS[e] ?? e })), commit: (v) => update({ event: v ?? events[0]! }, `${base}.event`) }),
        b.selectRaw({
          id: `${base}.type`,
          label: 'Listener type',
          help: groupId,
          value: type,
          options: IMPLEMENTATIONS.map((t) => ({ value: t, label: IMPLEMENTATION_LABELS[t] })),
          commit: (v) => {
            const next = (v ?? 'class') as ImplementationType;
            // the other implementation attributes go; the value of the old one does not carry over to another kind
            update({ class: undefined, expression: undefined, delegateExpression: undefined, [next]: '' } as Partial<ListenerValue>, `${base}.type`);
          },
        }),
      ];

      if (type === 'class') {
        entries.push(
          b.textRaw({ id: implementationId, label: 'Java class', help: 'impl.class', placeholder: 'com.example.MyListener', value: listener.class, commit: (v) => update({ class: v ?? '' }, implementationId), validate: (v) => (v ? classNameProblem(v) : error('A listener needs a class.')) }),
        );
      } else {
        const label = type === 'expression' ? 'Expression' : 'Delegate expression';
        entries.push(
          b.juelRaw({
            id: implementationId,
            label,
            help: type === 'expression' ? 'impl.expression' : 'impl.delegateExpression',
            value: listener[type],
            placeholder: type === 'expression' ? '${listenerBean.notifyIt(execution)}' : '${myListener}',
            commit: (v) => update({ [type]: v ?? '' } as Partial<ListenerValue>, implementationId),
            requiredMessage: 'A listener needs an expression.',
          }),
        );
      }

      // listeners that run in the transaction of the engine instead of during it
      entries.push(
        b.selectRaw({
          id: `${base}.onTransaction`,
          label: 'Run in the transaction',
          help: groupId,
          value: listener.onTransaction ?? '',
          options: [{ value: '', label: 'During the execution (default)' }, ...TRANSACTION_MODES.map((m) => ({ value: m, label: m }))],
          commit: (v) => update({ onTransaction: v }, `${base}.onTransaction`),
          validate: (v) => (v && type === 'expression' ? error('A transaction dependent listener cannot be an expression. Use a delegate expression.') : v && type === 'class' ? warning('The class must implement TransactionDependent' + (kind === 'execution' ? 'ExecutionListener' : 'TaskListener') + ' or the engine fails with a ClassCastException. A delegate expression is the supported form.') : undefined),
          description: listener.onTransaction ? 'The listener runs in a transaction of its own; it is not told which phase it runs in, so use one bean per phase.' : undefined,
        }),
      );
      if (listener.onTransaction) {
        const resolverType = listener.customPropertiesResolverClass !== undefined ? 'class' : listener.customPropertiesResolverExpression !== undefined ? 'expression' : listener.customPropertiesResolverDelegateExpression !== undefined ? 'delegateExpression' : '';
        const resolverKey = { class: 'customPropertiesResolverClass', expression: 'customPropertiesResolverExpression', delegateExpression: 'customPropertiesResolverDelegateExpression' } as const;
        entries.push(
          b.selectRaw({
            id: `${base}.resolverType`,
            label: 'Custom properties resolver',
            help: groupId,
            value: resolverType,
            options: [{ value: '', label: 'None' }, ...IMPLEMENTATIONS.map((t) => ({ value: t, label: IMPLEMENTATION_LABELS[t] }))],
            commit: (v) =>
              update(
                { customPropertiesResolverClass: undefined, customPropertiesResolverExpression: undefined, customPropertiesResolverDelegateExpression: undefined, ...(v ? { [resolverKey[v as ImplementationType]]: '' } : {}) } as Partial<ListenerValue>,
                `${base}.resolverType`,
              ),
          }),
        );
        if (resolverType) {
          const attr = resolverKey[resolverType];
          entries.push(
            resolverType === 'class'
              ? b.textRaw({ id: `${base}.${attr}`, label: 'Resolver class', help: groupId, value: listener[attr], commit: (v) => update({ [attr]: v ?? '' } as Partial<ListenerValue>, `${base}.${attr}`), validate: (v) => (v ? classNameProblem(v) : undefined) })
              : b.juelRaw({ id: `${base}.${attr}`, label: resolverType === 'expression' ? 'Resolver expression (gives a Map)' : 'Resolver delegate expression', help: groupId, value: listener[attr], commit: (v) => update({ [attr]: v ?? '' } as Partial<ListenerValue>, `${base}.${attr}`) }),
          );
        }
      }

      // fields injected into a class or delegate listener
      if (type !== 'expression') {
        entries.push(
          b.rowsRaw({
            id: `${base}.fields`,
            label: 'Fields',
            help: 'fields',
            addLabel: 'Add field',
            rows: (listener.fields ?? []).map(fieldRow),
            columns: FIELD_COLUMNS,
            blank: blankField,
            missing: missingField,
            rowTitle: (row) => String(row['name'] ?? ''),
            commit: (rows) => update({ fields: rows.length === 0 ? undefined : (rows.map(fieldFromRow) as FieldInput[]) }, `${base}.fields`),
          }),
        );
      }

      // engine behaviour the listener runs into
      if (kind === 'execution' && isProcess && listener.event === 'end' && /setVariable/.test(valueOf(listener))) {
        entries.push(b.info(`${base}.hint`, 'A process end listener runs after the process instance execution was deleted: setting a variable there fails the completion of the process.', 'warning', 'executionListeners'));
      }
      if (kind === 'execution' && isGatewayExclusive && listener.event === 'end') {
        entries.push(b.info(`${base}.hint`, 'An exclusive gateway never calls its end listeners: it leaves through the sequence flow without the end-of-node processing. Use the take listener of the flow.', 'warning', 'executionListeners'));
      }
      if (kind === 'task' && (listener.event === 'delete' || listener.event === 'all')) {
        entries.push(b.info(`${base}.hint`, 'Delete listeners also run when the task is cancelled, and after every normal completion (complete runs first, then delete).', 'info', 'taskListeners'));
      }

      return { id: base, label: `${listener.event}: ${valueOf(listener) || '(empty)'}`, entries, remove: () => write(list.filter((_, j) => j !== i), base), autoFocusEntry: implementationId };
    }),
  });
}

// --- process event listeners -------------------------------------------------------------------------------------------------------

type EventImplementation = 'class' | 'delegateExpression' | 'throwEvent';
const THROW_KEYS = { signal: 'signalName', globalSignal: 'signalName', message: 'messageName', error: 'errorCode' } as const;
const THROW_LABELS = { signal: 'Throw a signal (process instance)', globalSignal: 'Throw a global signal', message: 'Throw a message', error: 'Throw a BPMN error' } as const;

export function eventListenerGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'listeners.event')) return undefined;
  const list = env.get<EventListenerValue[]>(element, 'listeners.event');
  const write = (next: EventListenerValue[], entryId: string): void => void env.write(element, 'listeners.event', next, entryId);
  const implementationOf = (l: EventListenerValue): EventImplementation => (l.class !== undefined ? 'class' : l.delegateExpression !== undefined ? 'delegateExpression' : 'throwEvent');

  return listGroup({
    id: 'eventListeners',
    label: 'Event listeners',
    add: () => write([...list, { class: '' }], 'listeners.event'),
    items: list.map((listener, i) => {
      const base = `listeners.event[${i}]`;
      const implementation = implementationOf(listener);
      const update = (patch: Partial<EventListenerValue>, entryId: string): void => write(list.map((l, j) => (j === i ? ({ ...l, ...patch } as EventListenerValue) : l)), entryId);
      const entries: Definition[] = [
        { id: `${base}.order`, component: ItemTools, canMoveUp: i > 0, canMoveDown: i < list.length - 1, onMove: (delta: -1 | 1) => write(moved(list, i, delta), `${base}.order`) },
        {
          id: `${base}.events`,
          component: EventTypesEntry,
          label: 'Events',
          getValue: () => listener.events,
          setValue: (v: string | undefined, d?: unknown) => {
            if (!d) update({ events: v }, `${base}.events`);
          },
          debounce: env.debounce,
          tooltip: helpTooltip('eventListeners'),
          description: 'Leave empty to listen to every engine event.',
        },
        b.selectRaw({
          id: `${base}.entityType`,
          label: 'Entity type',
          help: 'eventListeners',
          value: listener.entityType ?? '',
          options: [{ value: '', label: 'Any entity' }, ...ENTITY_TYPES.map((t) => ({ value: t, label: t }))],
          commit: (v) => update({ entityType: v }, `${base}.entityType`),
        }),
        b.selectRaw({
          id: `${base}.type`,
          label: 'Listener type',
          help: 'eventListeners',
          value: implementation === 'throwEvent' ? `throw:${listener.throwEvent}` : implementation,
          options: [
            { value: 'class', label: 'Java class' },
            { value: 'delegateExpression', label: 'Delegate expression' },
            ...(Object.keys(THROW_LABELS) as Array<keyof typeof THROW_LABELS>).map((t) => ({ value: `throw:${t}`, label: THROW_LABELS[t] })),
          ],
          commit: (v) => {
            const clear = { class: undefined, delegateExpression: undefined, throwEvent: undefined, signalName: undefined, messageName: undefined, errorCode: undefined } as Partial<EventListenerValue>;
            if (!v || v === 'class') update({ ...clear, class: '' }, `${base}.type`);
            else if (v === 'delegateExpression') update({ ...clear, delegateExpression: '' }, `${base}.type`);
            else {
              const t = v.slice('throw:'.length) as keyof typeof THROW_KEYS;
              update({ ...clear, throwEvent: t, [THROW_KEYS[t]]: '' } as Partial<EventListenerValue>, `${base}.type`);
            }
          },
        }),
      ];
      if (implementation === 'class') {
        entries.push(b.textRaw({ id: `${base}.class`, label: 'Java class', help: 'impl.class', value: listener.class, placeholder: 'com.example.MyEventListener', commit: (v) => update({ class: v ?? '' }, `${base}.class`), validate: (v) => (v ? classNameProblem(v) : error('A listener needs a class.')) }));
      } else if (implementation === 'delegateExpression') {
        entries.push(b.juelRaw({ id: `${base}.delegateExpression`, label: 'Delegate expression', help: 'impl.delegateExpression', value: listener.delegateExpression, placeholder: '${myEventListener}', commit: (v) => update({ delegateExpression: v ?? '' }, `${base}.delegateExpression`), requiredMessage: 'A listener needs a delegate expression.' }));
      } else {
        const thrown = listener.throwEvent as keyof typeof THROW_KEYS;
        const field = THROW_KEYS[thrown];
        const labels = { signalName: 'Signal name', messageName: 'Message name', errorCode: 'Error code' } as const;
        entries.push(
          b.textRaw({
            id: `${base}.${field}`,
            label: labels[field],
            help: thrown === 'error' ? 'error.ref' : thrown === 'message' ? 'message.ref' : 'signal.ref',
            value: listener[field],
            commit: (v) => update({ [field]: v ?? '' } as Partial<EventListenerValue>, `${base}.${field}`),
            validate: (v) => (v ? undefined : error(`${labels[field]} is required to throw it.`)),
            description: thrown === 'error' ? 'The error is propagated from the execution of the event that fired the listener, so a boundary event of that activity can catch it.' : thrown === 'message' ? 'Delivered to the message subscriptions of this process instance (no correlation key).' : thrown === 'globalSignal' ? 'Signals every subscription of that name in the engine.' : 'Signals the subscriptions of this process instance.',
          }),
        );
      }
      return { id: base, label: `${listener.events ?? 'all events'}: ${listener.class ?? listener.delegateExpression ?? listener.throwEvent ?? ''}`, entries, remove: () => write(list.filter((_, j) => j !== i), base), autoFocusEntry: `${base}.events` };
    }),
  });
}
