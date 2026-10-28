import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C19 retries and incidents, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`: four asynchronous
 * service tasks that differ in their failed job retry cycle (Job execution group; the engine reads it for service tasks only), an
 * asynchronous user task that carries a retry cycle the engine ignores, and a process whose service tasks fail synchronously. The runner
 * compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C19';
const HARNESS = 'io.github.kleash.activiti.harness.support';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C19-retries-incidents', { defaultMappings: 'none' });

  // --- service-retries ------------------------------------------------------------------------------------------------
  await newProcess(api, 'service-retries', 'serviceRetries', 'Retry cycles of asynchronous service tasks',
    "Four asynchronous service tasks that fail on request, differing only in their activiti:failedJobRetryTimeCycle. The cycle's repeat count is the number of attempts before the job becomes a dead-letter job (R2 = 2, R5 = 5, R1 = 1); without a cycle the default of 3 retries applies. The delegate numbers its attempts in the exception message, which the dead-letter job keeps. When the task does not fail its job simply succeeds.");
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 2) });
  await api.createShape({ type: 'exclusiveGateway', id: 'pick', name: 'Which cycle?', at: at(1, 2) });
  const retries: Array<{ id: string; name: string; row: number; cycle?: string; flow: string; condition?: string }> = [
    { id: 'retryTwice', name: 'Call with R2/PT10S', row: 0, cycle: 'R2/PT10S', flow: 'R2/PT10S', condition: "${cycle == 'twice'}" },
    { id: 'retryFive', name: 'Call with R5/PT1S', row: 1, cycle: 'R5/PT1S', flow: 'R5/PT1S', condition: "${cycle == 'five'}" },
    { id: 'retryOnce', name: 'Call with R1/PT5S', row: 3, cycle: 'R1/PT5S', flow: 'R1/PT5S', condition: "${cycle == 'once'}" },
    { id: 'retryDefault', name: 'Call without a cycle', row: 4, flow: 'none' },
  ];
  for (const r of retries) {
    await api.createShape({ type: 'serviceTask', id: r.id, name: r.name, at: at(3, r.row) });
    await api.setProperty(r.id, 'impl.type', 'delegateExpression');
    await api.setProperty(r.id, 'impl.delegateExpression', '${countingFailure}');
    await api.setProperty(r.id, 'fields.list', [{ name: 'failing', expression: '${failing}' }, { name: 'message', string: 'partner down' }]);
    await api.setProperty(r.id, 'async.async', true);
    if (r.cycle) await api.setProperty(r.id, 'job.failedJobRetryTimeCycle', r.cycle);
  }
  await api.createShape({ type: 'exclusiveGateway', id: 'merge', at: at(5, 2) });
  await api.createShape({ type: 'endEvent', id: 'done', name: 'Done', at: at(6, 2) });
  await api.connect('start', 'pick', 'f_start_pick');
  for (const r of retries) {
    await api.connect('pick', r.id, `f_pick_${r.id}`, { name: r.flow });
    if (r.condition) await api.setProperty(`f_pick_${r.id}`, 'flow.condition', r.condition);
    await api.connect(r.id, 'merge', `f_${r.id}_merge`);
  }
  await api.setProperty('f_pick_retryDefault', 'flow.default', true);
  await api.connect('merge', 'done', 'f_merge_done');

  // --- async-user-task ------------------------------------------------------------------------------------------------
  await newProcess(api, 'async-user-task', 'asyncUserTask', 'Retry cycle on an asynchronous user task (ignored)',
    'An asynchronous user task whose create listener fails on request, with activiti:failedJobRetryTimeCycle R1/PT5S. The engine reads the cycle only for service tasks (JobRetryCmd), so the job of any other element keeps the default of 3 retries: the dead-letter job reports attempt 3, not attempt 1.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'userTask', id: 'asyncReview', name: 'Review', at: at(1, 0) });
  await api.setProperty('asyncReview', 'user.candidateUsers', 'ann');
  await api.setProperty('asyncReview', 'async.async', true);
  await api.setProperty('asyncReview', 'listeners.task', [
    { event: 'create', delegateExpression: '${countingFailureTaskListener}', fields: [{ name: 'failing', expression: '${failing}' }, { name: 'message', string: 'listener down' }] },
  ]);
  // the panel offers the retry cycle for service tasks only (lint L31 flags it elsewhere); this file keeps it on purpose because the engine ignores it
  await api.addExtensionElement('asyncReview', 'activiti:FailedJobRetryTimeCycle', { body: 'R1/PT5S' });
  await api.createShape({ type: 'endEvent', id: 'done', name: 'Done', at: at(2, 0) });
  await chain(api, 'start', 'asyncReview', 'done');

  // --- sync-failure ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'sync-failure', 'syncFailure', 'Synchronous failures roll back',
    'Two synchronous service tasks that fail on request (the Java exception class in the process variable startFailure / chargeFailure). A synchronous failure creates no job and no dead-letter job: it rolls back the whole call, so a failing first task makes the start fail and a failing second task leaves the user task before it open.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'serviceTask', id: 'prepare', name: 'Prepare', at: at(1, 0) });
  await api.createShape({ type: 'userTask', id: 'approve', name: 'Approve', at: at(2, 0) });
  await api.createShape({ type: 'serviceTask', id: 'charge', name: 'Charge', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 0) });
  await api.setProperty('approve', 'user.candidateUsers', 'ann');
  for (const [id, variable] of [['prepare', 'startFailure'], ['charge', 'chargeFailure']] as const) {
    await api.setProperty(id, 'impl.type', 'class');
    await api.setProperty(id, 'impl.class', `${HARNESS}.FailureDelegate`);
    await api.setProperty(id, 'fields.list', [{ name: 'exceptionClass', expression: `\${execution.getVariable('${variable}')}` }]);
  }
  await chain(api, 'start', 'prepare', 'approve', 'charge', 'end');
}
