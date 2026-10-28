import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C12 misc flow, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the UI uses) and exported with the real export pipeline. It reproduces `seed/processes/*` - process and
 * element ids, link event definitions with their ids, the receive, manual and abstract tasks, the implicit split - with a
 * layout of its own. The runner compares the result with the seed semantically and the harness runs the hand-written
 * scenarios of this folder against it. The seed has no extensions, so the project switches the default MAP_ALL of new
 * user tasks off (ADR 0006): the generated project has no mapping either.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C12';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C12-misc-flow', { defaultMappings: 'none' });

  // --- link-events ------------------------------------------------------------------------------------------------------
  await newProcess(api, 'link-events', 'linkEvents', 'Link events',
    'Two paths leave through link throw events and re-enter at the one link catch event with the same target; there is no sequence flow between a throw and its catch. An intermediate throw none event follows.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'route', name: 'Direct?', at: at(1, 1) });
  await api.createShape({ type: 'intermediateThrowEvent', id: 'jumpDirect', name: 'Jump to payment', eventDefinition: 'link', at: at(2, 0) });
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review', at: at(2, 2) });
  await api.setProperty('review', 'user.candidateUsers', 'ann');
  await api.createShape({ type: 'intermediateThrowEvent', id: 'jumpReview', name: 'Jump to payment', eventDefinition: 'link', at: at(3, 2) });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'payEntry', name: 'Payment', eventDefinition: 'link', at: at(4, 1) });
  await api.createShape({ type: 'intermediateThrowEvent', id: 'milestone', name: 'Payment reached', at: at(5, 1) });
  await api.createShape({ type: 'userTask', id: 'pay', name: 'Pay', at: at(6, 1) });
  await api.setProperty('pay', 'user.candidateUsers', 'ann');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(7, 1) });
  // the ids of the link event definitions are part of the seed (the throw events refer to the catch event by id)
  await api.setProperty('jumpDirect', 'event.definitionId', 'linkThrowDirect');
  await api.setProperty('jumpReview', 'event.definitionId', 'linkThrowReview');
  await api.setProperty('payEntry', 'event.definitionId', 'linkCatchPay');
  for (const event of ['jumpDirect', 'jumpReview', 'payEntry']) await api.setProperty(event, 'link.name', 'Pay');
  await api.setProperty('jumpDirect', 'link.target', 'payEntry');
  await api.setProperty('jumpReview', 'link.target', 'payEntry');
  await api.connect('start', 'route', 'f_start_route');
  await api.connect('route', 'jumpDirect', 'f_route_direct', { name: 'direct' });
  await api.setProperty('f_route_direct', 'flow.condition', '${direct == true}');
  await api.connect('route', 'review', 'f_route_review', { name: 'needs review' });
  await api.setProperty('f_route_review', 'flow.default', true);
  await api.connect('review', 'jumpReview', 'f_review_jumpReview');
  await api.connect('payEntry', 'milestone', 'f_payEntry_milestone');
  await api.connect('milestone', 'pay', 'f_milestone_pay');
  await api.connect('pay', 'end', 'f_pay_end');

  // --- receive-task -----------------------------------------------------------------------------------------------------
  await newProcess(api, 'receive-task', 'receiveTask', 'Receive task',
    'A receive task is a wait state; it is resumed by RuntimeService.trigger (ProcessRuntime has no API for it), optionally with variables.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 0) });
  await api.createShape({ type: 'receiveTask', id: 'waitPayment', name: 'Wait for the payment', at: at(1, 0) });
  await api.createShape({ type: 'userTask', id: 'afterPayment', name: 'Book the payment', at: at(2, 0) });
  await api.setProperty('afterPayment', 'user.candidateUsers', 'ann');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 0) });
  await api.connect('start', 'waitPayment', 'f_start_waitPayment');
  await api.connect('waitPayment', 'afterPayment', 'f_waitPayment_afterPayment');
  await api.connect('afterPayment', 'end', 'f_afterPayment_end');

  // --- implicit-split ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'implicit-split', 'implicitSplit', 'Implicit split',
    'Pass-through manual task and abstract task; the abstract task leaves through conditional flows without a gateway: every flow whose condition is true is taken (an implicit parallel split), the default flow of the activity only when none is.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'manualTask', id: 'prepareManual', name: 'Prepare by hand', at: at(1, 1) });
  await api.createShape({ type: 'task', id: 'classify', name: 'Classify', at: at(2, 1) });
  const branches = [['taskA', 'Branch A', 'ann', 'endA', 'A done'], ['taskB', 'Branch B', 'ben', 'endB', 'B done'], ['taskOther', 'Other branch', 'cy', 'endOther', 'Other done']] as const;
  for (const [row, [task, name, user, end, endName]] of branches.entries()) {
    await api.createShape({ type: 'userTask', id: task, name, at: at(3, row) });
    await api.setProperty(task, 'user.candidateUsers', user);
    await api.createShape({ type: 'endEvent', id: end, name: endName, at: at(4, row) });
  }
  await api.connect('start', 'prepareManual', 'f_start_prepareManual');
  await api.connect('prepareManual', 'classify', 'f_prepareManual_classify');
  await api.connect('classify', 'taskA', 'f_classify_a', { name: 'a' });
  await api.setProperty('f_classify_a', 'flow.condition', '${a == true}');
  await api.connect('classify', 'taskB', 'f_classify_b', { name: 'b' });
  await api.setProperty('f_classify_b', 'flow.condition', '${b == true}');
  await api.connect('classify', 'taskOther', 'f_classify_other', { name: 'otherwise' });
  await api.setProperty('f_classify_other', 'flow.default', true);
  for (const [task, , , end] of branches) await api.connect(task, end, `f_${task}_${end}`);
}
