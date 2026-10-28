import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C07 signals, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`;
 * the runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this
 * folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C07';
const INCREMENT = 'io.github.kleash.activiti.harness.support.IncrementDelegate';

type Signal = { id: string; name: string; scope?: 'global' | 'processInstance' };

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string, signals: Signal[] = []): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
  if (signals.length > 0) await api.setProperty(id, 'definitions.signals', signals);
}

/** A signal event in the row `row`; `signal` is the signal's name, `expression` names it by a JUEL expression instead. */
async function signalEvent(
  api: ModelerApi,
  spec: { type: 'intermediateCatchEvent' | 'intermediateThrowEvent' | 'startEvent' | 'boundaryEvent'; id: string; name: string; signal?: string; expression?: string; async?: boolean; attachedTo?: string; interrupting?: boolean; position?: { x: number; y: number } },
): Promise<void> {
  await api.createShape({ type: spec.type, id: spec.id, name: spec.name, eventDefinition: 'signal', ...(spec.attachedTo ? { attachedTo: spec.attachedTo } : {}), ...(spec.interrupting === false ? { interrupting: false } : {}), ...(spec.position ? { at: spec.position } : {}) });
  if (spec.signal) await api.setProperty(spec.id, 'signal.ref', spec.signal);
  if (spec.expression) await api.setProperty(spec.id, 'signal.expression', spec.expression);
  if (spec.async) await api.setProperty(spec.id, 'signal.async', true);
}

/** start -> fork -> (a, b) -> join -> end; returns nothing, the branches are created by the caller. */
async function forkJoin(api: ModelerApi): Promise<void> {
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', at: at(1, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'join', at: at(4, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await api.connect('start', 'fork', 'f_start_fork');
  await api.connect('join', 'end', 'f_join_end');
}

/** The signal-free expression processes and the child processes share the "prepare, raise" shape. */
async function child(api: ModelerApi, file: string, id: string, name: string, scope: 'global' | 'processInstance'): Promise<void> {
  await newProcess(api, file, id, name, `Sets a result variable and throws the signal childDone with scope ${scope}.`, [{ id: 'childDoneSignal', name: 'childDone', scope }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'prepare', name: 'Prepare the result', at: at(1, 1) });
  await api.setProperty('prepare', 'impl.type', 'expression');
  await api.setProperty('prepare', 'impl.expression', "${execution.setVariable('childResult', 'done')}");
  await signalEvent(api, { type: 'intermediateThrowEvent', id: 'raise', name: 'Raise childDone', signal: 'childDone', position: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'prepare', 'raise', 'end');
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C07-signals', { defaultMappings: 'none' });

  // --- signal-async -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-async', 'signalAsync', 'Asynchronous signal throw',
    'The throw event has activiti:async=true: the catch event is not triggered by the throw itself but by a job, which needs the async executor (or the runner\'s executeJobs).',
    [{ id: 'asyncPingSignal', name: 'asyncPing' }]);
  await forkJoin(api);
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitAsync', name: 'Async ping', signal: 'asyncPing', position: at(2, 0) });
  await signalEvent(api, { type: 'intermediateThrowEvent', id: 'raiseAsync', name: 'Raise async ping', signal: 'asyncPing', async: true, position: at(2, 2) });
  await chain(api, 'fork', 'waitAsync', 'join');
  await chain(api, 'fork', 'raiseAsync', 'join');

  // --- signal-boundary ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-boundary', 'signalBoundary', 'Boundary signal events',
    'A user task with an interrupting boundary signal (cancelOrder) and a non-interrupting one (orderNote) that can be received any number of times.',
    [{ id: 'cancelOrderSignal', name: 'cancelOrder' }, { id: 'orderNoteSignal', name: 'orderNote' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'work', name: 'Work on the order', at: at(1, 1) });
  await api.setProperty('work', 'user.assignee', 'ann');
  await signalEvent(api, { type: 'boundaryEvent', id: 'cancelBoundary', name: 'Cancel order', signal: 'cancelOrder', attachedTo: 'work' });
  await signalEvent(api, { type: 'boundaryEvent', id: 'noteBoundary', name: 'Order note', signal: 'orderNote', attachedTo: 'work', interrupting: false });
  await api.createShape({ type: 'endEvent', id: 'cancelledEnd', name: 'Cancelled', at: at(2, 3) });
  await api.createShape({ type: 'serviceTask', id: 'takeNote', name: 'Count the note', at: at(3, 3) });
  await api.setProperty('takeNote', 'impl.type', 'class');
  await api.setProperty('takeNote', 'impl.class', INCREMENT);
  await api.setProperty('takeNote', 'fields.list', [{ name: 'variable', string: 'notes' }]);
  await api.createShape({ type: 'endEvent', id: 'noteEnd', name: 'Note taken', at: at(4, 3) });
  await api.createShape({ type: 'endEvent', id: 'completedEnd', name: 'Completed', at: at(3, 1) });
  await chain(api, 'start', 'work');
  await chain(api, 'cancelBoundary', 'cancelledEnd');
  await chain(api, 'noteBoundary', 'takeNote', 'noteEnd');
  await api.connect('work', 'completedEnd', 'f_work_completedEnd');

  // --- signal-catch -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-catch', 'signalCatch', 'Signal catch events',
    'Two intermediate catch signals in a row. A signal that is sent before the instance waits for it is lost; a signal the instance waits for is delivered with its variables.',
    [{ id: 'approvedSignal', name: 'approved' }, { id: 'auditedSignal', name: 'audited' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitApproval', name: 'Approved', signal: 'approved', position: at(1, 1) });
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitAudit', name: 'Audited', signal: 'audited', position: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'waitApproval', 'waitAudit', 'end');

  // --- signal-child-global / signal-child-local ---------------------------------------------------------------------------
  await child(api, 'signal-child-global', 'signalChildGlobal', 'Child that throws childDone (global scope)', 'global');
  await child(api, 'signal-child-local', 'signalChildLocal', 'Child that throws childDone (processInstance scope)', 'processInstance');

  // --- signal-expression-leak ---------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-expression-leak', 'signalExpressionLeak', 'Signal catch named by an expression, then a receive task',
    'A catch event named by a signal expression keeps its event subscription after it fired. A second broadcast of the same name therefore signals the receive task the instance waits at (engine finding 29).');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitGo', name: 'Go in the region', expression: "${'go-'.concat(region)}", position: at(1, 1) });
  await api.createShape({ type: 'receiveTask', id: 'hold', name: 'Hold until triggered', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'waitGo', 'hold', 'end');

  // --- signal-expressions -------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-expressions', 'signalExpressions', 'Signal names from expressions',
    'Catch and throw both name the signal with an expression over the variable region (go-EU, go-US, ...). Expression names work only in a file that declares no signal element: the engine fails to parse any other.');
  await forkJoin(api);
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitDynamic', name: 'Go in the region', expression: "${'go-'.concat(region)}", position: at(2, 0) });
  await signalEvent(api, { type: 'intermediateThrowEvent', id: 'raiseDynamic', name: 'Raise go in the region', expression: "${'go-'.concat(region)}", position: at(2, 2) });
  await chain(api, 'fork', 'waitDynamic', 'join');
  await chain(api, 'fork', 'raiseDynamic', 'join');

  // --- signal-local-scope -------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-local-scope', 'signalLocalScope', 'Signal with processInstance scope',
    'The signal localPing has scope processInstance: a throw in the same instance reaches the catch event, a broadcast from outside (ProcessRuntime.signal) does not.',
    [{ id: 'localPingSignal', name: 'localPing', scope: 'processInstance' }]);
  await forkJoin(api);
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitLocal', name: 'Local ping', signal: 'localPing', position: at(2, 0) });
  await api.createShape({ type: 'userTask', id: 'work', name: 'Work', at: at(2, 2) });
  await api.setProperty('work', 'user.assignee', 'ann');
  await signalEvent(api, { type: 'intermediateThrowEvent', id: 'raiseLocal', name: 'Raise local ping', signal: 'localPing', position: at(3, 2) });
  await chain(api, 'fork', 'waitLocal', 'join');
  await chain(api, 'fork', 'work', 'raiseLocal', 'join');

  // --- signal-parent ------------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-parent', 'signalParent', 'Signal from a child instance',
    'The parent waits for the global signal childDone while a call activity runs the child process named by the variable childProcess; the child throws childDone.',
    [{ id: 'childDoneSignal', name: 'childDone', scope: 'global' }]);
  await forkJoin(api);
  await signalEvent(api, { type: 'intermediateCatchEvent', id: 'waitChild', name: 'Child is done', signal: 'childDone', position: at(2, 0) });
  await api.createShape({ type: 'callActivity', id: 'callChild', name: 'Run the child', at: at(2, 2) });
  await api.setProperty('callChild', 'call.calledElement', '${childProcess}');
  await chain(api, 'fork', 'waitChild', 'join');
  await chain(api, 'fork', 'callChild', 'join');

  // --- signal-start -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'signal-start', 'signalStart', 'Signal start event',
    "A broadcast signal named newOrder starts a new instance; the signal's variables become process variables as they are.",
    [{ id: 'newOrderSignal', name: 'newOrder' }]);
  await signalEvent(api, { type: 'startEvent', id: 'startOnSignal', name: 'Order signal arrives', signal: 'newOrder', position: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'register', name: 'Register the order', at: at(1, 1) });
  await api.setProperty('register', 'impl.type', 'expression');
  await api.setProperty('register', 'impl.expression', "${execution.setVariable('registered', true)}");
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'startOnSignal', 'register', 'end');
}
