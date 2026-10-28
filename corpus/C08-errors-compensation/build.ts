import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C08 errors and compensation, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`: error boundary
 * events (with and without an error code) on class delegates, connectors, script tasks, call activities and sub processes, error end
 * events, error start events of event sub processes, the exception mapping of the Error mapping group (including the default entry
 * without an exception class, and the entries the engine does not wire), and compensation (compensation boundary events linked by
 * association to their handlers, throw events without and with activityRef, compensation inside a sub process). The runner compares
 * the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C08';
const FAILURE_DELEGATE = 'io.github.kleash.activiti.harness.support.FailureDelegate';

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string, errors: Array<{ id: string; name: string; errorCode: string }> = []): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
  if (errors.length > 0) await api.setProperty(id, 'definitions.errors', errors);
}

/** An error boundary event; without an error code it catches every error. */
async function errorBoundary(api: CorpusModeler, id: string, name: string, attachedTo: string, errorCode?: string): Promise<void> {
  await api.createShape({ type: 'boundaryEvent', id, name, attachedTo, eventDefinition: 'error' });
  if (errorCode) await api.setProperty(id, 'error.ref', errorCode);
}

const failureFields = (...variables: string[]): Array<{ name: string; expression: string }> => variables.map((v) => ({ name: v, expression: `\${execution.getVariable('${v}')}` }));

async function failureTask(api: CorpusModeler, id: string, name: string, variables: string[], position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'class');
  await api.setProperty(id, 'impl.class', FAILURE_DELEGATE);
  await api.setProperty(id, 'fields.list', failureFields(...variables));
}

async function expressionTask(api: CorpusModeler, id: string, name: string, expression: string, position: { x: number; y: number }, parent?: string): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position, ...(parent ? { parent } : {}) });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
}

async function endEvent(api: CorpusModeler, id: string, name: string | undefined, position: { x: number; y: number }, parent?: string): Promise<void> {
  await api.createShape({ type: 'endEvent', id, ...(name ? { name } : {}), at: position, ...(parent ? { parent } : {}) });
}

async function handler(api: CorpusModeler, id: string, name: string, position: { x: number; y: number }, parent?: string): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position, ...(parent ? { parent } : {}) });
  await api.setProperty(id, 'impl.type', 'delegateExpression');
  await api.setProperty(id, 'impl.delegateExpression', '${recordingDelegate}');
}

/** The compensation association from a compensation boundary event to its handler (marks the handler isForCompensation). */
const associate = (api: CorpusModeler, boundary: string, target: string): Promise<string> => api.connect(boundary, target, `a_${boundary}_${target}`, { type: 'association', attrs: { associationDirection: 'One' } });

async function condition(api: CorpusModeler, source: string, target: string, name: string, expression: string): Promise<void> {
  const id = `f_${source}_${target}`;
  await api.connect(source, target, id, { name });
  await api.setProperty(id, 'flow.condition', expression);
}

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C08-errors-compensation', { defaultMappings: 'none' });

  // --- compensation-flow ----------------------------------------------------------------------------------------------
  await newProcess(api, 'compensation-flow', 'compensationFlow', 'Book a trip with compensation',
    'Two compensable activities, each with a compensation boundary event and a handler (isForCompensation, linked by an association). When the payment check fails, the intermediate throw compensate event without activityRef broadcasts to every completed compensable activity of the process; the handlers run in reverse order of completion and the process continues.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'userTask', id: 'reserveFlight', name: 'Reserve flight', at: at(1, 0) });
  await api.setProperty('reserveFlight', 'user.assignee', 'ann');
  await api.createShape({ type: 'boundaryEvent', id: 'onFlightCompensate', name: 'Compensate flight', attachedTo: 'reserveFlight', eventDefinition: 'compensate' });
  await api.createShape({ type: 'userTask', id: 'reserveHotel', name: 'Reserve hotel', at: at(2, 0) });
  await api.setProperty('reserveHotel', 'user.assignee', 'ann');
  await api.createShape({ type: 'boundaryEvent', id: 'onHotelCompensate', name: 'Compensate hotel', attachedTo: 'reserveHotel', eventDefinition: 'compensate' });
  await api.createShape({ type: 'exclusiveGateway', id: 'paymentCheck', name: 'Payment failed?', at: at(3, 0) });
  await api.createShape({ type: 'intermediateThrowEvent', id: 'rollback', name: 'Roll back the booking', eventDefinition: 'compensate', at: at(4, 0) });
  await api.setProperty('rollback', 'compensate.waitForCompletion', true);
  await endEvent(api, 'rolledBack', 'Rolled back', at(5, 0));
  await endEvent(api, 'confirmed', 'Confirmed', at(4, 1));
  await handler(api, 'cancelFlight', 'Cancel flight', at(1, 2));
  await handler(api, 'cancelHotel', 'Cancel hotel', at(2, 2));
  await chain(api, 'start', 'reserveFlight', 'reserveHotel', 'paymentCheck');
  await condition(api, 'paymentCheck', 'rollback', 'yes', '${paymentFailed == true}');
  await api.connect('paymentCheck', 'confirmed', 'f_paymentCheck_confirmed', { name: 'no' });
  await api.setProperty('f_paymentCheck_confirmed', 'flow.default', true);
  await chain(api, 'rollback', 'rolledBack');
  await associate(api, 'onFlightCompensate', 'cancelFlight');
  await associate(api, 'onHotelCompensate', 'cancelHotel');

  // --- compensation-scopes --------------------------------------------------------------------------------------------
  await newProcess(api, 'compensation-scopes', 'compensationScopes', 'Compensating a completed sub process',
    'The compensable task and its handler live inside an embedded sub process. After the sub process has completed, a throw compensate event with activityRef set to the sub process id compensates it as a whole: the engine descends into the sub process scope and runs the handler (for a sub process the subscription is keyed by the sub process id).');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'subProcess', id: 'packing', name: 'Pack order', at: { x: 480, y: 220 }, size: { width: 520, height: 300 } });
  await api.createShape({ type: 'startEvent', id: 'pStart', parent: 'packing', at: { x: 290, y: 190 } });
  await expressionTask(api, 'pickItems', 'Pick items', "${execution.setVariable('picked', true)}", { x: 420, y: 190 }, 'packing');
  await api.createShape({ type: 'boundaryEvent', id: 'onPickCompensate', name: 'Compensate picking', attachedTo: 'pickItems', eventDefinition: 'compensate' });
  await endEvent(api, 'pEnd', undefined, { x: 570, y: 190 }, 'packing');
  await handler(api, 'restockItems', 'Restock items', { x: 420, y: 320 }, 'packing');
  await chain(api, 'pStart', 'pickItems', 'pEnd');
  await associate(api, 'onPickCompensate', 'restockItems');
  await api.createShape({ type: 'exclusiveGateway', id: 'orderCheck', name: 'Order cancelled?', at: { x: 820, y: 220 } });
  await api.createShape({ type: 'intermediateThrowEvent', id: 'cancelOrder', name: 'Compensate packing', eventDefinition: 'compensate', at: { x: 960, y: 140 } });
  await api.setProperty('cancelOrder', 'compensate.activityRef', 'packing');
  await endEvent(api, 'cancelledEnd', 'Order cancelled', { x: 1080, y: 140 });
  await endEvent(api, 'completed', 'Order completed', { x: 960, y: 300 });
  await api.connect('start', 'packing', 'f_start_packing');
  await api.connect('packing', 'orderCheck', 'f_packing_orderCheck');
  await condition(api, 'orderCheck', 'cancelOrder', 'yes', '${cancelled == true}');
  await api.connect('orderCheck', 'completed', 'f_orderCheck_completed', { name: 'no' });
  await api.setProperty('f_orderCheck_completed', 'flow.default', true);
  await chain(api, 'cancelOrder', 'cancelledEnd');

  // --- compensation-targets -------------------------------------------------------------------------------------------
  await newProcess(api, 'compensation-targets', 'compensationTargets', 'Targeted compensation',
    'Two compensable service tasks and four ways to leave: broadcast (no activityRef, waitForCompletion false), activityRef naming the compensation handler, activityRef naming the compensated task, or no compensation. In Activiti 9.0.0 the compensation subscription is keyed by the id of the handler, so only the handler id compensates; the id of the compensated task finds nothing and the throw event passes silently. waitForCompletion is parsed but not honoured: the handlers always finish before the process moves on.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await expressionTask(api, 'bookFlight', 'Book flight', "${execution.setVariable('flightBooked', true)}", at(1, 1));
  await api.createShape({ type: 'boundaryEvent', id: 'onFlightCompensate', name: 'Compensate flight', attachedTo: 'bookFlight', eventDefinition: 'compensate' });
  await expressionTask(api, 'bookHotel', 'Book hotel', "${execution.setVariable('hotelBooked', true)}", at(2, 1));
  await api.createShape({ type: 'boundaryEvent', id: 'onHotelCompensate', name: 'Compensate hotel', attachedTo: 'bookHotel', eventDefinition: 'compensate' });
  await api.createShape({ type: 'exclusiveGateway', id: 'target', name: 'What to compensate?', at: at(3, 1) });
  const throws: Array<{ id: string; name: string; row: number; end: string; endName: string; wait?: boolean; activityRef?: string }> = [
    { id: 'throwAll', name: 'Compensate everything', row: 0, end: 'allDone', endName: 'All compensated', wait: false },
    { id: 'throwHandler', name: 'Compensate by handler id', row: 1, end: 'handlerDone', endName: 'Handler compensated', activityRef: 'cancelFlight' },
    { id: 'throwTask', name: 'Compensate by task id', row: 2, end: 'taskDone', endName: 'Task id passed', activityRef: 'bookFlight' },
  ];
  for (const t of throws) {
    await api.createShape({ type: 'intermediateThrowEvent', id: t.id, name: t.name, eventDefinition: 'compensate', at: at(4, t.row) });
    if (t.wait !== undefined) await api.setProperty(t.id, 'compensate.waitForCompletion', t.wait);
    await endEvent(api, t.end, t.endName, at(5, t.row));
  }
  await endEvent(api, 'nothing', 'Nothing compensated', at(4, 3));
  await handler(api, 'cancelFlight', 'Cancel flight', at(1, 4));
  await handler(api, 'cancelHotel', 'Cancel hotel', at(2, 4));
  for (const t of throws) if (t.activityRef) await api.setProperty(t.id, 'compensate.activityRef', t.activityRef);
  await chain(api, 'start', 'bookFlight', 'bookHotel');
  await api.connect('bookHotel', 'target', 'f_bookHotel_target');
  await condition(api, 'target', 'throwAll', 'all', "${compensateWhat == 'all'}");
  await condition(api, 'target', 'throwHandler', 'flight handler', "${compensateWhat == 'handler'}");
  await condition(api, 'target', 'throwTask', 'flight task', "${compensateWhat == 'task'}");
  await api.connect('target', 'nothing', 'f_target_nothing', { name: 'nothing' });
  await api.setProperty('f_target_nothing', 'flow.default', true);
  await chain(api, 'throwAll', 'allDone');
  await chain(api, 'throwHandler', 'handlerDone');
  await chain(api, 'throwTask', 'taskDone');
  await associate(api, 'onFlightCompensate', 'cancelFlight');
  await associate(api, 'onHotelCompensate', 'cancelHotel');

  // --- connector-error ------------------------------------------------------------------------------------------------
  await newProcess(api, 'connector-error', 'connectorError', 'Connector throws a BPMN error',
    'A connector (implementation bpmnerror.EXECUTE) throws a BpmnError whose code is the inbound variable errorCode (mapped from failWith). Connectors have no mapException: they throw BpmnError instead. The task has no outgoing flow because the connector never returns. The specific boundary event wins over the catch-all boundary event (no errorRef) on the same task.',
    [{ id: 'cardDeclinedError', name: 'Card declined', errorCode: 'CARD_DECLINED' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'failureRequested', name: 'Failure requested?', at: at(1, 1) });
  await endEvent(api, 'notRequested', 'Nothing requested', at(2, 0));
  await api.createShape({ type: 'serviceTask', id: 'callBroken', name: 'Call broken connector', at: at(2, 2) });
  await api.setProperty('callBroken', 'impl.type', 'connector');
  await api.setProperty('callBroken', 'impl.connector', 'bpmnerror.EXECUTE');
  await errorBoundary(api, 'onCardDeclined', 'Card declined', 'callBroken', 'CARD_DECLINED');
  await endEvent(api, 'declined', 'Declined', at(4, 1));
  await errorBoundary(api, 'onAnyConnectorError', 'Any other error', 'callBroken');
  await endEvent(api, 'otherFailure', 'Other failure', at(4, 3));
  await api.connect('start', 'failureRequested', 'f_start_failureRequested');
  await condition(api, 'failureRequested', 'notRequested', 'no', '${empty failWith}');
  await api.connect('failureRequested', 'callBroken', 'f_failureRequested_callBroken', { name: 'yes' });
  await api.setProperty('f_failureRequested_callBroken', 'flow.default', true);
  await chain(api, 'onCardDeclined', 'declined');
  await chain(api, 'onAnyConnectorError', 'otherFailure');
  await api.setExtensions({ properties: [{ name: 'failWith', type: 'string' }] });
  await api.setProperty('callBroken', 'mapping.inputs', { errorCode: { type: 'VARIABLE', value: 'failWith' } });

  // --- delegate-error -------------------------------------------------------------------------------------------------
  await newProcess(api, 'delegate-error', 'delegateError', 'Class delegate throws a BPMN error',
    'A Java class delegate throws a BpmnError whose code is the process variable errorCode. The boundary event with errorRef catches PAYMENT_DECLINED; the boundary event without errorRef catches every other code. When no error is requested the task passes.',
    [{ id: 'paymentDeclinedError', name: 'Payment declined', errorCode: 'PAYMENT_DECLINED' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await failureTask(api, 'charge', 'Charge card', ['errorCode'], at(1, 1));
  await endEvent(api, 'charged', 'Charged', at(2, 1));
  await errorBoundary(api, 'onPaymentDeclined', 'Payment declined', 'charge', 'PAYMENT_DECLINED');
  await endEvent(api, 'declined', 'Declined', at(2, 2));
  await errorBoundary(api, 'onAnyFailure', 'Any other failure', 'charge');
  await endEvent(api, 'failed', 'Failed', at(2, 3));
  await chain(api, 'start', 'charge', 'charged');
  await chain(api, 'onPaymentDeclined', 'declined');
  await chain(api, 'onAnyFailure', 'failed');

  // --- error-event-sub-process ----------------------------------------------------------------------------------------
  await newProcess(api, 'error-event-sub-process', 'errorEventSubProcess', 'Error event sub processes',
    'Two event sub processes with an error start event: one with errorRef (VALIDATION), one without (any error). The specific one handles VALIDATION, the catch-all handles every other code. An error start event always interrupts the enclosing process, which then ends through the event sub process.',
    [{ id: 'validationError', name: 'Validation error', errorCode: 'VALIDATION' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await failureTask(api, 'work', 'Do the work', ['errorCode'], at(1, 0));
  await endEvent(api, 'workDone', 'Work done', at(2, 0));
  await chain(api, 'start', 'work', 'workDone');
  await api.createShape({ type: 'subProcess', id: 'onValidationError', name: 'Handle validation errors', triggeredByEvent: true, at: { x: 420, y: 330 }, size: { width: 440, height: 160 } });
  await api.createShape({ type: 'startEvent', id: 'validationErrorStart', name: 'Validation error', eventDefinition: 'error', parent: 'onValidationError', at: { x: 260, y: 330 } });
  await api.setProperty('validationErrorStart', 'error.ref', 'VALIDATION');
  await expressionTask(api, 'markValidation', 'Mark validation failure', "${execution.setVariable('handledBy', 'validation')}", { x: 420, y: 330 }, 'onValidationError');
  await endEvent(api, 'validationHandled', 'Validation handled', { x: 580, y: 330 }, 'onValidationError');
  await chain(api, 'validationErrorStart', 'markValidation', 'validationHandled');
  await api.createShape({ type: 'subProcess', id: 'onAnyError', name: 'Handle any other error', triggeredByEvent: true, at: { x: 420, y: 540 }, size: { width: 440, height: 160 } });
  await api.createShape({ type: 'startEvent', id: 'anyErrorStart', name: 'Any error', eventDefinition: 'error', parent: 'onAnyError', at: { x: 260, y: 540 } });
  await expressionTask(api, 'markOther', 'Mark other failure', "${execution.setVariable('handledBy', 'other')}", { x: 420, y: 540 }, 'onAnyError');
  await endEvent(api, 'otherHandled', 'Other handled', { x: 580, y: 540 }, 'onAnyError');
  await chain(api, 'anyErrorStart', 'markOther', 'otherHandled');

  // --- map-exception-call-activity ------------------------------------------------------------------------------------
  await newProcess(api, 'map-exception-call-activity', 'mapExceptionCallActivity', 'Errors crossing a call activity',
    'The called process riskyChild fails in one of three ways. A Java exception of an activiti:class task in the child that the child does not map is mapped by the mapException of the call activity (any RuntimeException, children included) to CHILD_FAILED. A BpmnError thrown in the child and an error end event of the child travel up to the error boundary events of the call activity. The child instance is deleted when the error is caught.',
    [{ id: 'childFailedError', name: 'Child failed', errorCode: 'CHILD_FAILED' }, { id: 'childBpmnError', name: 'Child BPMN error', errorCode: 'CHILD_BPMN_ERROR' }, { id: 'childErrorEndError', name: 'Child error end', errorCode: 'CHILD_ERROR_END' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'callActivity', id: 'callChild', name: 'Call risky child', at: at(1, 1) });
  await api.setProperty('callChild', 'call.calledElement', 'riskyChild');
  await api.setProperty('callChild', 'call.in', [
    { source: 'errorCode', target: 'errorCode' },
    { source: 'exceptionClass', target: 'exceptionClass' },
    { source: 'endWithError', target: 'endWithError' },
  ]);
  await api.setProperty('callChild', 'errors.mapExceptions', [{ errorCode: 'CHILD_FAILED', exceptionClass: 'java.lang.RuntimeException', includeChildExceptions: true }]);
  await endEvent(api, 'childOk', 'Child ok', at(2, 0));
  const childEnds: Array<[string, string, string, string, number]> = [
    ['onChildFailed', 'Child failed', 'CHILD_FAILED', 'childFailedEnd', 1],
    ['onChildBpmnError', 'Child BPMN error', 'CHILD_BPMN_ERROR', 'childBpmnErrorEnd', 2],
    ['onChildErrorEnd', 'Child error end', 'CHILD_ERROR_END', 'childErrorEndEnd', 3],
  ];
  for (const [boundary, name, code, end, row] of childEnds) {
    await errorBoundary(api, boundary, name, 'callChild', code);
    await endEvent(api, end, name, at(3, row));
    await chain(api, boundary, end);
  }
  await chain(api, 'start', 'callChild', 'childOk');

  // --- map-exception-class --------------------------------------------------------------------------------------------
  await newProcess(api, 'map-exception-class', 'mapExceptionClass', 'Exception mapping on a class delegate',
    'mapException on an activiti:class service task turns a Java exception into a BPMN error. The first matching entry in document order wins: IllegalStateException matches only that exact class (includeChildExceptions false), IllegalArgumentException also its subclasses (true), and the entry without an exception class is the default for everything else.',
    [{ id: 'illegalStateError', name: 'Illegal state', errorCode: 'ILLEGAL_STATE' }, { id: 'badArgumentError', name: 'Bad argument', errorCode: 'BAD_ARGUMENT' }, { id: 'unexpectedError', name: 'Unexpected failure', errorCode: 'UNEXPECTED' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await failureTask(api, 'callPartner', 'Call partner', ['exceptionClass'], at(1, 1));
  await api.setProperty('callPartner', 'errors.mapExceptions', [
    { errorCode: 'ILLEGAL_STATE', exceptionClass: 'java.lang.IllegalStateException' },
    { errorCode: 'BAD_ARGUMENT', exceptionClass: 'java.lang.IllegalArgumentException', includeChildExceptions: true },
    { errorCode: 'UNEXPECTED', exceptionClass: '' },
  ]);
  await endEvent(api, 'partnerOk', 'Partner ok', at(2, 0));
  const mapped: Array<[string, string, string, string, number]> = [
    ['onIllegalState', 'Illegal state', 'ILLEGAL_STATE', 'illegalState', 1],
    ['onBadArgument', 'Bad argument', 'BAD_ARGUMENT', 'badArgument', 2],
    ['onUnexpected', 'Unexpected', 'UNEXPECTED', 'unexpected', 3],
  ];
  for (const [boundary, name, code, end, row] of mapped) {
    await errorBoundary(api, boundary, name, 'callPartner', code);
    await endEvent(api, end, name, at(3, row));
    await chain(api, boundary, end);
  }
  await chain(api, 'start', 'callPartner', 'partnerOk');

  // --- map-exception-delegate-expression ------------------------------------------------------------------------------
  await newProcess(api, 'map-exception-delegate-expression', 'mapExceptionDelegateExpression', 'Exception mapping on a delegate expression (not wired)',
    'Negative case: the mapException entry sits on a delegateExpression service task, where the engine does not wire it (only activiti:class delegates and call activities map exceptions). A Java exception is not turned into a BPMN error and rolls the call back, whereas a BpmnError thrown by the same bean is caught by the boundary event.',
    [{ id: 'beanStateError', name: 'Illegal state', errorCode: 'BEAN_ILLEGAL_STATE' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'serviceTask', id: 'callBean', name: 'Call bean', at: at(1, 0) });
  await api.setProperty('callBean', 'impl.type', 'delegateExpression');
  await api.setProperty('callBean', 'impl.delegateExpression', '${failureDelegate}');
  await api.setProperty('callBean', 'fields.list', failureFields('errorCode', 'exceptionClass'));
  // the panel offers the mapping for class delegates and call activities only (lint L32); the file keeps it on purpose because the engine ignores it here
  await api.addExtensionElement('callBean', 'activiti:MapException', { errorCode: 'BEAN_ILLEGAL_STATE', body: 'java.lang.IllegalStateException' });
  await endEvent(api, 'beanOk', 'Bean ok', at(2, 0));
  await errorBoundary(api, 'onBeanState', 'Illegal state', 'callBean', 'BEAN_ILLEGAL_STATE');
  await endEvent(api, 'beanHandled', 'Handled', at(2, 1));
  await chain(api, 'start', 'callBean', 'beanOk');
  await chain(api, 'onBeanState', 'beanHandled');

  // --- map-exception-unmatched ----------------------------------------------------------------------------------------
  await newProcess(api, 'map-exception-unmatched', 'mapExceptionUnmatched', 'Exception mapping without a default',
    'A single mapException entry for the exact class IllegalStateException and no default entry. An exception that no entry matches is not mapped: it propagates out of the service task and rolls the whole call back.',
    [{ id: 'strictStateError', name: 'Illegal state', errorCode: 'STRICT_ILLEGAL_STATE' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await failureTask(api, 'strictCall', 'Call partner', ['exceptionClass'], at(1, 0));
  await api.setProperty('strictCall', 'errors.mapExceptions', [{ errorCode: 'STRICT_ILLEGAL_STATE', exceptionClass: 'java.lang.IllegalStateException' }]);
  await endEvent(api, 'strictOk', 'Partner ok', at(2, 0));
  await errorBoundary(api, 'onStrictState', 'Illegal state', 'strictCall', 'STRICT_ILLEGAL_STATE');
  await endEvent(api, 'strictHandled', 'Handled', at(2, 1));
  await chain(api, 'start', 'strictCall', 'strictOk');
  await chain(api, 'onStrictState', 'strictHandled');

  // --- risky-child ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'risky-child', 'riskyChild', 'Risky child process',
    'Called by mapExceptionCallActivity. The task raises the BpmnError errorCode or the Java exception exceptionClass when asked to (no exceptions are mapped here); a surviving instance ends with an error end event when endWithError is true.',
    [{ id: 'childErrorEndError', name: 'Child error end', errorCode: 'CHILD_ERROR_END' }]);
  await api.createShape({ type: 'startEvent', id: 'cStart', at: at(0, 1) });
  await failureTask(api, 'risky', 'Risky step', ['errorCode', 'exceptionClass'], at(1, 1));
  await api.createShape({ type: 'exclusiveGateway', id: 'finishWithError', name: 'End with an error?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'childErrorEnd', name: 'Child error end', eventDefinition: 'error', at: at(3, 0) });
  await api.setProperty('childErrorEnd', 'error.ref', 'CHILD_ERROR_END');
  await endEvent(api, 'childDone', 'Child done', at(3, 2));
  await chain(api, 'cStart', 'risky', 'finishWithError');
  await condition(api, 'finishWithError', 'childErrorEnd', 'yes', '${endWithError == true}');
  await api.connect('finishWithError', 'childDone', 'f_finishWithError_childDone', { name: 'no' });
  await api.setProperty('f_finishWithError_childDone', 'flow.default', true);

  // --- script-error ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'script-error', 'scriptError', 'Script task throws a BPMN error',
    'A JavaScript script task throws a BpmnError for a negative amount; the error boundary event (errorRef points at the definitions-level error whose errorCode is INVALID_AMOUNT) routes the process to the rejection branch.',
    [{ id: 'invalidAmountError', name: 'Invalid amount', errorCode: 'INVALID_AMOUNT' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'scriptTask', id: 'checkAmount', name: 'Check amount', at: at(1, 0) });
  await api.setProperty('checkAmount', 'script.format', 'javascript');
  await api.setProperty('checkAmount', 'script.text', "if (amount < 0) {\n  throw new (Java.type('org.activiti.engine.delegate.BpmnError'))('INVALID_AMOUNT', 'negative amount ' + amount);\n}\nexecution.setVariable('status', 'accepted');");
  await endEvent(api, 'accepted', 'Accepted', at(2, 0));
  await errorBoundary(api, 'onInvalidAmount', 'Invalid amount', 'checkAmount', 'INVALID_AMOUNT');
  await expressionTask(api, 'rejectAmount', 'Reject amount', "${execution.setVariable('status', 'rejected')}", at(2, 2));
  await endEvent(api, 'rejected', 'Rejected', at(3, 2));
  await chain(api, 'start', 'checkAmount', 'accepted');
  await chain(api, 'onInvalidAmount', 'rejectAmount', 'rejected');

  // --- sub-process-error ----------------------------------------------------------------------------------------------
  await newProcess(api, 'sub-process-error', 'subProcessError', 'Error end event in a sub process',
    "An error end event inside an embedded sub process throws OUT_OF_STOCK; the error boundary event on the sub process catches it, the sub process is cancelled and the process continues on the boundary event's flow instead of the normal one.",
    [{ id: 'stockError', name: 'Out of stock', errorCode: 'OUT_OF_STOCK' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: { x: 120, y: 220 } });
  await api.createShape({ type: 'subProcess', id: 'fulfilment', name: 'Fulfil order', at: { x: 500, y: 220 }, size: { width: 520, height: 280 } });
  await api.createShape({ type: 'startEvent', id: 'fStart', parent: 'fulfilment', at: { x: 290, y: 220 } });
  await api.createShape({ type: 'exclusiveGateway', id: 'stockGate', name: 'In stock?', parent: 'fulfilment', at: { x: 380, y: 220 } });
  await expressionTask(api, 'pack', 'Pack items', "${execution.setVariable('packed', true)}", { x: 500, y: 160 }, 'fulfilment');
  await endEvent(api, 'packed', 'Packed', { x: 630, y: 160 }, 'fulfilment');
  await api.createShape({ type: 'endEvent', id: 'outOfStock', name: 'Out of stock', eventDefinition: 'error', parent: 'fulfilment', at: { x: 630, y: 300 } });
  await api.setProperty('outOfStock', 'error.ref', 'OUT_OF_STOCK');
  await chain(api, 'fStart', 'stockGate');
  await condition(api, 'stockGate', 'pack', 'yes', '${inStock == true}');
  await api.connect('stockGate', 'outOfStock', 'f_stockGate_outOfStock', { name: 'no' });
  await api.setProperty('f_stockGate_outOfStock', 'flow.default', true);
  await chain(api, 'pack', 'packed');
  await expressionTask(api, 'ship', 'Ship', "${execution.setVariable('status', 'shipped')}", { x: 820, y: 140 });
  await endEvent(api, 'shipped', 'Shipped', { x: 960, y: 140 });
  await errorBoundary(api, 'onStockError', 'Out of stock', 'fulfilment', 'OUT_OF_STOCK');
  await expressionTask(api, 'backorder', 'Create back order', "${execution.setVariable('status', 'backordered')}", { x: 820, y: 420 });
  await endEvent(api, 'backordered', 'Back ordered', { x: 960, y: 420 });
  await api.connect('start', 'fulfilment', 'f_start_fulfilment');
  await api.connect('fulfilment', 'ship', 'f_fulfilment_ship');
  await chain(api, 'ship', 'shipped');
  await chain(api, 'onStockError', 'backorder', 'backordered');

  // --- uncaught-error -------------------------------------------------------------------------------------------------
  await newProcess(api, 'uncaught-error', 'uncaughtError', 'BPMN error without a catcher',
    'Only PAYMENT_DECLINED is caught. Any other BpmnError finds no catching event: the engine rethrows it as a BpmnError ("No catching boundary event found") and the whole call is rolled back.',
    [{ id: 'paymentDeclinedError', name: 'Payment declined', errorCode: 'PAYMENT_DECLINED' }]);
  await api.createShape({ type: 'startEvent', id: 'uStart', at: at(0, 0) });
  await failureTask(api, 'uCharge', 'Charge card', ['errorCode'], at(1, 0));
  await endEvent(api, 'uCharged', 'Charged', at(2, 0));
  await errorBoundary(api, 'uOnDeclined', 'Payment declined', 'uCharge', 'PAYMENT_DECLINED');
  await endEvent(api, 'uDeclined', 'Declined', at(2, 1));
  await chain(api, 'uStart', 'uCharge', 'uCharged');
  await chain(api, 'uOnDeclined', 'uDeclined');
}

export const semanticDiff = {
  allow: [
    { pattern: /compensateEventDefinition\/@waitForCompletion: expected "true", generated no attribute/, reason: 'waitForCompletion="true" is the BPMN default; the modeler does not write an attribute that holds the default' },
  ],
};

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C08-errors-compensation`. */
export const uiDriven = true;
