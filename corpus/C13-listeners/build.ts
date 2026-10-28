import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C13 listeners, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`;
 * the runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this
 * folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C13';
const S = 'io.github.kleash.activiti.harness.support.';
const RECORDING_EXECUTION = `${S}RecordingExecutionListener`;
const RECORDING_TASK = `${S}RecordingTaskListener`;
const FIELD_EXECUTION = `${S}FieldExecutionListener`;
const FIELD_TASK = `${S}FieldTaskListener`;

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

const expressionTask = async (api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }): Promise<void> => {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
};

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C13-listeners', { defaultMappings: 'none' });

  // --- error-event-listener -----------------------------------------------------------------------------------------------
  await newProcess(api, 'error-event-listener', 'errorEventListener', 'Event listener that throws an error',
    "An event listener with throwEvent=\"error\" propagates the BPMN error GUARD from the execution of the event that fired it. Here every created task raises it, so the guarded task is replaced by the error boundary event's flow.");
  await api.setProperty('errorEventListener', 'definitions.errors', [{ id: 'guardError', name: 'Guard error', errorCode: 'GUARD' }]);
  await api.setProperty('errorEventListener', 'listeners.event', [{ events: 'TASK_CREATED', entityType: 'task', throwEvent: 'error', errorCode: 'GUARD' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'guarded', name: 'Guarded task', at: at(1, 1) });
  await api.setProperty('guarded', 'user.assignee', 'ann');
  await api.createShape({ type: 'boundaryEvent', id: 'onGuard', name: 'Guard error', eventDefinition: 'error', attachedTo: 'guarded' });
  await api.setProperty('onGuard', 'error.ref', 'GUARD');
  await api.createShape({ type: 'endEvent', id: 'guardFailed', name: 'Guard failed', at: at(2, 3) });
  await chain(api, 'start', 'guarded');
  await chain(api, 'onGuard', 'guardFailed');

  // --- event-listeners ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'event-listeners', 'eventListeners', 'Process event listeners',
    'Engine event listeners of the process: a class and a delegate expression that record the events they are registered for (events and entityType filter them), and three listeners that throw a process-instance signal, a global signal and a message when a task completes. Completing the task trigger wakes the three catch events.');
  await api.setProperty('eventListeners', 'definitions.signals', [{ id: 'taskDoneSignal', name: 'taskDone' }, { id: 'taskDoneGlobalSignal', name: 'taskDoneGlobal' }]);
  await api.setProperty('eventListeners', 'definitions.messages', [{ id: 'taskDoneMsg', name: 'taskDoneMessage' }]);
  await api.setProperty('eventListeners', 'listeners.event', [
    { events: 'PROCESS_STARTED,PROCESS_COMPLETED', class: `${S}RecordingEventListener` },
    { events: 'TASK_CREATED,TASK_COMPLETED', entityType: 'task', delegateExpression: '${recordingEventListener}' },
    { events: 'TASK_COMPLETED', entityType: 'task', throwEvent: 'signal', signalName: 'taskDone' },
    { events: 'TASK_COMPLETED', entityType: 'task', throwEvent: 'globalSignal', signalName: 'taskDoneGlobal' },
    { events: 'TASK_COMPLETED', entityType: 'task', throwEvent: 'message', messageName: 'taskDoneMessage' },
  ]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1.5) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', at: at(1, 1.5) });
  await api.connect('start', 'fork', 'f_start_fork');
  const catches: Array<[string, string, 'signal' | 'message', string, string, string, string]> = [
    ['waitSignal', 'Process signal', 'signal', 'taskDone', 'signalSeen', 'Signal seen', 'f_fork_waitSignal'],
    ['waitGlobal', 'Global signal', 'signal', 'taskDoneGlobal', 'globalSeen', 'Global signal seen', 'f_fork_waitGlobal'],
    ['waitMessage', 'Message', 'message', 'taskDoneMessage', 'messageSeen', 'Message seen', 'f_fork_waitMessage'],
  ];
  for (const [row, [id, name, kind, ref, endId, endName]] of catches.entries()) {
    await api.createShape({ type: 'intermediateCatchEvent', id, name, eventDefinition: kind, at: at(2, row) });
    await api.setProperty(id, `${kind}.ref`, ref);
    await api.createShape({ type: 'endEvent', id: endId, name: endName, at: at(3, row) });
    await api.connect('fork', id, `f_fork_${id}`);
    await api.connect(id, endId, `f_${id}_${endId}`);
  }
  await api.createShape({ type: 'userTask', id: 'trigger', name: 'Trigger', at: at(2, 3) });
  await api.setProperty('trigger', 'user.candidateUsers', 'ann');
  await api.createShape({ type: 'endEvent', id: 'triggered', name: 'Triggered', at: at(3, 3) });
  await api.connect('fork', 'trigger', 'f_fork_trigger');
  await api.connect('trigger', 'triggered', 'f_trigger_triggered');

  // --- execution-listeners ------------------------------------------------------------------------------------------------
  await newProcess(api, 'execution-listeners', 'executionListeners', 'Execution listeners',
    'Execution listeners of all three implementation types (class, expression, delegateExpression) on the process (start, end), on flow nodes (start, end) and on sequence flows (take), with fields. The recording listeners append "event:element id" to executionListenerCalls, so the list is the order in which the engine called them. The process end listeners run after the process instance execution has been deleted and so cannot write variables (the completion would fail); the guard listeners therefore only throw when the business key asks them to (fail-class, fail-delegateExpression, fail-expression), which makes their call observable. The end listener of the exclusive gateway decide is declared on purpose and is never called: the gateway leaves through the sequence flow without the usual end-of-node processing. An expression listener records through ${listenerRecorder.recordExecution(execution)}.');
  await api.setProperty('executionListeners', 'listeners.execution', [
    { event: 'start', class: RECORDING_EXECUTION },
    { event: 'start', class: FIELD_EXECUTION, fields: [{ name: 'tag', string: 'process' }] },
    { event: 'end', class: `${S}EndGuardListener`, fields: [{ name: 'type', string: 'class' }] },
    { event: 'end', delegateExpression: '${endGuard}', fields: [{ name: 'type', string: 'delegateExpression' }] },
    { event: 'end', expression: "${endGuard.check(execution, 'expression')}" },
  ]);
  await api.createShape({ type: 'startEvent', id: 'begin', name: 'Begin', at: at(0, 1) });
  await api.setProperty('begin', 'listeners.execution', [{ event: 'end', class: RECORDING_EXECUTION }]);
  await expressionTask(api, 'prepare', 'Prepare', "${execution.setVariable('prepared', true)}", at(1, 1));
  await api.setProperty('prepare', 'listeners.execution', [
    { event: 'start', delegateExpression: '${recordingExecutionListener}' },
    { event: 'start', expression: "${execution.setVariable('prepareStartedByExpression', true)}" },
    { event: 'end', class: RECORDING_EXECUTION },
    { event: 'end', class: FIELD_EXECUTION, fields: [{ name: 'tag', string: 'prepare-end' }] },
  ]);
  await api.createShape({ type: 'exclusiveGateway', id: 'decide', name: 'Needs review?', at: at(2, 1) });
  await api.setProperty('decide', 'listeners.execution', [
    { event: 'start', class: RECORDING_EXECUTION },
    { event: 'end', delegateExpression: '${recordingExecutionListener}' },
  ]);
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review', at: at(3, 0) });
  await api.setProperty('review', 'user.assignee', 'ann');
  await api.setProperty('review', 'listeners.execution', [
    { event: 'start', class: RECORDING_EXECUTION },
    { event: 'start', delegateExpression: '${fieldExecutionListener}', fields: [{ name: 'tag', string: 'review-start' }] },
    { event: 'end', class: RECORDING_EXECUTION },
  ]);
  await expressionTask(api, 'finish', 'Finish', "${execution.setVariable('finished', true)}", at(4, 1));
  await api.setProperty('finish', 'listeners.execution', [{ event: 'start', class: RECORDING_EXECUTION }]);
  await api.createShape({ type: 'endEvent', id: 'done', name: 'Done', at: at(5, 1) });
  await api.setProperty('done', 'listeners.execution', [{ event: 'start', class: RECORDING_EXECUTION }]);
  await api.connect('begin', 'prepare', 'f_begin_prepare');
  await api.setProperty('f_begin_prepare', 'listeners.execution', [{ event: 'take', expression: '${listenerRecorder.recordExecution(execution)}' }]);
  await api.connect('prepare', 'decide', 'f_prepare_decide');
  await api.setProperty('f_prepare_decide', 'listeners.execution', [{ event: 'take', class: RECORDING_EXECUTION }]);
  await api.connect('decide', 'review', 'f_decide_review', { name: 'yes' });
  await api.setProperty('f_decide_review', 'flow.condition', '${needsReview == true}');
  await api.setProperty('f_decide_review', 'listeners.execution', [{ event: 'take', delegateExpression: '${recordingExecutionListener}' }]);
  await api.connect('decide', 'finish', 'f_decide_finish', { name: 'no' });
  await api.setProperty('f_decide_finish', 'flow.default', true);
  await api.setProperty('f_decide_finish', 'listeners.execution', [{ event: 'take', class: FIELD_EXECUTION, fields: [{ name: 'tag', expression: '${reviewer}' }] }]);
  await api.connect('review', 'finish', 'f_review_finish');
  await api.setProperty('f_review_finish', 'listeners.execution', [{ event: 'take', expression: '${listenerRecorder.recordExecution(execution)}' }]);
  await api.connect('finish', 'done', 'f_finish_done');

  // --- task-listeners -----------------------------------------------------------------------------------------------------
  await newProcess(api, 'task-listeners', 'taskListeners', 'Task listeners and task cancellation',
    'Task listeners for every event (create, assignment, complete, delete, all) in all three implementation types, with a field. approve is claimed and completed: assignment follows create, and delete follows complete. cancellable is left by an interrupting timer boundary event instead of being completed: the delete listener runs when the task is cancelled.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'approve', name: 'Approve', at: at(1, 1) });
  await api.setProperty('approve', 'user.candidateUsers', 'ann');
  await api.setProperty('approve', 'listeners.task', [
    { event: 'create', class: RECORDING_TASK },
    { event: 'assignment', delegateExpression: '${recordingTaskListener}' },
    { event: 'complete', expression: '${listenerRecorder.recordTask(task)}' },
    { event: 'delete', class: RECORDING_TASK },
    { event: 'all', class: FIELD_TASK, fields: [{ name: 'tag', string: 'all' }] },
  ]);
  await api.createShape({ type: 'userTask', id: 'cancellable', name: 'Cancellable', at: at(2, 1) });
  await api.setProperty('cancellable', 'user.candidateUsers', 'ann');
  await api.setProperty('cancellable', 'listeners.task', [
    { event: 'create', class: RECORDING_TASK },
    { event: 'complete', delegateExpression: '${recordingTaskListener}' },
    { event: 'delete', class: RECORDING_TASK },
  ]);
  await api.createShape({ type: 'endEvent', id: 'done', name: 'Done', at: at(3, 1) });
  await api.createShape({ type: 'boundaryEvent', id: 'giveUp', name: 'Give up', eventDefinition: 'timer', attachedTo: 'cancellable' });
  await api.setProperty('giveUp', 'timer.definition', { type: 'duration', value: 'PT1H' });
  await api.createShape({ type: 'endEvent', id: 'abandoned', name: 'Abandoned', at: at(3, 3) });
  await chain(api, 'start', 'approve', 'cancellable', 'done');
  await chain(api, 'giveUp', 'abandoned');

  // --- transaction-listeners ----------------------------------------------------------------------------------------------
  await newProcess(api, 'transaction-listeners', 'transactionListeners', 'Transaction-dependent listeners',
    'Execution and task listeners with onTransaction (before-commit, committed, rolled-back; delegateExpression only) and the three customPropertiesResolver forms (class, expression, delegateExpression). They record into the transactionLog bean; the task hold waits and capture copies the log into transactionCalls. Completing trigger runs the task listeners and, through explode, the execution listeners in one transaction: when explode passes that transaction commits, when it throws it rolls back.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', at: at(1, 1) });
  await api.createShape({ type: 'userTask', id: 'hold', name: 'Hold', at: at(2, 0) });
  await api.setProperty('hold', 'user.candidateUsers', 'ann');
  await expressionTask(api, 'capture', 'Capture the log', '${transactionLog.entries(execution.processInstanceId)}', at(3, 0));
  await api.setProperty('capture', 'impl.resultVariable', 'transactionCalls');
  await api.createShape({ type: 'endEvent', id: 'heldDone', name: 'Hold done', at: at(4, 0) });
  await api.createShape({ type: 'userTask', id: 'trigger', name: 'Trigger', at: at(2, 2) });
  await api.setProperty('trigger', 'user.candidateUsers', 'ann');
  await api.setProperty('trigger', 'listeners.task', [
    { event: 'complete', onTransaction: 'before-commit', delegateExpression: '${beforeCommitTaskListener}', customPropertiesResolverClass: `${S}CorpusPropertiesResolver` },
    { event: 'complete', onTransaction: 'committed', delegateExpression: '${committedTaskListener}', customPropertiesResolverExpression: "${propertiesFactory.resolved('expression', execution)}" },
    { event: 'complete', onTransaction: 'rolled-back', delegateExpression: '${rolledBackTaskListener}', customPropertiesResolverDelegateExpression: '${delegatePropertiesResolver}' },
  ]);
  await api.createShape({ type: 'serviceTask', id: 'explode', name: 'Explode on request', at: at(3, 2) });
  await api.setProperty('explode', 'impl.type', 'class');
  await api.setProperty('explode', 'impl.class', `${S}FailureDelegate`);
  await api.setProperty('explode', 'fields.list', [{ name: 'exceptionClass', expression: "${execution.getVariable('failureClass')}" }]);
  await api.setProperty('explode', 'listeners.execution', [
    { event: 'start', onTransaction: 'before-commit', delegateExpression: '${beforeCommitExecutionListener}', customPropertiesResolverExpression: "${propertiesFactory.resolved('expression', execution)}" },
    { event: 'start', onTransaction: 'committed', delegateExpression: '${committedExecutionListener}', customPropertiesResolverDelegateExpression: '${delegatePropertiesResolver}' },
    { event: 'start', onTransaction: 'rolled-back', delegateExpression: '${rolledBackExecutionListener}', customPropertiesResolverClass: `${S}CorpusPropertiesResolver` },
  ]);
  await api.createShape({ type: 'endEvent', id: 'explodeDone', name: 'Explode done', at: at(4, 2) });
  await chain(api, 'start', 'fork');
  await chain(api, 'fork', 'hold', 'capture', 'heldDone');
  await chain(api, 'fork', 'trigger', 'explode', 'explodeDone');
}
