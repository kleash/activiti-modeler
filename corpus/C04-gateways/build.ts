import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C04 gateways, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the UI uses) and exported with the real export pipeline. It reproduces `seed/processes/*` - the same process
 * and element ids, names, conditions, listeners and extensions - with a layout of its own. The runner compares the
 * result with the seed semantically (modeler/packages/activiti-project/src/semantic-diff.ts) and the harness runs the
 * hand-written scenarios of this folder against it.
 *
 * The seed has no mapping on its user tasks beyond the ones it lists, so the project switches the default MAP_ALL of
 * new user tasks off (ADR 0006): what the scenarios observe is exactly what the seed declares.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C04';
const LISTENER = 'io.github.kleash.activiti.harness.support.RecordingExecutionListener';

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

/** A flow with a condition, a name and (optionally) the default marker; flows are created in the seed's order, which decides evaluation order. */
async function flow(api: CorpusModeler, id: string, from: string, to: string, options: { name?: string; condition?: string; default?: boolean } = {}): Promise<void> {
  await api.connect(from, to, id, options.name ? { name: options.name } : undefined);
  if (options.condition) await api.setProperty(id, 'flow.condition', options.condition);
  if (options.default) await api.setProperty(id, 'flow.default', true);
}

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C04-gateways', { defaultMappings: 'none' });

  // --- exclusive-routing ------------------------------------------------------------------------------------------------
  await newProcess(api, 'exclusive-routing', 'exclusiveRouting', 'Exclusive routing',
    'Exclusive gateway: the first matching flow in document order wins; otherwise the default flow. The skipExpression on f_route_exact is ignored because the enabling process variable is not set (see exclusiveSkip).');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 2) });
  await api.createShape({ type: 'exclusiveGateway', id: 'route', name: 'Route', at: at(1, 2) });
  await api.connect('start', 'route', 'f_start_route');
  const routes: Array<[string, string, string]> = [
    ['endVip', 'Vip', 'f_route_vip'],
    ['endSmall', 'Small', 'f_route_small'],
    ['endMedium', 'Medium', 'f_route_medium'],
    ['endExact', 'Exactly 5000', 'f_route_exact'],
    ['endDefault', 'Default', 'f_route_default'],
  ];
  for (const [index, [end, name]] of routes.entries()) await api.createShape({ type: 'endEvent', id: end, name, at: at(3, index) });
  await flow(api, 'f_route_vip', 'route', 'endVip', { name: 'vip', condition: '${vip == true}' });
  await flow(api, 'f_route_small', 'route', 'endSmall', { name: 'small', condition: '${amount < 100}' });
  await api.setProperty('f_route_small', 'listeners.execution', [{ event: 'take', class: LISTENER }]);
  await flow(api, 'f_route_medium', 'route', 'endMedium', { name: 'medium', condition: '${amount >= 100 and amount < 1000}' });
  await flow(api, 'f_route_exact', 'route', 'endExact', { name: 'exactly 5000', condition: '${amount == 5000}' });
  await api.setProperty('f_route_exact', 'skip.expression', '${forceSkip == false}');
  await flow(api, 'f_route_default', 'route', 'endDefault', { name: 'otherwise', default: true });

  // --- exclusive-skip ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'exclusive-skip', 'exclusiveSkip', 'Exclusive gateway with skipping enabled',
    'The process variable _ACTIVITI_SKIP_EXPRESSION_ENABLED is declared as a property with the default true (it cannot be a start variable: ProcessRuntime rejects names that start with an underscore). A flow whose skipExpression is true is then taken without its condition; a flow whose skipExpression is false is left out.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'route', name: 'Route', at: at(1, 1) });
  await api.connect('start', 'route', 'f_start_route');
  await api.createShape({ type: 'endEvent', id: 'endForced', name: 'Forced', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'endConditional', name: 'Conditional', at: at(3, 1) });
  await api.createShape({ type: 'endEvent', id: 'endDefault', name: 'Default', at: at(3, 2) });
  await flow(api, 'f_route_forced', 'route', 'endForced', { name: 'forced', condition: '${false}' });
  await api.setProperty('f_route_forced', 'skip.expression', '${forceSkip == true}');
  await flow(api, 'f_route_conditional', 'route', 'endConditional', { name: 'conditional', condition: '${amount > 100}' });
  await flow(api, 'f_route_default', 'route', 'endDefault', { name: 'otherwise', default: true });
  await api.setExtensions({ properties: [{ name: '_ACTIVITI_SKIP_EXPRESSION_ENABLED', type: 'boolean', value: true }] });

  // --- exclusive-strict -------------------------------------------------------------------------------------------------
  await newProcess(api, 'exclusive-strict', 'exclusiveStrict', 'Exclusive without default',
    'An exclusive gateway without a default flow fails when no condition matches; the failure rolls the task completion back.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'decide', name: 'Decide', at: at(1, 1) });
  await api.setProperty('decide', 'user.candidateUsers', 'ann');
  await api.createShape({ type: 'exclusiveGateway', id: 'gate', name: 'Decision', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'endYes', name: 'Yes', at: at(4, 0) });
  await api.createShape({ type: 'endEvent', id: 'endNo', name: 'No', at: at(4, 2) });
  await api.connect('start', 'decide', 'f_start_decide');
  await api.connect('decide', 'gate', 'f_decide_gate');
  await flow(api, 'f_gate_yes', 'gate', 'endYes', { name: 'yes', condition: "${decision == 'yes'}" });
  await flow(api, 'f_gate_no', 'gate', 'endNo', { name: 'no', condition: "${decision == 'no'}" });
  await api.setExtensions({
    properties: [{ name: 'decision', type: 'string' }],
    elementId: 'decide',
    outputs: { decision: { type: 'VARIABLE', value: 'decision' } },
  });

  // --- parallel-fork-join -----------------------------------------------------------------------------------------------
  await newProcess(api, 'parallel-fork-join', 'parallelForkJoin', 'Parallel fork and join',
    'Parallel gateway: all three branches run; the join waits for every incoming flow.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', name: 'Fork', at: at(1, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'join', name: 'Join', at: at(3, 1) });
  await api.createShape({ type: 'userTask', id: 'afterJoin', name: 'After the join', at: at(4, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await api.connect('start', 'fork', 'f_start_fork');
  for (const [row, [task, name, user]] of ([['taskA', 'Branch A', 'ann'], ['taskB', 'Branch B', 'ben'], ['taskC', 'Branch C', 'cy']] as const).entries()) {
    await api.createShape({ type: 'userTask', id: task, name, at: at(2, row) });
    await api.setProperty(task, 'user.candidateUsers', user);
    await api.connect('fork', task, `f_fork_${task}`);
  }
  for (const task of ['taskA', 'taskB', 'taskC']) await api.connect(task, 'join', `f_${task}_join`);
  await api.connect('join', 'afterJoin', 'f_join_afterJoin');
  await api.setProperty('afterJoin', 'user.candidateUsers', 'ann');
  await api.connect('afterJoin', 'end', 'f_afterJoin_end');

  // --- inclusive-routing ------------------------------------------------------------------------------------------------
  await newProcess(api, 'inclusive-routing', 'inclusiveRouting', 'Inclusive routing',
    'Inclusive gateway: every branch whose condition is true runs, the default flow runs when none is; the join waits for the branches that were started.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'inclusiveGateway', id: 'split', name: 'Split', at: at(1, 1) });
  await api.createShape({ type: 'inclusiveGateway', id: 'join', name: 'Join', at: at(3, 1) });
  await api.createShape({ type: 'userTask', id: 'afterJoin', name: 'After the join', at: at(4, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await api.createShape({ type: 'endEvent', id: 'endNone', name: 'No branch', at: at(2, 3) });
  await api.connect('start', 'split', 'f_start_split');
  const branches = [['taskA', 'Branch A', 'ann', 'a'], ['taskB', 'Branch B', 'ben', 'b'], ['taskC', 'Branch C', 'cy', 'c']] as const;
  for (const [row, [task, name, user]] of branches.entries()) {
    await api.createShape({ type: 'userTask', id: task, name, at: at(2, row) });
    await api.setProperty(task, 'user.candidateUsers', user);
  }
  for (const [task, , , variable] of branches) await flow(api, `f_split_${task}`, 'split', task, { name: variable, condition: `\${${variable} == true}` });
  await flow(api, 'f_split_none', 'split', 'endNone', { name: 'none', default: true });
  for (const [task] of branches) await api.connect(task, 'join', `f_${task}_join`);
  await api.connect('join', 'afterJoin', 'f_join_afterJoin');
  await api.setProperty('afterJoin', 'user.candidateUsers', 'ann');
  await api.connect('afterJoin', 'end', 'f_afterJoin_end');

  // --- event-based ------------------------------------------------------------------------------------------------------
  await newProcess(api, 'event-based', 'eventBased', 'Event-based gateway',
    'Event-based gateway: the first event wins, the other subscription or timer is removed.');
  await api.setProperty('eventBased', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'eventBasedGateway', id: 'race', name: 'Timer or approval', at: at(1, 1) });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'timerCatch', name: 'One hour passes', eventDefinition: 'timer', at: at(2, 0) });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'messageCatch', name: 'Approval arrives', eventDefinition: 'message', at: at(2, 2) });
  await api.createShape({ type: 'endEvent', id: 'endTimeout', name: 'Timed out', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'endApproved', name: 'Approved', at: at(3, 2) });
  await api.connect('start', 'race', 'f_start_race');
  await api.connect('race', 'timerCatch', 'f_race_timerCatch');
  await api.connect('race', 'messageCatch', 'f_race_messageCatch');
  await api.setProperty('timerCatch', 'timer.definition', { type: 'duration', value: 'PT1H' });
  await api.setProperty('messageCatch', 'message.ref', 'approveOrder');
  await api.setProperty('messageCatch', 'message.correlationKey', '${orderId}');
  await api.connect('timerCatch', 'endTimeout', 'f_timerCatch_endTimeout');
  await api.connect('messageCatch', 'endApproved', 'f_messageCatch_endApproved');
  await api.setExtensions({
    properties: [{ name: 'orderId', type: 'string' }, { name: 'approvedBy', type: 'string' }],
    elementId: 'messageCatch',
    outputs: { approvedBy: { type: 'VARIABLE', value: 'approvedBy' } },
  });
}

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C04-gateways`. */
export const uiDriven = true;
