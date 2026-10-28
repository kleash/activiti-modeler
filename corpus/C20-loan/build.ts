import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C20 loan origination, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js commands the
 * properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`.
 *
 * The point of this project is the DEFAULT mappings (ADR 0006): the build never sets a mapping on a user task, a call activity or a
 * message catch event. `createProject` is called without `defaultMappings`, so every user task, the call activity and the catch event
 * get `MAP_ALL` from the modeler the moment they are created, and the scenarios then prove on the engine that completion variables,
 * call-activity outputs and message payloads reach the process. The only mapping written through an accessor is the decision task's:
 * `decision.pick` is the panel's decision picker, which wires the inputs and outputs of the chosen decision.
 *
 * The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C20';
const CONNECTOR = 'dmn-connector.EXECUTE_TABLE';

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

/** A service task that runs a JUEL expression. */
async function expressionTask(api: CorpusModeler, id: string, name: string, expression: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
}

/** A flow with a name and, optionally, a condition or the default marker. */
async function flow(api: CorpusModeler, from: string, to: string, options: { name?: string; condition?: string; default?: boolean } = {}): Promise<void> {
  const id = `f_${from}_${to}`;
  await api.connect(from, to, id, options.name ? { name: options.name } : undefined);
  if (options.condition) await api.setProperty(id, 'flow.condition', options.condition);
  if (options.default) await api.setProperty(id, 'flow.default', true);
}

async function creditPolicy(api: CorpusModeler): Promise<void> {
  const file = 'credit-policy';
  await api.createDmn(file, { id: 'Definitions_creditDecision' });
  await api.addInputData(file, { id: 'InputData_creditScore', name: 'creditScore', typeRef: 'number', at: { x: 202, y: 322 } });
  await api.addInputData(file, { id: 'InputData_amount', name: 'amount', typeRef: 'number', at: { x: 362, y: 322 } });
  await api.addDecisionTable(file, {
    id: 'creditDecision',
    inputs: [{ label: 'Credit score', expression: 'creditScore', typeRef: 'number' }, { label: 'Amount', expression: 'amount', typeRef: 'number' }],
    outputs: [{ name: 'riskClass', typeRef: 'string' }, { name: 'route', typeRef: 'string' }],
    rules: [
      { id: 'creditDecision_decline', inputs: ['< 500', '-'], outputs: ['"HIGH"', '"DECLINE"'] },
      { id: 'creditDecision_manualMedium', inputs: ['[500..700)', '-'], outputs: ['"MEDIUM"', '"MANUAL"'] },
      { id: 'creditDecision_autoLow', inputs: ['>= 700', '<= 20000'], outputs: ['"LOW"', '"AUTO"'] },
      { id: 'creditDecision_manualLarge', inputs: ['>= 700', '> 20000'], outputs: ['"LOW"', '"MANUAL"'] },
    ],
    at: { x: 250, y: 140 },
  });
  await api.addRequirement(file, 'InputData_creditScore', 'creditDecision', 'information');
  await api.addRequirement(file, 'InputData_amount', 'creditDecision', 'information');
}

export default async function build(api: CorpusModeler): Promise<void> {
  // no `defaultMappings` option: the modeler's own default (MAP_ALL on user tasks, call activities and message / signal catch events)
  await api.createProject('C20-loan');
  await creditPolicy(api);

  // --- kyc-check (the called process) ----------------------------------------------------------------------------------------------
  await newProcess(api, 'kyc-check', 'kycCheck', 'KYC check',
    'Called by loanOrigination. An analyst of the kyc-analysts group verifies the identity and enters the credit score; the outcome is stored as kycStatus. Everything the child knows at the end returns to the caller through the MAP_ALL mapping of the call activity.');
  await api.createShape({ type: 'startEvent', id: 'kycStart', name: 'KYC requested', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'verifyIdentity', name: 'Verify identity', at: at(1, 1) });
  await api.setProperty('verifyIdentity', 'user.candidateGroups', 'kyc-analysts');
  await api.createShape({ type: 'exclusiveGateway', id: 'identityGateway', name: 'Identity verified?', at: at(2, 1) });
  await expressionTask(api, 'markPassed', 'Mark as passed', "${execution.setVariable('kycStatus', 'PASSED')}", at(3, 0));
  await api.createShape({ type: 'endEvent', id: 'kycPassedEnd', name: 'KYC passed', at: at(4, 0) });
  await expressionTask(api, 'markFailed', 'Mark as failed', "${execution.setVariable('kycStatus', 'FAILED')}", at(3, 2));
  await api.createShape({ type: 'endEvent', id: 'kycFailedEnd', name: 'KYC failed', at: at(4, 2) });
  await chain(api, 'kycStart', 'verifyIdentity', 'identityGateway');
  await flow(api, 'identityGateway', 'markPassed', { name: 'yes', condition: '${idVerified}' });
  await flow(api, 'identityGateway', 'markFailed', { name: 'no', default: true });
  await chain(api, 'markPassed', 'kycPassedEnd');
  await chain(api, 'markFailed', 'kycFailedEnd');
  await api.setExtensions({
    properties: [
      { name: 'customerId', type: 'string' },
      { name: 'idVerified', type: 'boolean' },
      { name: 'creditScore', type: 'integer' },
      { name: 'kycStatus', type: 'string' },
    ],
  });

  // --- loan-origination ------------------------------------------------------------------------------------------------------------
  await newProcess(api, 'loan-origination', 'loanOrigination', 'Loan origination',
    'A personal loan application. The KYC check is a called process; its outcome and the credit score the analyst enters come back through the MAP_ALL mapping the modeler gives a call activity. A decision task evaluates the credit policy table and routes the application: decline, automatic offer, or manual underwriting by the underwriters group, escalated to the senior underwriters by a timer after 48 hours. The offer waits for the documentsReceived message, whose payload decides whether the loan is funded.');
  await api.setProperty('loanOrigination', 'definitions.messages', [{ id: 'documentsReceivedMsg', name: 'documentsReceived' }]);
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Application received', at: at(0, 1) });
  await api.createShape({ type: 'callActivity', id: 'kycCall', name: 'KYC check', at: at(1, 1) });
  await api.setProperty('kycCall', 'call.calledElement', 'kycCheck');
  await api.createShape({ type: 'exclusiveGateway', id: 'kycGateway', name: 'KYC passed?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'kycRejectedEnd', name: 'Rejected: KYC failed', at: at(2, 0) });
  await api.createShape({ type: 'serviceTask', id: 'assessRisk', name: 'Assess credit risk', attrs: { implementation: CONNECTOR }, at: at(3, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'routeGateway', name: 'Route', at: at(4, 1) });
  await api.createShape({ type: 'endEvent', id: 'declinedEnd', name: 'Declined: credit policy', at: at(4, 0) });
  await api.createShape({ type: 'userTask', id: 'underwriting', name: 'Underwrite the application', at: at(5, 2) });
  await api.setProperty('underwriting', 'user.candidateGroups', 'underwriters');
  await api.createShape({ type: 'boundaryEvent', id: 'underwritingTimeout', name: '48 hours without a decision', eventDefinition: 'timer', attachedTo: 'underwriting' });
  await api.setProperty('underwritingTimeout', 'timer.definition', { type: 'duration', value: 'PT48H' });
  await api.createShape({ type: 'userTask', id: 'seniorReview', name: 'Senior review', at: at(6, 3) });
  await api.setProperty('seniorReview', 'user.candidateGroups', 'senior-underwriters');
  await api.createShape({ type: 'exclusiveGateway', id: 'approvedGateway', name: 'Approved?', at: at(7, 2) });
  await api.createShape({ type: 'endEvent', id: 'rejectedEnd', name: 'Rejected by underwriting', at: at(7, 3) });
  await expressionTask(api, 'prepareOffer', 'Prepare the offer',
    "${execution.setVariable('offerAmount', execution.getVariable('approvedAmount') != null ? execution.getVariable('approvedAmount') : amount)}", at(8, 1));
  await api.createShape({ type: 'intermediateCatchEvent', id: 'awaitDocuments', name: 'Documents received', eventDefinition: 'message', at: at(9, 1) });
  await api.setProperty('awaitDocuments', 'message.ref', 'documentsReceived');
  await api.setProperty('awaitDocuments', 'message.correlationKey', '${applicationId}');
  await api.createShape({ type: 'exclusiveGateway', id: 'documentsGateway', name: 'Documents complete?', at: at(10, 1) });
  await expressionTask(api, 'disburse', 'Disburse the loan', "${execution.setVariable('disbursed', true)}", at(11, 1));
  await api.createShape({ type: 'endEvent', id: 'fundedEnd', name: 'Funded', at: at(12, 1) });
  await api.createShape({ type: 'endEvent', id: 'incompleteEnd', name: 'Closed: documents incomplete', at: at(11, 2) });

  await chain(api, 'start', 'kycCall', 'kycGateway');
  await flow(api, 'kycGateway', 'kycRejectedEnd', { name: 'failed', condition: "${kycStatus == 'FAILED'}" });
  await flow(api, 'kycGateway', 'assessRisk', { name: 'passed', default: true });
  await chain(api, 'assessRisk', 'routeGateway');
  await flow(api, 'routeGateway', 'declinedEnd', { name: 'decline', condition: "${route == 'DECLINE'}" });
  await flow(api, 'routeGateway', 'prepareOffer', { name: 'auto', condition: "${route == 'AUTO'}" });
  await flow(api, 'routeGateway', 'underwriting', { name: 'manual', default: true });
  await chain(api, 'underwriting', 'approvedGateway');
  await chain(api, 'underwritingTimeout', 'seniorReview', 'approvedGateway');
  await flow(api, 'approvedGateway', 'prepareOffer', { name: 'yes', condition: '${approved}' });
  await flow(api, 'approvedGateway', 'rejectedEnd', { name: 'no', default: true });
  await chain(api, 'prepareOffer', 'awaitDocuments', 'documentsGateway');
  await flow(api, 'documentsGateway', 'disburse', { name: 'yes', condition: '${documentsComplete}' });
  await flow(api, 'documentsGateway', 'incompleteEnd', { name: 'no', default: true });
  await chain(api, 'disburse', 'fundedEnd');

  await api.setExtensions({
    properties: [
      { name: 'applicationId', type: 'string' },
      { name: 'customerId', type: 'string' },
      { name: 'amount', type: 'integer' },
      { name: 'creditScore', type: 'integer' },
      { name: 'kycStatus', type: 'string' },
      { name: 'approved', type: 'boolean' },
      { name: 'approvedAmount', type: 'integer' },
      { name: 'offerAmount', type: 'integer' },
      { name: 'documentsComplete', type: 'boolean' },
      { name: 'documentCount', type: 'integer' },
      { name: 'disbursed', type: 'boolean' },
    ],
  });
  // the picker wires the decision: a VARIABLE input for each input it reads, a VARIABLE output for each output (declared, typed from the table)
  await api.setProperty('assessRisk', 'decision.pick', { decision: 'creditDecision', matchedRules: 'creditRules' });
}

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C20-loan`. */
export const uiDriven = true;
