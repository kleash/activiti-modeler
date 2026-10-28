/** Mirrors of the ProcessValidator keys about event definitions: boundary, intermediate, end, message, signal, timer, compensate, link. */
import { defineRule, onTypes } from '../define';
import { allFlowElements, child, definitionLabel, engineDefinitions, expressionText, is, isBlank, isDeclared, list, str } from '../model';
import type { ME } from '../types';

const R1_7 = 'R1 §7 (ProcessValidator keys)';

const boundaryEvents = (process: ME): ME[] => allFlowElements(process).filter((e) => is(e, 'bpmn:BoundaryEvent'));
const hostOf = (event: ME): ME | undefined => event.get('attachedToRef') as ME | undefined;
const firstIs = (event: ME, types: readonly string[]): boolean => {
  const first = engineDefinitions(event)[0];
  return !!first && types.some((t) => is(first, t));
};
const definitionName = (event: ME): string => (engineDefinitions(event)[0] ? definitionLabel(engineDefinitions(event)[0]!) : 'none');

const TIMER = '<timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition>';

type Api = Parameters<NonNullable<Parameters<typeof onTypes>[1]>>[1];

/** The state of a reference: set and still declared, set but removed, absent, or written in the file but unresolved. */
function refState(api: Api, owner: ME, prop: string, property: ME | undefined, rootLevel = true): 'ok' | 'missing' | 'invalid' {
  if (property) return !rootLevel || isDeclared(api.definitions, property) ? 'ok' : 'invalid';
  return api.ctx.unresolved?.get(owner)?.[prop] !== undefined ? 'invalid' : 'missing';
}

const eventsWith = (type: string, fn: (event: ME, definition: ME, api: Api) => void): ((node: ME, api: Api) => void) =>
  (node, api) => {
    if (!is(node, 'bpmn:Event')) return;
    for (const definition of list(node, 'eventDefinitions')) if (is(definition, type)) fn(node, definition, api);
  };

export const eventRules = [
  defineRule({
    id: 'boundary-event-no-event-definition',
    tag: 'V',
    key: 'BOUNDARY_EVENT_NO_EVENT_DEFINITION',
    severity: 'error',
    title: 'A boundary event has no event definition Activiti understands',
    why: 'A boundary event without a definition is rejected. Escalation and conditional boundary events are not parsed at all, so for Activiti they have none (R1 §0.1-8); neither is a terminate definition, which the converter reads in an end event only (engine-findings V.3).',
    evidence: [R1_7, 'R1 §0.1-8', 'engine-findings V.3'],
    howToFix: 'Give the boundary event a timer, error, message, signal, cancel or compensation definition.',
    serverKeys: ['BOUNDARY_EVENT_NO_EVENT_DEFINITION'],
    check: onTypes('bpmn:BoundaryEvent', (event, api) => {
      if (engineDefinitions(event).length === 0) api.report(event, `Boundary event ${event.id} has no event definition that Activiti reads`);
    }),
    bad: [
      { body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"/>', ids: ['b'] },
      { body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><escalationEventDefinition/></boundaryEvent>', ids: ['b'] },
      { body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><terminateEventDefinition/></boundaryEvent>', ids: ['b'], note: 'terminate is read in an end event only' },
    ],
    good: [{ body: `<task id="t"/><boundaryEvent id="b" attachedToRef="t">${TIMER}</boundaryEvent>` }],
  }),
  defineRule({
    id: 'boundary-event-invalid-event-definition',
    tag: 'V',
    key: 'BOUNDARY_EVENT_INVALID_EVENT_DEFINITION',
    severity: 'error',
    title: 'A boundary event has a link definition',
    why: 'Activiti accepts timer, error, signal, cancel, message and compensate boundary events only. Of the definitions the converter reads in a boundary event, only a link definition is left that the validator refuses. A terminate definition is not read at all there, so that boundary event has none: see boundary-event-no-event-definition (engine-findings V.3).',
    evidence: [R1_7, 'engine-findings V.3'],
    howToFix: 'Change the definition of the boundary event.',
    serverKeys: ['BOUNDARY_EVENT_INVALID_EVENT_DEFINITION'],
    check: onTypes('bpmn:BoundaryEvent', (event, api) => {
      if (engineDefinitions(event).length > 0 && !firstIs(event, ['bpmn:TimerEventDefinition', 'bpmn:ErrorEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:CancelEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:CompensateEventDefinition'])) {
        api.report(event, `Boundary event ${event.id} has a ${definitionName(event)} definition`);
      }
    }),
    bad: [{ body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><linkEventDefinition name="x"/></boundaryEvent>', ids: ['b'] }],
    good: [{ body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><errorEventDefinition/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'boundary-event-cancel-only-on-transaction',
    tag: 'V',
    key: 'BOUNDARY_EVENT_CANCEL_ONLY_ON_TRANSACTION',
    severity: 'error',
    title: 'A cancel boundary event is attached to something other than a transaction',
    why: 'A cancel event reacts to the cancellation of a transaction sub process.',
    evidence: [R1_7],
    howToFix: 'Attach it to a transaction, or use another boundary event.',
    serverKeys: ['BOUNDARY_EVENT_CANCEL_ONLY_ON_TRANSACTION'],
    check: onTypes('bpmn:BoundaryEvent', (event, api) => {
      const host = hostOf(event);
      if (firstIs(event, ['bpmn:CancelEventDefinition']) && host && !is(host, 'bpmn:Transaction')) api.report(event, `Cancel boundary event ${event.id} is attached to ${host.id}, which is not a transaction`);
    }),
    bad: [{ body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><cancelEventDefinition/></boundaryEvent>', ids: ['b'] }],
    good: [{ body: '<transaction id="tx"/><boundaryEvent id="b" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'boundary-event-multiple-cancel-on-transaction',
    tag: 'V',
    key: 'BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION',
    severity: 'error',
    title: 'A transaction has more than one cancel boundary event',
    why: 'A transaction can be cancelled to one place only.',
    evidence: [R1_7],
    howToFix: 'Delete the extra cancel boundary event.',
    serverKeys: ['BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION'],
    check: onTypes('bpmn:Process', (process, api) => {
      const byHost = new Map<ME, ME[]>();
      for (const e of boundaryEvents(process)) {
        const host = hostOf(e);
        if (host && firstIs(e, ['bpmn:CancelEventDefinition'])) byHost.set(host, [...(byHost.get(host) ?? []), e]);
      }
      for (const [host, events] of byHost) if (events.length > 1) for (const e of events) api.report(e, `${host.id} has ${events.length} cancel boundary events`);
    }),
    bad: [{ body: '<transaction id="tx"/><boundaryEvent id="b1" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent><boundaryEvent id="b2" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>', ids: ['b1', 'b2'] }],
    good: [{ body: '<transaction id="tx"/><boundaryEvent id="b1" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'compensate-event-multiple-on-boundary',
    tag: 'V',
    key: 'COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY',
    severity: 'error',
    title: 'An activity has more than one compensation boundary event',
    why: 'An activity has one compensation handler.',
    evidence: [R1_7],
    howToFix: 'Delete the extra compensation boundary event.',
    serverKeys: ['COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY'],
    check: onTypes('bpmn:Process', (process, api) => {
      const byHost = new Map<ME, ME[]>();
      for (const e of boundaryEvents(process)) {
        const host = hostOf(e);
        if (host && firstIs(e, ['bpmn:CompensateEventDefinition'])) byHost.set(host, [...(byHost.get(host) ?? []), e]);
      }
      for (const [host, events] of byHost) if (events.length > 1) for (const e of events) api.report(e, `${host.id} has ${events.length} compensation boundary events`);
    }),
    bad: [{ body: '<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><compensateEventDefinition/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><compensateEventDefinition/></boundaryEvent>', ids: ['b1', 'b2'] }],
    good: [{ body: '<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><compensateEventDefinition/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'compensate-event-invalid-activity-ref',
    tag: 'V',
    key: 'COMPENSATE_EVENT_INVALID_ACTIVITY_REF',
    severity: 'error',
    title: 'A compensation event refers to an activity that does not exist',
    why: '`activityRef` of a throwing compensation event must name an element of the process. (Engine detail: the reference is to the compensation **handler**, see engine-findings C08.2.)',
    evidence: [R1_7, 'engine-findings C08.2'],
    howToFix: 'Choose the activity again in **Compensation > Activity**.',
    entry: 'compensate.activityRef',
    serverKeys: ['COMPENSATE_EVENT_INVALID_ACTIVITY_REF'],
    check: eventsWith('bpmn:CompensateEventDefinition', (event, definition, api) => {
      if (refState(api, definition, 'activityRef', definition.get('activityRef') as ME | undefined, false) === 'invalid') api.report(event, `${event.id} compensates an activity that does not exist`);
    }),
    bad: [{ body: '<intermediateThrowEvent id="c"><compensateEventDefinition id="cd" activityRef="ghost"/></intermediateThrowEvent>', ids: ['c'] }],
    good: [{ body: '<task id="t"/><intermediateThrowEvent id="c"><compensateEventDefinition activityRef="t"/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'message-event-missing-message-ref',
    tag: 'V',
    key: 'MESSAGE_EVENT_MISSING_MESSAGE_REF',
    severity: 'error',
    title: 'A message event names no message',
    why: 'A message event needs `messageRef` (a message of the file) or an `activiti:messageExpression`.',
    evidence: [R1_7],
    howToFix: 'Pick or create the message in the event\'s **Message** group.',
    entry: 'event.definition',
    serverKeys: ['MESSAGE_EVENT_MISSING_MESSAGE_REF'],
    check: eventsWith('bpmn:MessageEventDefinition', (event, definition, api) => {
      if (refState(api, definition, 'messageRef', definition.get('messageRef') as ME | undefined) === 'missing' && isBlank(str(definition, 'activiti:messageExpression'))) api.report(event, `Message event ${event.id} has no message`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="m"><messageEventDefinition/></intermediateCatchEvent>', ids: ['m'] }],
    good: [{ head: '<message id="msg" name="m"/>', body: '<intermediateCatchEvent id="m"><messageEventDefinition messageRef="msg"/></intermediateCatchEvent>' }, { body: '<intermediateCatchEvent id="m"><messageEventDefinition activiti:messageExpression="${name}"/></intermediateCatchEvent>' }],
  }),
  defineRule({
    id: 'message-event-invalid-message-ref',
    tag: 'V',
    key: 'MESSAGE_EVENT_INVALID_MESSAGE_REF',
    severity: 'error',
    title: 'A message event refers to a message that is not defined',
    why: 'The message must be a `<message>` of the file.',
    evidence: [R1_7],
    howToFix: 'Pick the message again, or define it.',
    entry: 'event.definition',
    serverKeys: ['MESSAGE_EVENT_INVALID_MESSAGE_REF'],
    check: eventsWith('bpmn:MessageEventDefinition', (event, definition, api) => {
      if (refState(api, definition, 'messageRef', definition.get('messageRef') as ME | undefined) === 'invalid') api.report(event, `Message event ${event.id} refers to a message that is not defined`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="m"><messageEventDefinition messageRef="ghost"/></intermediateCatchEvent>', ids: ['m'] }],
    good: [{ head: '<message id="msg" name="m"/>', body: '<intermediateCatchEvent id="m"><messageEventDefinition messageRef="msg"/></intermediateCatchEvent>' }],
  }),
  defineRule({
    id: 'message-event-multiple-on-boundary-same-message-id',
    tag: 'V',
    key: 'MESSAGE_EVENT_MULTIPLE_ON_BOUNDARY_SAME_MESSAGE_ID',
    severity: 'error',
    title: 'An activity has two message boundary events for the same message',
    why: 'Two subscriptions of one activity to one message are rejected at deployment.',
    evidence: [R1_7, 'R1 §3.2 (t56)'],
    howToFix: 'Keep one boundary event, or use two different messages.',
    serverKeys: ['MESSAGE_EVENT_MULTIPLE_ON_BOUNDARY_SAME_MESSAGE_ID'],
    check: onTypes('bpmn:Process', (process, api) => {
      const seen = new Map<string, ME[]>();
      for (const e of boundaryEvents(process)) {
        const host = hostOf(e);
        const def = list(e, 'eventDefinitions').find((d) => is(d, 'bpmn:MessageEventDefinition'));
        const message = def?.get('messageRef') as ME | undefined;
        if (host && message) seen.set(`${host.id}|${message.id}`, [...(seen.get(`${host.id}|${message.id}`) ?? []), e]);
      }
      for (const events of seen.values()) if (events.length > 1) for (const e of events) api.report(e, `${hostOf(e)?.id} has more than one message boundary event for the same message`);
    }),
    bad: [{ head: '<message id="msg" name="m"/>', body: '<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent>', ids: ['b1', 'b2'] }],
    good: [{ head: '<message id="msg" name="m"/><message id="msg2" name="n"/>', body: '<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><messageEventDefinition messageRef="msg2"/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'signal-event-missing-signal-ref',
    tag: 'V',
    key: 'SIGNAL_EVENT_MISSING_SIGNAL_REF',
    severity: 'error',
    title: 'A signal event names no signal',
    why: 'A signal event needs `signalRef` or an `activiti:signalExpression`.',
    evidence: [R1_7],
    howToFix: 'Pick or create the signal in the event\'s **Signal** group.',
    entry: 'event.definition',
    serverKeys: ['SIGNAL_EVENT_MISSING_SIGNAL_REF'],
    check: eventsWith('bpmn:SignalEventDefinition', (event, definition, api) => {
      if (refState(api, definition, 'signalRef', definition.get('signalRef') as ME | undefined) === 'missing' && isBlank(str(definition, 'activiti:signalExpression'))) api.report(event, `Signal event ${event.id} has no signal`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="s"><signalEventDefinition/></intermediateCatchEvent>', ids: ['s'] }],
    good: [{ head: '<signal id="sig" name="go"/>', body: '<intermediateCatchEvent id="s"><signalEventDefinition signalRef="sig"/></intermediateCatchEvent>' }],
  }),
  defineRule({
    id: 'signal-event-invalid-signal-ref',
    tag: 'V',
    key: 'SIGNAL_EVENT_INVALID_SIGNAL_REF',
    severity: 'error',
    title: 'A signal event refers to a signal that is not defined',
    why: 'The signal must be a `<signal>` of the file.',
    evidence: [R1_7],
    howToFix: 'Pick the signal again, or define it.',
    entry: 'event.definition',
    serverKeys: ['SIGNAL_EVENT_INVALID_SIGNAL_REF'],
    check: eventsWith('bpmn:SignalEventDefinition', (event, definition, api) => {
      if (refState(api, definition, 'signalRef', definition.get('signalRef') as ME | undefined) === 'invalid') api.report(event, `Signal event ${event.id} refers to a signal that is not defined`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="s"><signalEventDefinition signalRef="ghost"/></intermediateCatchEvent>', ids: ['s'] }],
    good: [{ head: '<signal id="sig" name="go"/>', body: '<intermediateCatchEvent id="s"><signalEventDefinition signalRef="sig"/></intermediateCatchEvent>' }],
  }),
  defineRule({
    id: 'event-timer-missing-configuration',
    tag: 'V',
    key: 'EVENT_TIMER_MISSING_CONFIGURATION',
    severity: 'error',
    title: 'A timer event has no date, duration or cycle',
    why: 'A timer needs one of `timeDate`, `timeDuration` or `timeCycle`.',
    evidence: [R1_7],
    howToFix: 'Fill the **Timer** group.',
    entry: 'timer.definition',
    serverKeys: ['EVENT_TIMER_MISSING_CONFIGURATION'],
    check: eventsWith('bpmn:TimerEventDefinition', (event, definition, api) => {
      const has = ['timeDate', 'timeCycle', 'timeDuration'].some((p) => !isBlank(expressionText(child(definition, p))));
      if (!has) api.report(event, `Timer event ${event.id} has no date, duration or cycle`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="t"><timerEventDefinition/></intermediateCatchEvent>', ids: ['t'] }],
    good: [{ body: `<intermediateCatchEvent id="t">${TIMER}</intermediateCatchEvent>` }],
  }),
  defineRule({
    id: 'intermediate-catch-event-no-eventdefinition',
    tag: 'V',
    key: 'INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION',
    severity: 'error',
    title: 'An intermediate catch event has no event definition',
    why: 'A catch event waits for something: a timer, a message, a signal or a link.',
    evidence: [R1_7],
    howToFix: 'Choose what the event waits for (replace menu), or use an intermediate throw event for a plain milestone.',
    serverKeys: ['INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION'],
    check: onTypes('bpmn:IntermediateCatchEvent', (event, api) => {
      if (engineDefinitions(event).length === 0) api.report(event, `Intermediate catch event ${event.id} waits for nothing`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="c"/>', ids: ['c'] }],
    good: [{ body: `<intermediateCatchEvent id="c">${TIMER}</intermediateCatchEvent>` }],
  }),
  defineRule({
    id: 'intermediate-catch-event-invalid-eventdefinition',
    tag: 'V',
    key: 'INTERMEDIATE_CATCH_EVENT_INVALID_EVENTDEFINITION',
    severity: 'error',
    title: 'An intermediate catch event has an error, cancel or compensate definition',
    why: 'Activiti accepts timer, signal, message and link catch events.',
    evidence: [R1_7],
    howToFix: 'Change the definition.',
    serverKeys: ['INTERMEDIATE_CATCH_EVENT_INVALID_EVENTDEFINITION'],
    check: onTypes('bpmn:IntermediateCatchEvent', (event, api) => {
      if (engineDefinitions(event).length > 0 && !firstIs(event, ['bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:LinkEventDefinition'])) {
        api.report(event, `Intermediate catch event ${event.id} has a ${definitionName(event)} definition`);
      }
    }),
    bad: [{ body: '<intermediateCatchEvent id="c"><errorEventDefinition/></intermediateCatchEvent>', ids: ['c'] }],
    good: [{ body: `<intermediateCatchEvent id="c">${TIMER}</intermediateCatchEvent>` }],
  }),
  defineRule({
    id: 'throw-event-invalid-eventdefinition',
    tag: 'V',
    key: 'THROW_EVENT_INVALID_EVENTDEFINITION',
    severity: 'error',
    title: 'An intermediate throw event has a definition other than signal, compensate, message or link',
    why: 'Activiti throws signals, compensation, messages and links from an intermediate event. (Escalation is not parsed and silently becomes a plain throw event: see the unsupported event definition rule.)',
    evidence: [R1_7],
    howToFix: 'Change the definition.',
    serverKeys: ['THROW_EVENT_INVALID_EVENTDEFINITION'],
    check: onTypes('bpmn:IntermediateThrowEvent', (event, api) => {
      if (engineDefinitions(event).length > 0 && !firstIs(event, ['bpmn:SignalEventDefinition', 'bpmn:CompensateEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:LinkEventDefinition'])) {
        api.report(event, `Intermediate throw event ${event.id} has a ${definitionName(event)} definition`);
      }
    }),
    bad: [{ body: '<intermediateThrowEvent id="t"><errorEventDefinition/></intermediateThrowEvent>', ids: ['t'] }],
    good: [{ body: '<intermediateThrowEvent id="t"><compensateEventDefinition/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'end-event-cancel-only-inside-transaction',
    tag: 'V',
    key: 'END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION',
    severity: 'error',
    title: 'A cancel end event is not directly inside a transaction',
    why: 'A cancel end event cancels the transaction around it.',
    evidence: [R1_7],
    howToFix: 'Move the event into a transaction, or use another end event.',
    serverKeys: ['END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION'],
    check: onTypes('bpmn:EndEvent', (event, api) => {
      if (firstIs(event, ['bpmn:CancelEventDefinition']) && !is(event.$parent, 'bpmn:Transaction')) api.report(event, `Cancel end event ${event.id} is not inside a transaction`);
    }),
    bad: [{ body: '<endEvent id="e"><cancelEventDefinition/></endEvent>', ids: ['e'] }],
    good: [{ body: '<transaction id="tx"><endEvent id="e"><cancelEventDefinition/></endEvent></transaction>' }],
  }),
  ...(
    [
      ['link-event-definition-missing-target', 'LINK_EVENT_DEFINITION_MISSING_TARGET', true, true],
      ['link-event-definition-missing-target-empty-name', 'LINK_EVENT_DEFINITION_MISSING_TARGET_EMPTY_NAME', true, false],
      ['link-event-definition-missing-source', 'LINK_EVENT_DEFINITION_MISSING_SOURCE', false, true],
      ['link-event-definition-missing-source-empty-name', 'LINK_EVENT_DEFINITION_MISSING_SOURCE_EMPTY_NAME', false, false],
    ] as const
  ).map(([id, key, isThrow, named]) =>
    defineRule({
      id,
      tag: 'V',
      key,
      severity: 'error',
      title: `${isThrow ? 'A link throw event has no target' : 'A link catch event has no source'}${named ? '' : ' (the event has no name)'}`,
      why: `A link throw event jumps to the catch event named by its \`<target>\`; a link catch event lists the throw events that jump to it with \`<source>\`. ${named ? '' : 'Activiti reports an event without a name under this separate key.'}`,
      evidence: [R1_7, 'R1 §3.2'],
      howToFix: isThrow ? 'Pick the catching link event in **Link > Target**.' : 'Add the throwing link events as sources, or delete the catch event.',
      entry: 'link.target',
      serverKeys: [key],
      check: (node, api) => {
        if (!(isThrow ? is(node, 'bpmn:IntermediateThrowEvent') : is(node, 'bpmn:IntermediateCatchEvent'))) return;
        const hasName = !isBlank(str(node, 'name'));
        if (hasName !== named) return;
        for (const definition of list(node, 'eventDefinitions').filter((d) => is(d, 'bpmn:LinkEventDefinition'))) {
          const empty = isThrow
            ? !definition.get('target') && api.ctx.unresolved?.get(definition)?.['target'] === undefined
            : list(definition, 'source').length === 0 && api.ctx.unresolved?.get(definition)?.['source'] === undefined;
          if (empty) api.report(node, isThrow ? `Link throw event ${node.id} has no target` : `Link catch event ${node.id} has no source`);
        }
      },
      bad: [
        isThrow
          ? { body: `<intermediateThrowEvent id="l"${named ? ' name="Jump"' : ''}><linkEventDefinition id="ld" name="x"/></intermediateThrowEvent>`, ids: ['l'] }
          : { body: `<intermediateCatchEvent id="l"${named ? ' name="Land"' : ''}><linkEventDefinition id="ld" name="x"/></intermediateCatchEvent>`, ids: ['l'] },
      ],
      good: [
        {
          body: `<intermediateThrowEvent id="a" name="Jump"><linkEventDefinition id="ta" name="x"><target>tb</target></linkEventDefinition></intermediateThrowEvent><intermediateCatchEvent id="b" name="Land"><linkEventDefinition id="tb" name="x"><source>ta</source></linkEventDefinition></intermediateCatchEvent>`,
        },
      ],
    }),
  ),
];

