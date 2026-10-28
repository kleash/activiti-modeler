import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C20 insurance claim, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js commands the
 * properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`.
 *
 * No mapping on a user task, a boundary event or a message start event is written by hand: `createProject` is called without
 * `defaultMappings`, so the sign-off task, the withdrawal boundary event and the start event of the event sub process get the modeler's
 * `MAP_ALL`, and the multi-instance review gets `MAP_ALL_OUTPUTS` (the modeler's default for a multi-instance user task, because `MAP_ALL`
 * wedges a parallel one: process `mapAllMultiInstance` below). The only mapping written through an accessor is the decision task's
 * (`decision.pick`, the panel's decision picker) and the explicit `MAP_ALL` of `mapAllMultiInstance`, which records what the default avoids.
 * The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C20';
const CONNECTOR = 'dmn-connector.EXECUTE_TABLE';

async function expressionTask(api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }, parent?: string): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position, ...(parent ? { parent } : {}) });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
}

async function flow(api: ModelerApi, from: string, to: string, options: { name?: string; condition?: string; default?: boolean } = {}): Promise<void> {
  const id = `f_${from}_${to}`;
  await api.connect(from, to, id, options.name ? { name: options.name } : undefined);
  if (options.condition) await api.setProperty(id, 'flow.condition', options.condition);
  if (options.default) await api.setProperty(id, 'flow.default', true);
}

async function claimTriage(api: ModelerApi): Promise<void> {
  const file = 'claim-triage';
  await api.createDmn(file, { id: 'Definitions_claimTriage' });
  await api.addInputData(file, { id: 'InputData_claimType', name: 'claimType', typeRef: 'string', at: { x: 202, y: 322 } });
  await api.addInputData(file, { id: 'InputData_claimAmount', name: 'claimAmount', typeRef: 'number', at: { x: 362, y: 322 } });
  await api.addDecisionTable(file, {
    id: 'claimTriage',
    hitPolicy: 'FIRST',
    inputs: [{ label: 'Claim type', expression: 'claimType', typeRef: 'string' }, { label: 'Claim amount', expression: 'claimAmount', typeRef: 'number' }],
    outputs: [{ name: 'severity', typeRef: 'string' }, { name: 'reviewers', typeRef: 'number' }],
    rules: [
      { id: 'claimTriage_minor', inputs: ['-', '< 1000'], outputs: ['"MINOR"', '1'] },
      { id: 'claimTriage_health', inputs: ['"HEALTH"', '-'], outputs: ['"MAJOR"', '3'] },
      { id: 'claimTriage_moderate', inputs: ['-', '< 10000'], outputs: ['"MODERATE"', '2'] },
      { id: 'claimTriage_major', inputs: ['-', '-'], outputs: ['"MAJOR"', '3'] },
    ],
    at: { x: 250, y: 140 },
  });
  await api.addRequirement(file, 'InputData_claimType', 'claimTriage', 'information');
  await api.addRequirement(file, 'InputData_claimAmount', 'claimTriage', 'information');
}

export default async function build(api: ModelerApi): Promise<void> {
  // no `defaultMappings` option: the modeler's own default (MAP_ALL on user tasks, call activities and message / signal catch events)
  await api.createProject('C20-claims');
  await claimTriage(api);

  const id = 'insuranceClaim';
  await api.newProcess(id, 'Insurance claim', { file: 'insurance-claim' });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text',
    'An insurance claim. A decision task triages the claim (claim type and amount give the severity and the number of reviewers); the claim is then assessed by that many adjusters of the adjusters group, in parallel (a multi-instance user task whose completion variable verdict is collected in verdicts). An exclusive gateway decides on the verdicts and the severity: a rejection ends the claim, a major claim needs the sign-off of a claims manager, everything else is paid. While the claim is open, a claimDocuments message starts a non-interrupting event sub process that logs the document, and a claimWithdrawn message ends the assessment through an interrupting boundary event (an interrupting message event sub process cannot interrupt an active multi-instance user task on Activiti 9.0.0, see the README). The payloads of both messages reach the process through the MAP_ALL mapping the modeler gives a message start or boundary event.');
  await api.setProperty(id, 'definitions.messages', [{ id: 'claimWithdrawnMsg', name: 'claimWithdrawn' }, { id: 'claimDocumentsMsg', name: 'claimDocuments' }]);

  await api.createShape({ type: 'startEvent', id: 'start', name: 'Claim filed', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'triage', name: 'Triage the claim', attrs: { implementation: CONNECTOR }, at: at(1, 1) });
  await api.createShape({ type: 'userTask', id: 'assessClaim', name: 'Assess the claim', at: at(2, 1) });
  await api.setProperty('assessClaim', 'user.candidateGroups', 'adjusters');
  await api.setProperty('assessClaim', 'mi.type', 'parallel');
  await api.setProperty('assessClaim', 'mi.cardinality', '${reviewers}');
  await api.setProperty('assessClaim', 'mi.outputCollection', 'verdicts');
  await api.setProperty('assessClaim', 'mi.outputItem', 'verdict');
  await api.createShape({ type: 'exclusiveGateway', id: 'outcomeGateway', name: 'Outcome', at: at(3, 1) });
  await api.createShape({ type: 'endEvent', id: 'rejectedEnd', name: 'Rejected', at: at(4, 0) });
  await api.createShape({ type: 'userTask', id: 'managerSignOff', name: 'Sign off the payout', at: at(4, 2) });
  await api.setProperty('managerSignOff', 'user.candidateGroups', 'claims-managers');
  await expressionTask(api, 'payout', 'Pay out the claim', "${execution.setVariable('paidAmount', claimAmount)}", at(5, 1));
  await api.createShape({ type: 'endEvent', id: 'paidEnd', name: 'Paid', at: at(6, 1) });
  await chain(api, 'start', 'triage', 'assessClaim', 'outcomeGateway');
  await flow(api, 'outcomeGateway', 'rejectedEnd', { name: 'rejected', condition: "${verdicts.contains('REJECT')}" });
  await flow(api, 'outcomeGateway', 'managerSignOff', { name: 'major', condition: "${severity == 'MAJOR'}" });
  await flow(api, 'outcomeGateway', 'payout', { name: 'approved', default: true });
  await chain(api, 'managerSignOff', 'payout', 'paidEnd');

  // the withdrawal: an interrupting message boundary event on the multi-instance review (an interrupting message EVENT SUB PROCESS cannot
  // interrupt an active multi-instance user task: ACT_FK_EXE_PARENT violation, see the README)
  await api.createShape({ type: 'boundaryEvent', id: 'onWithdrawal', name: 'Claim withdrawn', eventDefinition: 'message', attachedTo: 'assessClaim' });
  await api.setProperty('onWithdrawal', 'message.ref', 'claimWithdrawn');
  await api.setProperty('onWithdrawal', 'message.correlationKey', '${claimId}');
  await expressionTask(api, 'recordWithdrawal', 'Record the withdrawal', "${execution.setVariable('status', 'WITHDRAWN')}", at(3, 3));
  await api.createShape({ type: 'endEvent', id: 'withdrawnEnd', name: 'Withdrawn', at: at(4, 3) });
  await chain(api, 'onWithdrawal', 'recordWithdrawal', 'withdrawnEnd');

  // the non-interrupting event sub process of a document that arrives
  await api.createShape({ type: 'subProcess', id: 'documentsHandler', name: 'Documents received', triggeredByEvent: true, isExpanded: true, at: { x: 560, y: 760 }, size: { width: 450, height: 160 } });
  await api.createShape({ type: 'startEvent', id: 'documentStart', name: 'Document received', eventDefinition: 'message', interrupting: false, parent: 'documentsHandler', at: { x: 420, y: 760 } });
  await api.setProperty('documentStart', 'message.ref', 'claimDocuments');
  await api.setProperty('documentStart', 'message.correlationKey', '${claimId}');
  await expressionTask(api, 'logDocument', 'Log the document',
    "${execution.setVariable('documentsLogged', (execution.getVariable('documentsLogged') != null ? execution.getVariable('documentsLogged') : 0) + 1)}", { x: 560, y: 760 }, 'documentsHandler');
  await api.createShape({ type: 'endEvent', id: 'documentLoggedEnd', name: 'Document logged', parent: 'documentsHandler', at: { x: 700, y: 760 } });
  await chain(api, 'documentStart', 'logDocument', 'documentLoggedEnd');

  await api.setExtensions({
    properties: [
      { name: 'claimId', type: 'string' },
      { name: 'claimType', type: 'string' },
      { name: 'claimAmount', type: 'integer' },
      { name: 'signedOff', type: 'boolean' },
      { name: 'paidAmount', type: 'integer' },
      { name: 'status', type: 'string' },
      { name: 'withdrawalReason', type: 'string' },
      { name: 'documentName', type: 'string' },
      { name: 'documentsLogged', type: 'integer' },
    ],
  });
  // the picker wires the decision: a VARIABLE input for each input it reads, a VARIABLE output for each output (declared, typed from the table)
  await api.setProperty('triage', 'decision.pick', { decision: 'claimTriage', matchedRules: 'triageRules' });

  // --- map-all-multi-instance --------------------------------------------------------------------------------------------------------
  // MAP_ALL set explicitly on a parallel multi-instance user task: the engine behaviour that the modeler's default (MAP_ALL_OUTPUTS for a
  // multi-instance user task, see assessClaim) avoids.
  await api.newProcess('mapAllMultiInstance', 'MAP_ALL on a multi-instance user task', { file: 'map-all-multi-instance' });
  await api.setProperty('mapAllMultiInstance', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('mapAllMultiInstance', 'documentation.text',
    'This multi-instance user task has the mapping MAP_ALL, set explicitly: the modeler would give it MAP_ALL_OUTPUTS. On Activiti 9.0.0 MAP_ALL wedges the instance: it hands the loop variables of the instance execution to the task and writes them back as local variables, so the multi-instance bookkeeping never sees the instances complete and the flow never leaves the task. The same task with the modeler\'s default (assessClaim of insuranceClaim) works. Engine behaviour pinned here, not a model to copy: the scenario asserts the wedge.');
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Reviews requested', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'reviewEach', name: 'Review', at: at(1, 1) });
  await api.setProperty('reviewEach', 'user.candidateGroups', 'adjusters');
  await api.setProperty('reviewEach', 'mi.type', 'parallel');
  await api.setProperty('reviewEach', 'mi.cardinality', '2');
  await api.setProperty('reviewEach', 'mi.outputCollection', 'verdicts');
  await api.setProperty('reviewEach', 'mi.outputItem', 'verdict');
  // the modeler gave the task MAP_ALL_OUTPUTS when it became multi-instance; this is the explicit choice that wedges the instance
  await api.setProperty('reviewEach', 'mapping.type', 'MAP_ALL');
  await api.createShape({ type: 'endEvent', id: 'reviewedEnd', name: 'Reviewed', at: at(2, 1) });
  await chain(api, 'start', 'reviewEach', 'reviewedEnd');

  // --- interrupt-multi-instance ------------------------------------------------------------------------------------------------------
  // An interrupting message event sub process next to an active multi-instance user task: the engine behaviour the lint rule
  // message-event-subprocess-multi-instance warns about, pinned by the scenario.
  await api.newProcess('interruptMultiInstance', 'Interrupting event sub process and a multi-instance task', { file: 'interrupt-multi-instance' });
  await api.setProperty('interruptMultiInstance', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('interruptMultiInstance', 'documentation.text',
    'A parallel multi-instance user task and an interrupting message event sub process. While the review is open, delivering the message stopReview fails on Activiti 9.0.0 with an ACT_FK_EXE_PARENT violation (cancelling the executions of the multi-instance task) and the message is not consumed; the review goes on. A message boundary event on the same task works (onWithdrawal of insuranceClaim). Engine behaviour pinned here, not a model to copy.');
  await api.setProperty('interruptMultiInstance', 'definitions.messages', [{ id: 'stopReviewMsg', name: 'stopReview' }]);
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Reviews requested', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review', at: at(1, 1) });
  await api.setProperty('review', 'user.candidateGroups', 'adjusters');
  await api.setProperty('review', 'mi.type', 'parallel');
  await api.setProperty('review', 'mi.cardinality', '2');
  await api.createShape({ type: 'endEvent', id: 'reviewedEnd', name: 'Reviewed', at: at(2, 1) });
  await chain(api, 'start', 'review', 'reviewedEnd');
  await api.createShape({ type: 'subProcess', id: 'stopHandler', name: 'Stop the reviews', triggeredByEvent: true, isExpanded: true, at: { x: 560, y: 360 }, size: { width: 350, height: 160 } });
  await api.createShape({ type: 'startEvent', id: 'stopStart', name: 'Stop requested', eventDefinition: 'message', parent: 'stopHandler', at: { x: 440, y: 360 } });
  await api.setProperty('stopStart', 'message.ref', 'stopReview');
  await api.createShape({ type: 'endEvent', id: 'stoppedEnd', name: 'Stopped', parent: 'stopHandler', at: { x: 640, y: 360 } });
  await api.connect('stopStart', 'stoppedEnd', 'f_stopStart_stoppedEnd');
}
