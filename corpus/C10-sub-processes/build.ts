import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C10 sub processes, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the UI uses) and exported with the real export pipeline. It reproduces `seed/processes/*` - process and
 * element ids, names, loop characteristics, terminate definitions, data objects and extensions - with a layout of its
 * own. The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of
 * this folder against it.
 *
 * The seed lists exactly the mappings it needs, so the project switches the default MAP_ALL of new user tasks off
 * (ADR 0006). Its data objects are declarations of the container (the `data.objects` accessor): they have no shape, because
 * Activiti 9 reports the diagram shape of a data object reference as DI_INVALID_REFERENCE and the harness accepts no
 * warnings.
 */

const NAMESPACE = 'http://activiti.org/bpmn/corpus/C10';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

/** An expanded sub process big enough for `columns` shapes in a row; returns the centre of its content area for `inside`. */
async function subProcess(api: ModelerApi, id: string, name: string, centre: { x: number; y: number }, columns: number, rows = 1): Promise<(column: number, row?: number) => { x: number; y: number }> {
  const width = 90 + columns * 130;
  const height = 60 + rows * 100;
  await api.createShape({ type: 'subProcess', id, name, at: centre, size: { width, height } });
  return (column, row = 0) => ({ x: centre.x - width / 2 + 70 + column * 130, y: centre.y - height / 2 + 30 + 50 + row * 100 });
}

async function candidates(api: ModelerApi, task: string, users: string): Promise<void> {
  await api.setProperty(task, 'user.candidateUsers', users);
}

/** The shared shape of terminateScopes / terminateAllScopes: a fork, a sub process with an abort gateway and a terminate end event, an outside task, a join. */
async function terminateInSubProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string, terminateAll: boolean): Promise<void> {
  await newProcess(api, file, id, name, documentation);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', name: 'Fork', at: at(1, 1) });
  const inside = await subProcess(api, 'sub', 'Sub process', { x: 640, y: 160 }, 5, 2);
  await api.createShape({ type: 'userTask', id: 'outsideTask', name: 'Outside work', at: at(3, 3) });
  await candidates(api, 'outsideTask', 'cy');
  await api.createShape({ type: 'parallelGateway', id: 'joinMain', name: 'Join', at: at(7, 1) });
  await api.createShape({ type: 'userTask', id: 'afterJoin', name: 'After the join', at: at(8, 1) });
  await candidates(api, 'afterJoin', 'ann');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(9, 1) });

  await api.createShape({ type: 'startEvent', id: 'subStart', parent: 'sub', at: inside(0) });
  await api.createShape({ type: 'parallelGateway', id: 'subFork', parent: 'sub', at: inside(1) });
  await api.createShape({ type: 'userTask', id: 'subTask', name: 'Sub work', parent: 'sub', at: inside(2) });
  await candidates(api, 'subTask', 'ann');
  await api.createShape({ type: 'exclusiveGateway', id: 'subGate', name: 'Abort?', parent: 'sub', at: inside(3) });
  await api.createShape({ type: 'endEvent', id: 'terminateInSub', name: 'Terminate', eventDefinition: 'terminate', parent: 'sub', at: inside(4) });
  await api.createShape({ type: 'endEvent', id: 'subDone', name: 'Done', parent: 'sub', at: inside(4, 1) });
  await api.createShape({ type: 'userTask', id: 'subSide', name: 'Side work', parent: 'sub', at: inside(2, 1) });
  await candidates(api, 'subSide', 'ben');
  await api.createShape({ type: 'endEvent', id: 'subSideEnd', name: 'Side done', parent: 'sub', at: inside(3, 1) });
  if (terminateAll) await api.setProperty('terminateInSub', 'terminate.all', true);

  await api.connect('start', 'fork', 'f_start_fork');
  await api.connect('fork', 'sub', 'f_fork_sub');
  await api.connect('fork', 'outsideTask', 'f_fork_outsideTask');
  await api.connect('subStart', 'subFork', 'f_subStart_subFork');
  await api.connect('subFork', 'subTask', 'f_subFork_subTask');
  await api.connect('subFork', 'subSide', 'f_subFork_subSide');
  await api.connect('subTask', 'subGate', 'f_subTask_subGate');
  await api.connect('subGate', 'terminateInSub', 'f_subGate_terminate', { name: 'abort' });
  await api.setProperty('f_subGate_terminate', 'flow.condition', '${abort == true}');
  await api.connect('subGate', 'subDone', 'f_subGate_subDone', { name: 'continue' });
  await api.setProperty('f_subGate_subDone', 'flow.default', true);
  await api.connect('subSide', 'subSideEnd', 'f_subSide_subSideEnd');
  await api.connect('sub', 'joinMain', 'f_sub_joinMain');
  await api.connect('outsideTask', 'joinMain', 'f_outsideTask_joinMain');
  await api.connect('joinMain', 'afterJoin', 'f_joinMain_afterJoin');
  await api.connect('afterJoin', 'end', 'f_afterJoin_end');
  await api.setExtensions({
    properties: [{ name: 'abort', type: 'boolean' }],
    elementId: 'subTask',
    outputs: { abort: { type: 'VARIABLE', value: 'abort' } },
  });
}

/** The shared shape of terminateMiDefault / terminateMiRoot: a parallel multi-instance sub process whose instances can terminate. */
async function terminateInMultiInstance(api: ModelerApi, file: string, id: string, name: string, documentation: string, terminateMultiInstance: boolean): Promise<void> {
  await newProcess(api, file, id, name, documentation);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  const inside = await subProcess(api, 'batch', 'Batch', { x: 500, y: 150 }, 5, 2);
  await api.setProperty('batch', 'mi.type', 'parallel');
  await api.setProperty('batch', 'mi.collection', 'items');
  await api.setProperty('batch', 'mi.elementVariable', 'item');
  await api.createShape({ type: 'userTask', id: 'afterBatch', name: 'After the batch', at: at(5, 1) });
  await candidates(api, 'afterBatch', 'ann');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(6, 1) });

  await api.createShape({ type: 'startEvent', id: 'batchStart', parent: 'batch', at: inside(0) });
  await api.createShape({ type: 'userTask', id: 'choose', name: 'Choose ${item}', parent: 'batch', at: inside(1) });
  await candidates(api, 'choose', 'ann');
  await api.createShape({ type: 'exclusiveGateway', id: 'batchGate', name: 'Abort?', parent: 'batch', at: inside(2) });
  await api.createShape({ type: 'endEvent', id: 'terminateItem', name: 'Terminate', eventDefinition: 'terminate', parent: 'batch', at: inside(3) });
  await api.createShape({ type: 'endEvent', id: 'itemDone', name: 'Item done', parent: 'batch', at: inside(3, 1) });
  if (terminateMultiInstance) await api.setProperty('terminateItem', 'terminate.multiInstance', true);

  await api.connect('start', 'batch', 'f_start_batch');
  await api.connect('batchStart', 'choose', 'f_batchStart_choose');
  await api.connect('choose', 'batchGate', 'f_choose_batchGate');
  await api.connect('batchGate', 'terminateItem', 'f_batchGate_terminate', { name: 'abort' });
  await api.setProperty('f_batchGate_terminate', 'flow.condition', '${abort == true}');
  await api.connect('batchGate', 'itemDone', 'f_batchGate_itemDone', { name: 'continue' });
  await api.setProperty('f_batchGate_itemDone', 'flow.default', true);
  await api.connect('batch', 'afterBatch', 'f_batch_afterBatch');
  await api.connect('afterBatch', 'end', 'f_afterBatch_end');
  await api.setExtensions({
    properties: [{ name: 'abort', type: 'boolean' }],
    elementId: 'choose',
    outputs: { abort: { type: 'VARIABLE', value: 'abort' } },
  });
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C10-sub-processes', { defaultMappings: 'none' });

  // --- async-sub-process ------------------------------------------------------------------------------------------------
  await newProcess(api, 'async-sub-process', 'asyncSubProcess', 'Asynchronous sub process',
    'An asynchronous, non-exclusive sub process: entering it creates a job; its content runs when the job is executed.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  {
    const inside = await subProcess(api, 'prepare', 'Prepare', { x: 460, y: 150 }, 3);
    await api.setProperty('prepare', 'async.async', true);
    await api.setProperty('prepare', 'async.exclusive', false);
    await api.createShape({ type: 'startEvent', id: 'prepareStart', parent: 'prepare', at: inside(0) });
    await api.createShape({ type: 'userTask', id: 'inTask', name: 'Inside the async sub process', parent: 'prepare', at: inside(1) });
    await candidates(api, 'inTask', 'ann');
    await api.createShape({ type: 'endEvent', id: 'prepareEnd', parent: 'prepare', at: inside(2) });
    await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
    await api.connect('start', 'prepare', 'f_start_prepare');
    await api.connect('prepareStart', 'inTask', 'f_prepareStart_inTask');
    await api.connect('inTask', 'prepareEnd', 'f_inTask_prepareEnd');
    await api.connect('prepare', 'end', 'f_prepare_end');
  }

  // --- embedded-sub-process ---------------------------------------------------------------------------------------------
  await newProcess(api, 'embedded-sub-process', 'embeddedSubProcess', 'Embedded sub process',
    'An embedded sub process with its own start and end, and local data objects: the sub process variable subScore exists only inside it, the process variable region everywhere.');
  await api.setProperty('embeddedSubProcess', 'data.objects', [{ id: 'regionObject', name: 'region', type: 'xsd:string', value: 'EU' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  {
    const inside = await subProcess(api, 'review', 'Review', { x: 420, y: 150 }, 3);
    await api.setProperty('review', 'data.objects', [{ id: 'scoreObject', name: 'subScore', type: 'xsd:int', value: '7' }]);
    await api.createShape({ type: 'startEvent', id: 'reviewStart', parent: 'review', at: inside(0) });
    await api.createShape({ type: 'userTask', id: 'check', name: 'Check', parent: 'review', at: inside(1) });
    await candidates(api, 'check', 'ann');
    await api.createShape({ type: 'endEvent', id: 'reviewEnd', parent: 'review', at: inside(2) });
    await api.createShape({ type: 'userTask', id: 'afterReview', name: 'After the review', at: at(4, 1) });
    await candidates(api, 'afterReview', 'ann');
    await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
    await api.connect('start', 'review', 'f_start_review');
    await api.connect('reviewStart', 'check', 'f_reviewStart_check');
    await api.connect('check', 'reviewEnd', 'f_check_reviewEnd');
    await api.connect('review', 'afterReview', 'f_review_afterReview');
    await api.connect('afterReview', 'end', 'f_afterReview_end');
    await api.setExtensions({ properties: [{ name: 'verdict', type: 'string' }] });
    await api.setExtensions({
      elementId: 'check',
      inputs: { subScore: { type: 'VARIABLE', value: 'subScore' }, region: { type: 'VARIABLE', value: 'region' } },
      outputs: { verdict: { type: 'VARIABLE', value: 'verdict' } },
    });
    await api.setExtensions({
      elementId: 'afterReview',
      inputs: { subScore: { type: 'VARIABLE', value: 'subScore' }, region: { type: 'VARIABLE', value: 'region' } },
    });
  }

  // --- mi-sub-process ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-sub-process', 'miSubProcess', 'Multi-instance sub process',
    'A parallel multi-instance sub process over a collection. Each instance has the local data object verdict, set by the script task from the mapped output of the user task (an output mapping inside a sub process writes process variables, never sub process variables); the loopDataOutputRef variable verdicts collects the verdict of every finished instance, in completion order; the completion condition ends the loop early.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  {
    const inside = await subProcess(api, 'reviewEach', 'Review by ${reviewer}', { x: 520, y: 150 }, 4);
    await api.setProperty('reviewEach', 'mi.type', 'parallel');
    await api.setProperty('reviewEach', 'mi.collection', 'reviewers');
    await api.setProperty('reviewEach', 'mi.elementVariable', 'reviewer');
    await api.setProperty('reviewEach', 'mi.outputCollection', 'verdicts');
    await api.setProperty('reviewEach', 'mi.outputItem', 'verdict');
    await api.setProperty('reviewEach', 'mi.completionCondition', '${nrOfCompletedInstances >= quorum}');
    await api.setProperty('reviewEach', 'data.objects', [{ id: 'verdictObject', name: 'verdict', type: 'xsd:string', value: 'none' }]);
    await api.createShape({ type: 'startEvent', id: 'reviewStart', parent: 'reviewEach', at: inside(0) });
    await api.createShape({ type: 'userTask', id: 'rate', name: 'Rate by ${reviewer}', parent: 'reviewEach', at: inside(1) });
    await api.setProperty('rate', 'user.assignee', '${reviewer}');
    await api.createShape({ type: 'scriptTask', id: 'record', name: 'Record the verdict', parent: 'reviewEach', at: inside(2) });
    await api.setProperty('record', 'script.format', 'juel');
    await api.setProperty('record', 'script.text', "${execution.setVariable('verdict', lastVerdict)}");
    await api.createShape({ type: 'endEvent', id: 'reviewEnd', parent: 'reviewEach', at: inside(3) });
    await api.createShape({ type: 'userTask', id: 'summarize', name: 'Summarize', at: at(5, 1) });
    await candidates(api, 'summarize', 'ann');
    await api.createShape({ type: 'endEvent', id: 'end', at: at(6, 1) });
    await api.connect('start', 'reviewEach', 'f_start_reviewEach');
    await api.connect('reviewStart', 'rate', 'f_reviewStart_rate');
    await api.connect('rate', 'record', 'f_rate_record');
    await api.connect('record', 'reviewEnd', 'f_record_reviewEnd');
    await api.connect('reviewEach', 'summarize', 'f_reviewEach_summarize');
    await api.connect('summarize', 'end', 'f_summarize_end');
    await api.setExtensions({ properties: [{ name: 'quorum', type: 'integer' }, { name: 'lastVerdict', type: 'string' }] });
    await api.setExtensions({ elementId: 'rate', outputs: { lastVerdict: { type: 'VARIABLE', value: 'verdict' } } });
    await api.setExtensions({ elementId: 'summarize', inputs: { verdicts: { type: 'VARIABLE', value: 'verdicts' } } });
  }

  // --- mi-sequential ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-sequential', 'miSequential', 'Sequential multi-instance sub process',
    'A sequential multi-instance sub process with a loop cardinality: one instance after the other, the index variable round counts from 0.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  {
    const inside = await subProcess(api, 'rounds', 'Rounds', { x: 440, y: 150 }, 3);
    await api.setProperty('rounds', 'mi.type', 'sequential');
    await api.setProperty('rounds', 'mi.cardinality', '${roundCount}');
    await api.setProperty('rounds', 'mi.elementIndexVariable', 'round');
    await api.createShape({ type: 'startEvent', id: 'roundStart', parent: 'rounds', at: inside(0) });
    await api.createShape({ type: 'userTask', id: 'step', name: 'Round ${round + 1}', parent: 'rounds', at: inside(1) });
    await candidates(api, 'step', 'ann');
    await api.createShape({ type: 'endEvent', id: 'roundEnd', parent: 'rounds', at: inside(2) });
    await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
    await api.connect('start', 'rounds', 'f_start_rounds');
    await api.connect('roundStart', 'step', 'f_roundStart_step');
    await api.connect('step', 'roundEnd', 'f_step_roundEnd');
    await api.connect('rounds', 'end', 'f_rounds_end');
  }

  // --- terminate end events ---------------------------------------------------------------------------------------------
  await terminateInSubProcess(api, 'terminate-scopes', 'terminateScopes', 'Terminate end event in a sub process',
    'A default terminate end event inside an embedded sub process destroys only that sub process scope; the parent continues after the sub process.', false);
  await terminateInSubProcess(api, 'terminate-all-scopes', 'terminateAllScopes', 'Terminate all',
    'A terminate end event with terminateAll ends the whole process instance, also from inside a sub process.', true);
  await terminateInMultiInstance(api, 'terminate-mi-default', 'terminateMiDefault', 'Terminate in a multi-instance sub process',
    'A default terminate end event inside a multi-instance sub process terminates only that instance; the other instances continue.', false);
  await terminateInMultiInstance(api, 'terminate-mi-root', 'terminateMiRoot', 'Terminate the multi-instance root',
    'A terminate end event with terminateMultiInstance deletes every instance of the multi-instance sub process; the process continues after it.', true);
}
