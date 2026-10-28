/** Rules for engine behaviour the validator does not catch: R1 §7.1 L12 to L35 and the traps recorded in docs/engine-findings.md. */
import { defineRule, onDefinitions, onTypes } from '../define';
import { allFlowElements, artifactsOf, bool, extensionValues, fieldsOf, flowElementsOf, is, isBlank, label, list, rootElements, str } from '../model';
import { ACTIVITI_EVENT_TYPES, ENTITY_TYPES } from './validator-tasks';
import { outgoingFlows } from './validator-structure';
import { parseXmlLite, type XmlNode } from '../xml-lite';
import type { ME } from '../types';

const ext = (...inner: string[]): string => `<extensionElements>${inner.join('')}</extensionElements>`;

const isActivity = (e: ME): boolean => is(e, 'bpmn:Activity');
const compensationBoundaries = (activity: ME, container: ME): ME[] =>
  flowElementsOf(container).filter((e) => is(e, 'bpmn:BoundaryEvent') && e.get('attachedToRef') === activity && list(e, 'eventDefinitions').some((d) => is(d, 'bpmn:CompensateEventDefinition')));
const handlerOf = (boundary: ME, container: ME): ME | undefined => {
  const association = artifactsOf(container).find((a) => is(a, 'bpmn:Association') && a.get('sourceRef') === boundary);
  const target = association?.get('targetRef') as ME | undefined;
  return target && bool(target, 'isForCompensation') ? target : undefined;
};
const messageDef = (extra = ''): string => `<messageEventDefinition messageRef="m"${extra}/>`;

/** Is `target` reachable from `start` along sequence flows of one container? */
function reachable(start: ME, target: ME): boolean {
  const seen = new Set<ME>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const flow of outgoingFlows(current)) {
      const next = flow.get('targetRef') as ME | undefined;
      if (next) queue.push(next);
    }
  }
  return false;
}

const eventDefinitionsOf = (e: ME): ME[] => (is(e, 'bpmn:Event') ? list(e, 'eventDefinitions') : []);

export const trapRules = [
  defineRule({
    id: 'cancel-end-without-compensation',
    tag: 'L12',
    severity: 'error',
    title: 'A cancel end event in a transaction without compensable work before it',
    why: 'A cancel end event moves the transaction\'s compensation subscriptions into an event scope and leaves through the cancel boundary event. When no compensable activity completed before it there is no event scope, and the completion fails with `No execution found for sub process of boundary cancel event` and rolls back (the task before the cancel end stays open).',
    evidence: ['R1 §3.2', 'R1 §7.1 L12', 'engine-findings C09.1'],
    howToFix: 'Put an activity with a compensation boundary event and a handler (an association to a task with `isForCompensation`) before the cancel end event, or end the transaction normally.',
    check: onTypes('bpmn:Transaction', (transaction, api) => {
      const compensable = flowElementsOf(transaction).filter((a) => isActivity(a) && compensationBoundaries(a, transaction).some((b) => handlerOf(b, transaction)));
      for (const end of flowElementsOf(transaction).filter((e) => is(e, 'bpmn:EndEvent') && eventDefinitionsOf(e).some((d) => is(d, 'bpmn:CancelEventDefinition')))) {
        if (!compensable.some((a) => reachable(a, end))) api.report(end, `Cancel end event ${end.id} of ${transaction.id}: no compensable activity (with a compensation boundary event and a handler) comes before it`);
      }
    }),
    bad: [{ body: '<transaction id="tx"><startEvent id="s"/><task id="t"/><endEvent id="c"><cancelEventDefinition/></endEvent><sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="c"/></transaction>', ids: ['c'] }],
    good: [{ body: '<transaction id="tx"><startEvent id="s"/><task id="t"/><boundaryEvent id="b" attachedToRef="t"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><endEvent id="c"><cancelEventDefinition/></endEvent><sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="c"/></transaction>' }],
  }),
  defineRule({
    id: 'message-throw-without-delegate',
    tag: 'L18',
    severity: 'warn',
    title: 'A message throw event without a delegate',
    why: 'Intermediate and end message events do not send anything by default: the default `ThrowMessageDelegate` is a no-op that returns true. A real send needs a delegate (`activiti:class` or `activiti:delegateExpression` on the message definition) that implements `ThrowMessageDelegate`.',
    evidence: ['R1 §0.1-13', 'R1 §7.1 L18', 'engine run t21'],
    howToFix: 'Set the **Throw delegate** in the Message group, or accept that nothing is sent (the mapping inputs still reach the delegate as the payload).',
    entry: 'message.class',
    check: (node, api) => {
      if (!(is(node, 'bpmn:IntermediateThrowEvent') || is(node, 'bpmn:EndEvent'))) return;
      for (const def of list(node, 'eventDefinitions').filter((d) => is(d, 'bpmn:MessageEventDefinition'))) {
        if (isBlank(str(def, 'activiti:class')) && isBlank(str(def, 'activiti:delegateExpression'))) api.report(node, `${label(node)} throws a message but no delegate sends it: Activiti does nothing`);
      }
    },
    bad: [{ head: '<message id="m" name="m"/>', body: `<intermediateThrowEvent id="t">${messageDef()}</intermediateThrowEvent>`, ids: ['t'] }],
    good: [{ head: '<message id="m" name="m"/>', body: `<intermediateThrowEvent id="t">${messageDef(' activiti:delegateExpression="${sender}"')}</intermediateThrowEvent>` }],
  }),
  defineRule({
    id: 'message-definition-field-ignored',
    tag: 'X',
    severity: 'warn',
    title: 'An activiti:field on a message event definition',
    why: 'The fields are parsed but the throw delegates are created with an empty field list: a field of the delegate stays null. Only the input mapping of the throw event reaches the delegate (as `ThrowMessage.payload`).',
    evidence: ['engine-findings 33'],
    howToFix: 'Pass the data through the throw event\'s input mapping instead.',
    entry: 'message.fields',
    check: onTypes('bpmn:MessageEventDefinition', (def, api) => {
      if (fieldsOf(def).length > 0) api.report(def.$parent ?? def, `${label(def.$parent ?? def)} has message fields, which Activiti never injects`);
    }),
    bad: [{ head: '<message id="m" name="m"/>', body: `<intermediateThrowEvent id="t"><messageEventDefinition messageRef="m">${ext('<activiti:field name="to"><activiti:string>x</activiti:string></activiti:field>')}</messageEventDefinition></intermediateThrowEvent>`, ids: ['t'] }],
    good: [{ head: '<message id="m" name="m"/>', body: `<intermediateThrowEvent id="t">${messageDef()}</intermediateThrowEvent>` }],
  }),
  defineRule({
    id: 'failed-job-retry-ignored',
    tag: 'L31',
    severity: 'warn',
    title: 'failedJobRetryTimeCycle on an element other than a service task',
    why: 'The retry cycle is honoured only for service tasks (`JobRetryCmd` reads it when the failed element is a ServiceTask). On any other element the model keeps the value and the job gets the default three attempts.',
    evidence: ['R1 §7.1 L31', 'engine-findings C19.2', 'FEATURE_MATRIX T15a'],
    howToFix: 'Remove it, or make the element a service task.',
    entry: 'job.failedJobRetryTimeCycle',
    check: (node, api) => {
      if (!is(node, 'bpmn:FlowNode') || is(node, 'bpmn:ServiceTask')) return;
      if (extensionValues(node, 'activiti:FailedJobRetryTimeCycle').length > 0) api.report(node, `${label(node)} has a failed job retry cycle, which Activiti only applies to service tasks`);
    },
    bad: [{ body: `<userTask id="u" activiti:async="true">${ext('<activiti:failedJobRetryTimeCycle>R5/PT1S</activiti:failedJobRetryTimeCycle>')}</userTask>`, ids: ['u'] }],
    good: [{ body: `<serviceTask id="s" activiti:class="a.B" activiti:async="true">${ext('<activiti:failedJobRetryTimeCycle>R5/PT1S</activiti:failedJobRetryTimeCycle>')}</serviceTask>` }],
  }),
  defineRule({
    id: 'map-exception-ignored',
    tag: 'L32',
    severity: 'warn',
    title: 'mapException on an element where Activiti does not wire it',
    why: 'Exception mapping is wired only for service tasks that run a Java class (`activiti:class`) and for call activities. On a delegate expression, a connector, an expression or any other element the entries are parsed and never used: the Java exception rolls the call back instead of becoming a BPMN error.',
    evidence: ['R1 §7.1 L32', 'engine-findings C08.6', 'FEATURE_MATRIX T15b'],
    howToFix: 'Use an `activiti:class` service task, or throw a `BpmnError` from the delegate or connector.',
    entry: 'errors.mapExceptions',
    check: (node, api) => {
      if (!is(node, 'bpmn:FlowNode')) return;
      if (extensionValues(node, 'activiti:MapException').length === 0) return;
      const supported = is(node, 'bpmn:CallActivity') || (is(node, 'bpmn:ServiceTask') && !isBlank(str(node, 'activiti:class')));
      if (!supported) api.report(node, `${label(node)} has exception mappings, which Activiti only applies to Java class service tasks and call activities`);
    },
    bad: [{ body: `<serviceTask id="s" activiti:delegateExpression="\${bean}">${ext('<activiti:mapException errorCode="E1" includeChildExceptions="true">java.lang.Exception</activiti:mapException>')}</serviceTask>`, ids: ['s'] }],
    good: [{ body: `<serviceTask id="s" activiti:class="a.B">${ext('<activiti:mapException errorCode="E1">java.lang.Exception</activiti:mapException>')}</serviceTask>` }],
  }),
  defineRule({
    id: 'loop-data-ref-not-variable-name',
    tag: 'L35',
    severity: 'error',
    title: 'A multi-instance loopDataInputRef / loopDataOutputRef that is not a variable name',
    why: 'BPMN says these are references to data inputs and outputs; Activiti reads the element text as the **name of a process variable**. Anything that is not a plain name (an id with a dash, an expression, a path) never resolves.',
    evidence: ['FEATURE_MATRIX T16', 'FEATURE_MATRIX §D L35', 'engine-findings 3'],
    howToFix: 'Write the variable name in the **Collection** / **Output collection** field.',
    entry: 'mi.collection',
    check: onTypes('bpmn:MultiInstanceLoopCharacteristics', (loop, api) => {
      for (const prop of ['loopDataInputRef', 'loopDataOutputRef']) {
        const value = loop[prop];
        if (typeof value === 'string' && value.trim() !== '' && !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(value.trim())) api.report(loop.$parent ?? loop, `${prop} "${value.trim()}" of ${label(loop.$parent ?? loop)} is not a plain variable name`);
      }
    }),
    bad: [{ body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopDataInputRef>people-list</loopDataInputRef></multiInstanceLoopCharacteristics></userTask>', ids: ['u'] }],
    good: [{ body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopDataInputRef>people</loopDataInputRef><loopDataOutputRef>results</loopDataOutputRef></multiInstanceLoopCharacteristics></userTask>' }],
  }),
  defineRule({
    id: 'auto-store-variables-no-effect',
    tag: 'X',
    severity: 'warn',
    title: 'autoStoreVariables on a script task',
    why: 'The flag only switches how the script bindings store variables. Nashorn never calls the binding for a global assignment or a `var` declaration, and the JUEL script engine cannot assign at all, so the flag does nothing with the bundled script languages.',
    evidence: ['engine-findings 25', 'FEATURE_MATRIX T9'],
    howToFix: 'Write variables with `execution.setVariable("name", value)`, or use the result variable.',
    entry: 'script.autoStoreVariables',
    check: onTypes('bpmn:ScriptTask', (task, api) => {
      if (bool(task, 'activiti:autoStoreVariables') === true) api.report(task, `${label(task)} sets autoStoreVariables, which has no effect with JavaScript or JUEL`);
    }),
    bad: [{ body: '<scriptTask id="s" scriptFormat="javascript" activiti:autoStoreVariables="true"><script>x = 1</script></scriptTask>', ids: ['s'] }],
    good: [{ body: '<scriptTask id="s" scriptFormat="javascript"><script>execution.setVariable("x", 1)</script></scriptTask>' }],
  }),
  defineRule({
    id: 'signal-expression-with-declared-signal',
    tag: 'X',
    severity: 'error',
    title: 'A signal named by an expression in a file that declares signals',
    why: 'When a file declares any `<signal>`, parsing an event named by `activiti:signalExpression` fails with a NullPointerException ("Error parsing XML"), for catch, throw and boundary events alike. The same file deploys when it declares no signal; the expression-named signal is then always global.',
    evidence: ['engine-findings 28'],
    howToFix: 'Name the signal with `signalRef` and remove the expression, or remove the `<signal>` definitions of the file.',
    entry: 'signal.expression',
    check: onDefinitions((definitions, api) => {
      if (!rootElements(definitions).some((r) => is(r, 'bpmn:Signal'))) return;
      for (const process of rootElements(definitions).filter((r) => is(r, 'bpmn:Process'))) {
        for (const event of allFlowElements(process)) {
          if (eventDefinitionsOf(event).some((d) => is(d, 'bpmn:SignalEventDefinition') && !isBlank(str(d, 'activiti:signalExpression')))) api.report(event, `${label(event)} uses a signal expression, but the file declares signals: Activiti fails to parse it`);
        }
      }
    }),
    bad: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>', ids: ['c'] }],
    good: [{ body: '<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>' }],
  }),
  defineRule({
    id: 'signal-expression-catch-stale-subscription',
    tag: 'X',
    severity: 'warn',
    title: 'A signal catch event named by an expression',
    why: 'The subscription of an intermediate catch event named by `signalExpression` is removed by comparing with `signalRef`, which is null for an expression, so the execution keeps a stale subscription while it moves on. A second broadcast of the name signals whatever it waits at later: a receive task is left, a user task fails with `UserTask should not be signalled before complete`.',
    evidence: ['engine-findings 29'],
    howToFix: 'Use a declared signal (`signalRef`) for catch events; keep expressions for throw events.',
    entry: 'signal.ref',
    check: onTypes('bpmn:IntermediateCatchEvent', (event, api) => {
      if (eventDefinitionsOf(event).some((d) => is(d, 'bpmn:SignalEventDefinition') && !isBlank(str(d, 'activiti:signalExpression')))) api.report(event, `${label(event)} waits for a signal named by an expression: its subscription is never removed`);
    }),
    bad: [{ body: '<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>', ids: ['c'] }],
    good: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>' }, { body: '<intermediateThrowEvent id="t"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'signal-throw-async-drops-payload',
    tag: 'X',
    severity: 'info',
    title: 'An asynchronous signal throw',
    why: 'An asynchronous signal creates an event job that stores only the subscription id: the payload (the variables the signal carries) is dropped (the source says "TODO: support payload"). The job also needs the async executor.',
    evidence: ['engine-findings 35'],
    howToFix: 'Throw the signal synchronously when the catcher needs the variables.',
    entry: 'signal.async',
    check: (node, api) => {
      if (eventDefinitionsOf(node).some((d) => is(d, 'bpmn:SignalEventDefinition') && bool(d, 'activiti:async') === true)) api.report(node, `${label(node)} throws its signal asynchronously: the payload is dropped`);
    },
    bad: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sg" activiti:async="true"/></intermediateThrowEvent>', ids: ['t'] }],
    good: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sg"/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'compensate-activity-ref-not-handler',
    tag: 'X',
    severity: 'warn',
    title: 'A compensation throw event that names the compensated activity instead of its handler',
    why: 'The subscription of a compensation boundary event is keyed by the id of the **handler**, and the throw event looks subscriptions up by `activityRef`. `activityRef="bookFlight"` (the task the BPMN specification means) finds nothing and the event passes silently; `activityRef="cancelFlight"` (the handler) compensates it. For a completed sub process the sub process id is right.',
    evidence: ['engine-findings C08.2'],
    howToFix: 'Choose the compensation handler in **Compensation > Activity**.',
    entry: 'compensate.activityRef',
    check: (node, api) => {
      if (!is(node, 'bpmn:IntermediateThrowEvent')) return;
      for (const def of eventDefinitionsOf(node).filter((d) => is(d, 'bpmn:CompensateEventDefinition'))) {
        const target = def.get('activityRef') as ME | undefined;
        const container = target?.$parent;
        if (target && container && !is(target, 'bpmn:SubProcess') && compensationBoundaries(target, container).length > 0) api.report(node, `${label(node)} compensates ${target.id}, which has a compensation handler: the event must name the handler`);
      }
    },
    bad: [{ body: '<task id="book"/><boundaryEvent id="b" attachedToRef="book"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><intermediateThrowEvent id="t"><compensateEventDefinition activityRef="book"/></intermediateThrowEvent>', ids: ['t'] }],
    good: [{ body: '<task id="book"/><boundaryEvent id="b" attachedToRef="book"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><intermediateThrowEvent id="t"><compensateEventDefinition activityRef="undo"/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'compensate-wait-for-completion-ignored',
    tag: 'X',
    severity: 'info',
    title: 'waitForCompletion="false" on a compensation throw event',
    why: 'The attribute is parsed and ignored: asynchronous compensation is a TODO in the engine, the handlers run to completion before the process moves on.',
    evidence: ['engine-findings C08.3'],
    howToFix: 'Remove the attribute.',
    entry: 'compensate.waitForCompletion',
    check: onTypes('bpmn:CompensateEventDefinition', (def, api) => {
      if (bool(def, 'waitForCompletion') === false) api.report(def.$parent ?? def, `${label(def.$parent ?? def)} does not wait for completion, but Activiti always waits`);
    }),
    bad: [{ body: '<intermediateThrowEvent id="t"><compensateEventDefinition waitForCompletion="false"/></intermediateThrowEvent>', ids: ['t'] }],
    good: [{ body: '<intermediateThrowEvent id="t"><compensateEventDefinition/></intermediateThrowEvent>' }],
  }),
  defineRule({
    id: 'error-boundary-non-interrupting',
    tag: 'X',
    severity: 'info',
    title: 'cancelActivity="false" on an error boundary event',
    why: 'The converter forces `cancelActivity=false` for error boundary events whatever the XML says and executes them as an interrupting error catch. The flag means nothing.',
    evidence: ['engine-findings C08.5', 'R1 §3.2'],
    howToFix: 'Remove the flag.',
    check: onTypes('bpmn:BoundaryEvent', (event, api) => {
      if (event.get('cancelActivity') === false && eventDefinitionsOf(event).some((d) => is(d, 'bpmn:ErrorEventDefinition'))) api.report(event, `${label(event)}: an error boundary event always interrupts`);
    }),
    bad: [{ body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t" cancelActivity="false"><errorEventDefinition/></boundaryEvent>', ids: ['b'] }],
    good: [{ body: '<task id="t"/><boundaryEvent id="b" attachedToRef="t"><errorEventDefinition/></boundaryEvent>' }],
  }),
  defineRule({
    id: 'process-end-listener-sets-variable',
    tag: 'X',
    severity: 'warn',
    title: 'A process end listener that sets a variable',
    why: 'The process `end` execution listeners run after the process instance execution was deleted, so a `setVariable` inserts a variable for a deleted execution (`PersistenceException`, foreign key violation) and the whole completion rolls back: the last task cannot be completed.',
    evidence: ['engine-findings C13.1'],
    howToFix: 'Set the variable before the end event, or listen on the last activity instead.',
    entry: 'listeners.execution',
    check: onTypes('bpmn:Process', (process, api) => {
      for (const listener of extensionValues(process, 'activiti:ExecutionListener')) {
        const expression = `${str(listener, 'expression') ?? ''}`;
        if (str(listener, 'event') === 'end' && /setVariable|\.set[A-Z]\w*Variable/.test(expression)) api.report(process, `The end listener of ${process.id} sets a variable after the process instance is gone: the completion rolls back`);
      }
    }),
    bad: [{ body: ext('<activiti:executionListener event="end" expression="${execution.setVariable(\'done\', true)}"/>'), ids: ['p'] }],
    good: [{ body: ext('<activiti:executionListener event="end" expression="${audit.log(execution)}"/>') }],
  }),
  defineRule({
    id: 'listener-expression-calls-notify',
    tag: 'X',
    severity: 'warn',
    title: 'A listener expression that calls a method named notify',
    why: 'The expression resolver blocks the methods of `Object`, including `notify`, so `${bean.notify(execution)}` fails with "Error while evaluating expression".',
    evidence: ['engine-findings C13.3'],
    howToFix: 'Give the method another name, or use a delegate expression.',
    entry: 'listeners.execution',
    check: (node, api) => {
      if (node.$type !== 'activiti:ExecutionListener' && node.$type !== 'activiti:TaskListener') return;
      const expression = str(node, 'expression');
      if (expression && /\.\s*notify\s*\(/.test(expression)) api.report(node, `The listener expression "${expression}" calls notify, which the expression language blocks`);
    },
    bad: [{ body: `<task id="t">${ext('<activiti:executionListener event="start" expression="${rec.notify(execution)}"/>')}</task>`, ids: ['t'] }],
    good: [{ body: `<task id="t">${ext('<activiti:executionListener event="start" expression="${rec.recordExecution(execution)}"/>')}</task>` }],
  }),
  defineRule({
    id: 'exclusive-gateway-end-listener',
    tag: 'X',
    severity: 'warn',
    title: 'An end execution listener on an exclusive gateway',
    why: 'An exclusive gateway moves the execution onto the chosen flow itself, so its `end` listeners never run (its `start` listeners and the `take` listeners of the flows do).',
    evidence: ['engine-findings C13.2'],
    howToFix: 'Use a `take` listener on the outgoing flows, or a `start` listener on the gateway.',
    entry: 'listeners.execution',
    check: onTypes('bpmn:ExclusiveGateway', (gateway, api) => {
      if (extensionValues(gateway, 'activiti:ExecutionListener').some((l) => str(l, 'event') === 'end')) api.report(gateway, `${label(gateway)} has an end listener, which Activiti never calls for an exclusive gateway`);
    }),
    bad: [{ body: `<exclusiveGateway id="g">${ext('<activiti:executionListener event="end" class="a.B"/>')}</exclusiveGateway>`, ids: ['g'] }],
    good: [{ body: `<exclusiveGateway id="g">${ext('<activiti:executionListener event="start" class="a.B"/>')}</exclusiveGateway>` }],
  }),
  defineRule({
    id: 'event-listener-invalid-events',
    tag: 'X',
    severity: 'error',
    title: 'A process event listener with an unknown event type or entity type',
    why: '`events` is a comma separated list of `ActivitiEventType` names and `entityType` one of attachment, comment, execution, identity-link, job, process-definition, process-instance, task; anything else is rejected when the process is deployed.',
    evidence: ['R1 §4.8', 'ActivitiEventType (activiti-engine 9.0.0)'],
    howToFix: 'Choose the events from the list in the **Event listeners** group.',
    entry: 'listeners.event',
    check: onTypes('bpmn:Process', (process, api) => {
      for (const listener of extensionValues(process, 'activiti:EventListener')) {
        const events = (str(listener, 'events') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
        const unknown = events.filter((e) => !ACTIVITI_EVENT_TYPES.includes(e));
        if (unknown.length > 0) api.report(process, `Event listener of ${process.id}: "${unknown.join(', ')}" is not an Activiti event type`);
        const entity = str(listener, 'entityType');
        if (entity && !(ENTITY_TYPES as readonly string[]).includes(entity)) api.report(process, `Event listener of ${process.id}: entity type "${entity}" is not one of ${ENTITY_TYPES.join(', ')}`);
      }
    }),
    bad: [{ body: ext('<activiti:eventListener events="TASK_MADE_UP" class="a.B"/>'), ids: ['p'] }, { body: ext('<activiti:eventListener events="TASK_CREATED" entityType="order" class="a.B"/>'), ids: ['p'] }],
    good: [{ body: ext('<activiti:eventListener events="TASK_CREATED,PROCESS_COMPLETED" entityType="task" class="a.B"/>') }],
  }),
  defineRule({
    id: 'data-object-type-unknown',
    tag: 'X',
    severity: 'error',
    title: 'A data object of a type Activiti does not know',
    why: 'Data objects support xsd:string, xsd:int, xsd:long, xsd:double, xsd:boolean and xsd:datetime (any prefix, the local part is matched). For another type the engine logs an error and drops the data object, so the variable never exists.',
    evidence: ['R1 §3.9', 'engine-findings C15.6'],
    howToFix: 'Choose one of the listed types in the **Data object** group.',
    entry: 'data.type',
    check: onTypes('bpmn:DataObject', (data, api) => {
      const type = str(data, 'itemSubjectRef');
      if (type && !['string', 'int', 'long', 'double', 'boolean', 'datetime'].includes(type.slice(type.indexOf(':') + 1))) api.report(data, `Data object ${data.id} has the type "${type}", which Activiti drops`);
    }),
    bad: [{ body: '<dataObject id="d1" name="amount" itemSubjectRef="xsd:decimal"/>', ids: ['d1'] }],
    good: [{ body: '<dataObject id="d1" name="amount" itemSubjectRef="xsd:int"/><dataObject id="d2" name="note"/>' }],
  }),
  defineRule({
    id: 'mail-task-without-from',
    tag: 'X',
    severity: 'info',
    title: 'A mail task without a "from" field',
    why: 'The sender is the `from` field or else the engine\'s default from address (`spring.activiti.mail-server-default-from`); with neither, the task fails with a NullPointerException in `setFrom`.',
    evidence: ['engine-findings C14.1', 'R1 §3.3'],
    howToFix: 'Add a `from` field, or configure the default from address of the application.',
    entry: 'fields.list',
    check: (node, api) => {
      if ((is(node, 'bpmn:ServiceTask') || is(node, 'bpmn:SendTask')) && (str(node, 'activiti:type') ?? '').toLowerCase() === 'mail' && !fieldsOf(node).some((f) => f.name === 'from')) api.report(node, `Mail task ${node.id} has no "from": the application needs a default from address`);
    },
    bad: [{ body: `<serviceTask id="m" activiti:type="mail">${ext('<activiti:field name="to"><activiti:string>a@b.c</activiti:string></activiti:field>')}</serviceTask>`, ids: ['m'] }],
    good: [{ body: `<serviceTask id="m" activiti:type="mail">${ext('<activiti:field name="from"><activiti:string>x@y.z</activiti:string></activiti:field>')}</serviceTask>` }],
  }),
  defineRule({
    id: 'shell-task-needs-opt-in',
    tag: 'X',
    severity: 'info',
    title: 'A shell task',
    why: 'A shell task runs an operating system command: the modeler server rejects it at deployment unless `modeler.server.allow-shell-tasks=true`, and a production application should not run one at all. A non-zero exit code never fails the task.',
    evidence: ['ADR 0007', 'engine-findings C14.4'],
    howToFix: 'Enable shell tasks on the server for development, or call the program from a Java class or connector.',
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if ((str(task, 'activiti:type') ?? '').toLowerCase() === 'shell') api.report(task, `Shell task ${task.id} runs an operating system command`);
    }),
    bad: [{ body: `<serviceTask id="s" activiti:type="shell">${ext('<activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field>')}</serviceTask>`, ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" activiti:class="a.B"/>' }],
  }),
  // --- text level rules (they look at the file as written)
  defineRule({
    id: 'artifact-before-flow-element',
    tag: 'X',
    severity: 'error',
    title: 'A text annotation or association written before a flow element',
    why: 'The BPMN XSD that Activiti validates against orders a process as laneSet, flow elements, then artifacts. A text annotation or association before a later `sequenceFlow` fails the deployment with `cvc-complex-type.2.4.a: Invalid content was found starting with element \'sequenceFlow\'`. The modeler writes artifacts last, so saving the file fixes it.',
    evidence: ['engine-findings C18.1', 'ADR 0003 guarantee 3'],
    howToFix: 'Save the file from the modeler (it re-orders the elements), or move the artifacts to the end of the process in the XML.',
    needs: ['text'],
    check: onDefinitions((_definitions, api) => {
      if (!api.ctx.text) return;
      const root = parseXmlLite(api.ctx.text);
      if (!root) return;
      const ARTIFACT = new Set(['textAnnotation', 'association', 'group']);
      const NOT_FLOW = new Set(['documentation', 'extensionElements', 'laneSet', 'ioSpecification', 'property', 'resourceRole', 'performer', 'humanPerformer', 'potentialOwner', 'auditing', 'monitoring', 'correlationSubscription', 'supports', 'dataInputAssociation', 'dataOutputAssociation', 'standardLoopCharacteristics', 'multiInstanceLoopCharacteristics']);
      const visit = (node: XmlNode): void => {
        if (['process', 'subProcess', 'transaction', 'adHocSubProcess'].includes(node.local)) {
          let artifactSeen: XmlNode | undefined;
          for (const c of node.children) {
            if (ARTIFACT.has(c.local)) artifactSeen ??= c;
            else if (!NOT_FLOW.has(c.local) && artifactSeen) {
              api.report(node.attrs['id'] ?? '', `${node.local} ${node.attrs['id'] ?? ''}: ${artifactSeen.local} ${artifactSeen.attrs['id'] ?? ''} comes before ${c.local} ${c.attrs['id'] ?? ''}; artifacts must follow the flow elements`);
              break;
            }
          }
        }
        node.children.forEach(visit);
      };
      visit(root);
    }),
    bad: [{ body: '<task id="t"/><textAnnotation id="n"><text>note</text></textAnnotation><task id="u"/>', ids: ['p'] }],
    good: [{ body: '<task id="t"/><task id="u"/><textAnnotation id="n"><text>note</text></textAnnotation><association id="a" sourceRef="t" targetRef="n"/>' }],
  }),
  defineRule({
    id: 'multi-instance-minified-xml',
    tag: 'L16',
    severity: 'error',
    title: 'The closing tag of a multi-instance activity follows its loop element without a line break',
    why: 'The Activiti parser unconditionally consumes one more XML event after `</multiInstanceLoopCharacteristics>`. When that event is the closing tag of the activity (minified XML), the tag is swallowed and every following flow element is absorbed into the task: the process deploys, has no sequence flows, and ends immediately at start without an error. The modeler\'s serializer always puts a line break there.',
    evidence: ['R1 §0.2-14', 'R1 §7.1 L16', 'ADR 0003 guarantee 2'],
    howToFix: 'Save the file from the modeler, or put a line break after `</multiInstanceLoopCharacteristics>`.',
    needs: ['text'],
    check: onDefinitions((_definitions, api) => {
      const text = api.ctx.text;
      if (!text || !text.includes('multiInstanceLoopCharacteristics')) return;
      const root = parseXmlLite(text);
      if (!root) return;
      const hosts: Array<string | undefined> = [];
      const collect = (node: XmlNode, parent?: XmlNode): void => {
        if (node.local === 'multiInstanceLoopCharacteristics') hosts.push(parent?.attrs['id']);
        node.children.forEach((c) => collect(c, node));
      };
      collect(root);
      const stack: number[] = [];
      let opened = 0;
      for (const m of text.matchAll(/<(\/?)(?:[\w.-]+:)?multiInstanceLoopCharacteristics\b[^>]*?(\/?)>/g)) {
        if (m[1] === '/') {
          const index = stack.pop();
          if (index !== undefined && text.slice(m.index + m[0].length).startsWith('</')) {
            api.report(hosts[index] ?? '', `${hosts[index] ?? 'an activity'}: </multiInstanceLoopCharacteristics> is followed directly by a closing tag; the Activiti parser would absorb the following flow elements`);
          }
        } else {
          if (m[2] !== '/') stack.push(opened);
          opened += 1;
        }
      }
    }),
    bad: [{ xml: '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"><userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><endEvent id="e"/></process></definitions>', ids: ['u'] }],
    good: [{ body: '<userTask id="u">\n<multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics>\n</userTask>' }],
  }),
];
