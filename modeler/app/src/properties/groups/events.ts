import {
  compensationTargets, eventPlacement, linkCatchEvents, type ErrorInput, type FieldInput, type MessageInput, type SignalInput, type TimerValue,
} from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';
import { classNameProblem } from '../validation/ids';
import { describeTimer, endDateDiagnostic, timerDiagnostic, timerPlacementWarning, type TimerType } from '../validation/timer';
import { error, warning } from '../validation/types';
import { blankField, FIELD_COLUMNS, fieldFromRow, fieldRow, missingField } from './fields';
import { uniqueName } from './lists';

const NEW = '__new__';

// --- timer ---------------------------------------------------------------------------------------------------------------------------

const TIMER_TYPES = [{ value: 'date', label: 'Date' }, { value: 'duration', label: 'Duration' }, { value: 'cycle', label: 'Cycle' }];

/**
 * The timer definition: type, value (validated as ISO 8601 or cron while typing), end date of a cycle and business calendar, with a
 * sentence that says what the timer does. The type chosen before a value exists is kept in the panel (the model holds a timer only
 * together with its value).
 */
export function timerGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'timer.definition')) return [];
  const definition = env.get<TimerValue | undefined>(element, 'timer.definition');
  const placement = eventPlacement(element);
  const typeKey = env.transientKey(element, 'timer.type');
  const chosen = env.transient.get(typeKey) as TimerType | undefined;
  const type: TimerType = definition?.type ?? chosen ?? (placement.kind === 'start' ? 'date' : 'duration');
  const value = definition?.value;
  const endDate = definition?.endDate;
  const write = (next: TimerValue | undefined, entryId: string): void => void env.write(element, 'timer.definition', next, entryId);

  const entries: Definition[] = [
    b.selectRaw({
      id: 'timer.definition.type',
      label: 'Timer type',
      value: type,
      options: TIMER_TYPES,
      commit: (v) => {
        const next = (v ?? 'duration') as TimerType;
        env.transient.set(typeKey, next);
        if (definition) write({ type: next, value: definition.value, ...(next === 'cycle' && definition.endDate ? { endDate: definition.endDate } : {}) }, 'timer.definition.type');
        else env.refresh();
      },
    }),
    b.textRaw({
      id: 'timer.definition.value',
      label: type === 'date' ? 'Date' : type === 'duration' ? 'Duration' : 'Cycle',
      placeholder: type === 'date' ? '2030-01-01T12:00:00Z' : type === 'duration' ? 'PT30M' : 'R3/PT1H or 0 0 12 * * ?',
      value,
      commit: (v) => {
        env.transient.set(typeKey, type);
        write(v === undefined ? undefined : { type, value: v, ...(type === 'cycle' && endDate ? { endDate } : {}) }, 'timer.definition.value');
      },
      validate: (v) => timerDiagnostic(type, v, endDate) ?? timerPlacementWarning(type, placement),
    }),
  ];
  if (type === 'cycle') {
    entries.push(
      b.textRaw({
        id: 'timer.definition.endDate',
        label: 'End date',
        placeholder: '2030-01-01T11:30:00Z',
        value: endDate,
        help: 'timer.definition.endDate',
        commit: (v) => {
          if (!definition) return;
          write({ type: 'cycle', value: definition.value, ...(v ? { endDate: v } : {}) }, 'timer.definition.endDate');
        },
        validate: (v) => (!definition && v ? error('Enter the cycle first: the end date belongs to it.') : endDateDiagnostic(v)),
      }),
    );
  }
  entries.push(b.text({ key: 'timer.businessCalendarName', label: 'Business calendar', placeholder: type === 'cycle' ? 'cycle' : type === 'duration' ? 'duration' : 'dueDate', description: 'Leave empty for the default calendar.' }));
  const preview = describeTimer(type, value, endDate);
  entries.push(b.info('timer.definition.preview', preview ?? 'Enter a value to see what the timer does.', 'info'));
  return [group({ id: 'timer', label: 'Timer', entries, shouldOpen: true })];
}

// --- message, signal, error ------------------------------------------------------------------------------------------------------------

const isThrow = (type: string): boolean => type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:EndEvent';

function messageGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'message.ref')) return undefined;
  const messages = env.get<MessageInput[]>(env.rootOf(element), 'definitions.messages') ?? [];
  const current = env.get<string | undefined>(element, 'message.ref');
  const entries: Definition[] = [
    b.selectRaw({
      id: 'message.ref',
      label: 'Message',
      value: current,
      options: [{ value: '', label: '(none)' }, ...messages.map((m) => ({ value: m.name, label: m.name })), { value: NEW, label: 'Create a new message…' }],
      commit: (v) => {
        const name = v === NEW ? uniqueName('newMessage', messages.map((m) => m.name)) : v;
        void env.write(element, 'message.ref', name, 'message.ref');
      },
    }),
  ];
  if (current !== undefined) {
    const own = messages.find((m) => m.name === current);
    entries.push(
      b.textRaw({
        id: 'message.ref.name',
        label: 'Message name',
        help: 'messages',
        value: current,
        description: 'Renames the message for every event that uses it.',
        commit: (v) => {
          if (v === undefined || !own) return;
          void env.write(env.rootOf(element), 'definitions.messages', messages.map((m) => (m === own ? { ...m, name: v } : m)), 'message.ref.name');
        },
        validate: (v) => (v ? undefined : error('A message needs a name.')),
      }),
    );
  }
  entries.push(
    b.juel({ key: 'message.expression', label: 'Message expression', placeholder: '${messageName}', description: 'Names the message by an expression instead of a declared message.' }),
    b.juel({ key: 'message.correlationKey', label: 'Correlation key', placeholder: '${orderId}' }),
  );
  if (isThrow(element.type)) {
    entries.push(
      b.text({ key: 'message.class', label: 'Throw delegate class', placeholder: 'com.example.SendOrderMessage', validate: (v) => (v ? classNameProblem(v) : undefined), description: 'A ThrowMessageDelegate. A message throw event does nothing without one.' }),
      b.juel({ key: 'message.delegateExpression', label: 'Throw delegate expression', placeholder: '${throwMessageDelegate}' }),
    );
    if (env.get<string | undefined>(element, 'message.class') === undefined && env.get<string | undefined>(element, 'message.delegateExpression') === undefined) {
      entries.push(b.info('message.delegate.hint', 'A message throw event needs a delegate (class or delegate expression) that sends the message; without one the engine ignores the throw.', 'warning', 'message.class'));
    }
  }
  entries.push(
    b.rows({
      key: 'message.fields',
      label: 'Message payload fields',
      addLabel: 'Add field',
      columns: FIELD_COLUMNS,
      toRow: fieldRow,
      fromRow: fieldFromRow,
      blank: blankField,
      missing: missingField,
      rowTitle: (r) => String(r['name'] ?? ''),
    }),
  );
  if ((env.get<FieldInput[]>(element, 'message.fields') ?? []).length > 0) {
    entries.push(b.info('message.fields.hint', 'Fields on a message event definition are parsed but never injected into the delegate (Activiti 9.0.0): only the input mapping reaches it, as the payload.', 'warning', 'message.fields'));
  }
  return group({ id: 'message', label: 'Message', entries, shouldOpen: true });
}

function signalGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'signal.ref')) return undefined;
  const signals = env.get<SignalInput[]>(env.rootOf(element), 'definitions.signals') ?? [];
  const current = env.get<string | undefined>(element, 'signal.ref');
  const expression = env.get<string | undefined>(element, 'signal.expression');
  const entries: Definition[] = [
    b.selectRaw({
      id: 'signal.ref',
      label: 'Signal',
      value: current,
      options: [{ value: '', label: '(none)' }, ...signals.map((s) => ({ value: s.name, label: s.name })), { value: NEW, label: 'Create a new signal…' }],
      commit: (v) => void env.write(element, 'signal.ref', v === NEW ? uniqueName('newSignal', signals.map((s) => s.name)) : v, 'signal.ref'),
    }),
  ];
  if (current !== undefined) {
    const own = signals.find((s) => s.name === current);
    entries.push(
      b.textRaw({
        id: 'signal.ref.name',
        label: 'Signal name',
        help: 'signals',
        value: current,
        description: 'Renames the signal for every event that uses it.',
        commit: (v) => {
          if (v === undefined || !own) return;
          void env.write(env.rootOf(element), 'definitions.signals', signals.map((s) => (s === own ? { ...s, name: v } : s)), 'signal.ref.name');
        },
        validate: (v) => (v ? undefined : error('A signal needs a name.')),
      }),
    );
    if (env.has(element, 'signal.scope')) {
      entries.push(b.select({ key: 'signal.scope', label: 'Scope', options: [{ value: '', label: 'Default (global)' }, { value: 'global', label: 'Global' }, { value: 'processInstance', label: 'Process instance' }] }));
    }
  }
  entries.push(b.juel({ key: 'signal.expression', label: 'Signal expression', placeholder: "${'go-'.concat(region)}", description: "EL has no '+' for strings: build names with concat." }));
  if (expression && signals.length > 0) {
    entries.push(b.info('signal.expression.parse.hint', 'This file declares signals, and a signal named by an expression then fails to parse in Activiti 9.0.0 (NullPointerException on deployment). Declare no signal in this file, or name the signal with a declared signal.', 'warning', 'signal.expression'));
  }
  if (expression && !isThrow(element.type) && element.type !== 'bpmn:StartEvent') {
    entries.push(b.info('signal.expression.leak.hint', 'A catch event named by an expression keeps its subscription after it fired: a second broadcast of the same name signals whatever the instance waits at.', 'warning', 'signal.expression'));
  }
  if (isThrow(element.type) && env.has(element, 'signal.async')) {
    entries.push(b.check({ key: 'signal.async', label: 'Asynchronous throw', description: 'Delivers the signal in a job; needs the async executor, and the signal payload is dropped.' }));
  }
  return group({ id: 'signal', label: 'Signal', entries, shouldOpen: true });
}

function errorGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'error.ref')) return undefined;
  const errors = env.get<ErrorInput[]>(env.rootOf(element), 'definitions.errors') ?? [];
  const current = env.get<string | undefined>(element, 'error.ref');
  const entries: Definition[] = [
    b.selectRaw({
      id: 'error.ref',
      label: 'Error',
      value: current,
      options: [{ value: '', label: element.type === 'bpmn:BoundaryEvent' ? '(none: catches every error)' : '(none)' }, ...errors.map((e) => ({ value: e.errorCode, label: e.name && e.name !== e.errorCode ? `${e.errorCode} (${e.name})` : e.errorCode })), { value: NEW, label: 'Create a new error…' }],
      commit: (v) => void env.write(element, 'error.ref', v === NEW ? uniqueName('ERROR_CODE', errors.map((e) => e.errorCode)) : v, 'error.ref'),
    }),
  ];
  if (current !== undefined) {
    const own = errors.find((e) => e.errorCode === current);
    entries.push(
      b.textRaw({
        id: 'error.ref.code',
        label: 'Error code',
        help: 'error.ref',
        value: current,
        description: 'Renames the error code for every event that uses it.',
        commit: (v) => {
          if (v === undefined || !own) return;
          void env.write(env.rootOf(element), 'definitions.errors', errors.map((e) => (e === own ? { ...e, errorCode: v } : e)), 'error.ref.code');
        },
        validate: (v) => (v ? undefined : error('An error needs an error code.')),
      }),
    );
  }
  if (element.type === 'bpmn:BoundaryEvent') {
    entries.push(b.info('error.boundary.hint', 'An error boundary event always interrupts its activity, whatever the flag says. Without an error it catches every error.', 'info', 'error.ref'));
  }
  return group({ id: 'error', label: 'Error', entries, shouldOpen: true });
}

// --- link, compensation, terminate ------------------------------------------------------------------------------------------------------

function linkGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'link.name')) return undefined;
  const entries: Definition[] = [b.text({ key: 'link.name', label: 'Link name', validate: (v) => (v ? undefined : warning('Give the link a name: the engine connects a throw event to the catch event of the same name.')) })];
  if (env.has(element, 'link.target')) {
    const targets = linkCatchEvents(env.registry);
    entries.push(
      b.select({
        key: 'link.target',
        label: 'Jump to',
        options: [{ value: '', label: '(choose a link catch event)' }, ...targets.map((t) => ({ value: t.id, label: t.name ? `${t.name} (${t.id})` : t.id }))],
      }),
    );
  }
  if (env.has(element, 'link.sources')) {
    const sources = env.get<string[]>(element, 'link.sources');
    entries.push(b.info('link.sources.info', sources.length === 0 ? 'No link throw event jumps here yet. Choose this event in "Jump to" of a throw event.' : `Reached from: ${sources.join(', ')}.`, 'info', 'link.target'));
  }
  return group({ id: 'link', label: 'Link', entries, shouldOpen: true });
}

function compensationGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'compensate.activityRef')) return undefined;
  const targets = compensationTargets(env.registry);
  const current = env.get<string | undefined>(element, 'compensate.activityRef');
  const kinds = { handler: 'handler', subProcess: 'sub process', activity: 'activity' } as const;
  const entries: Definition[] = [
    b.select({
      key: 'compensate.activityRef',
      label: 'Activity to compensate',
      options: [
        { value: '', label: '(everything completed in this scope)' },
        ...targets.map((t) => ({ value: t.id, label: `${t.name ? `${t.name} ` : ''}(${t.id}, ${kinds[t.kind]})` })),
      ],
    }),
    b.check({ key: 'compensate.waitForCompletion', label: 'Wait for completion', description: 'The engine ignores this: the handlers always finish before the process moves on.' }),
  ];
  const chosen = targets.find((t) => t.id === current);
  if (chosen?.hasCompensationBoundary) {
    entries.push(b.info('compensate.target.hint', `"${chosen.id}" has a compensation boundary event. Name its handler instead: the engine keys the subscription by the handler, so naming the task compensates nothing.`, 'warning', 'compensate.activityRef'));
  }
  return group({ id: 'compensation', label: 'Compensation', entries, shouldOpen: true });
}

function terminateGroup(b: EntryBuilder): Definition | undefined {
  const { env, element } = b;
  if (!env.has(element, 'terminate.all')) return undefined;
  return group({
    id: 'terminate',
    label: 'Terminate',
    entries: [
      b.check({ key: 'terminate.all', label: 'Terminate all', description: 'Ends the whole process instance, also the parent scopes of a called process.' }),
      b.check({ key: 'terminate.multiInstance', label: 'Terminate multi-instance', description: 'Ends all instances of the enclosing multi-instance activity.' }),
    ],
    shouldOpen: true,
  });
}

export function eventDefinitionGroups(b: EntryBuilder): Array<Definition | undefined> {
  return [messageGroup(b), signalGroup(b), errorGroup(b), linkGroup(b), compensationGroup(b), terminateGroup(b)];
}
