import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C17 DMN decision requirements diagram, modelled through the real modeler and exported with the real export pipeline. It reproduces
 * `seed/processes/*`:
 *  - `loan-decision.dmn` goes through the DMN part of the test API (a dmn-js modeler with the editor's options): four input data
 *    elements, the PRIORITY decision `riskClass`, the literal expression `maxLoan`, the sink decision `loanOffer`, and the information
 *    requirements between them, drawn in the DRD (`app/src/dmnTestApi.ts`);
 *  - the three processes call the same sink decision by its three reference forms (ADR 0004): the decision id (what the modeler writes
 *    when a decision is picked), the DMN file base name and the model name.
 * The runner compares the DMN file and the processes with the seed semantically and the harness runs the hand-written scenarios.
 */
const NAMESPACE = 'http://kleash.github.io/corpus/C17';
const CONNECTOR = 'dmn-connector.EXECUTE_TABLE';

async function loanDecision(api: ModelerApi): Promise<void> {
  const file = 'loan-decision';
  await api.createDmn(file, { id: 'Definitions_loanDecision', definitionsName: 'Loan decision' });
  await api.addInputData(file, { id: 'InputData_age', name: 'age', typeRef: 'number', at: { x: 80, y: 402 } });
  await api.addInputData(file, { id: 'InputData_country', name: 'country', typeRef: 'string', at: { x: 220, y: 402 } });
  await api.addInputData(file, { id: 'InputData_income', name: 'income', typeRef: 'number', at: { x: 500, y: 402 } });
  await api.addInputData(file, { id: 'InputData_amount', name: 'amount', typeRef: 'number', at: { x: 680, y: 222 } });

  await api.addDecisionTable(file, {
    id: 'riskClass',
    variableType: 'string',
    hitPolicy: 'PRIORITY',
    inputs: [{ label: 'Age', expression: 'age', typeRef: 'number' }, { label: 'Country', expression: 'country', typeRef: 'string' }],
    outputs: [{ name: 'riskClass', typeRef: 'string', allowedValues: ['"HIGH"', '"MEDIUM"', '"LOW"'] }],
    rules: [
      { id: 'riskClass_highYoung', inputs: ['< 21', '-'], outputs: ['"HIGH"'] },
      { id: 'riskClass_mediumAbroad', inputs: ['-', 'not("DE","AT","CH")'], outputs: ['"MEDIUM"'] },
      { id: 'riskClass_lowDefault', inputs: ['-', '-'], outputs: ['"LOW"'] },
    ],
    at: { x: 150, y: 240 },
  });
  await api.addLiteralDecision(file, { id: 'maxLoan', variableType: 'number', expression: 'income * 4', expressionType: 'number', at: { x: 490, y: 240 } });
  await api.addDecisionTable(file, {
    id: 'loanOffer',
    variableType: 'string',
    hitPolicy: 'UNIQUE',
    inputs: [{ label: 'Risk class', expression: 'riskClass', typeRef: 'string' }, { label: 'Within limit', expression: 'amount <= maxLoan', typeRef: 'boolean' }],
    outputs: [{ name: 'offer', typeRef: 'string' }],
    rules: [
      { id: 'loanOffer_approve', inputs: ['"LOW","MEDIUM"', 'true'], outputs: ['"APPROVE"'] },
      { id: 'loanOffer_review', inputs: ['"HIGH"', 'true'], outputs: ['"REVIEW"'] },
      { id: 'loanOffer_declineLimit', inputs: ['-', 'false'], outputs: ['"DECLINE"'] },
    ],
    at: { x: 320, y: 80 },
  });

  // the requirements, as drawn in the DRD: connect the source to the decision that reads it
  await api.addRequirement(file, 'riskClass', 'loanOffer', 'information');
  await api.addRequirement(file, 'maxLoan', 'loanOffer', 'information');
  await api.addRequirement(file, 'InputData_amount', 'loanOffer', 'information');
  await api.addRequirement(file, 'InputData_age', 'riskClass', 'information');
  await api.addRequirement(file, 'InputData_country', 'riskClass', 'information');
  await api.addRequirement(file, 'InputData_income', 'maxLoan', 'information');
}

/** The loan application process; `reference` is how the decision task names the DMN (null: the picker's decision id). */
async function loanProcess(api: ModelerApi, id: string, name: string, reference: string | null): Promise<void> {
  await api.newProcess(id, name, { file: id });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Start', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'decideOffer', name: 'Decide loan offer', attrs: { implementation: CONNECTOR }, at: at(1, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'routeOffer', name: 'Offer?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'approvedEnd', name: 'Approved', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'reviewEnd', name: 'Manual review', at: at(3, 1) });
  await api.createShape({ type: 'endEvent', id: 'declinedEnd', name: 'Declined', at: at(3, 2) });
  await api.connect('start', 'decideOffer', 'flow_start_decideOffer');
  await api.connect('decideOffer', 'routeOffer', 'flow_decideOffer_routeOffer');
  await api.connect('routeOffer', 'approvedEnd', 'flow_routeOffer_approvedEnd');
  await api.setProperty('flow_routeOffer_approvedEnd', 'flow.condition', "${offer == 'APPROVE'}");
  await api.connect('routeOffer', 'reviewEnd', 'flow_routeOffer_reviewEnd');
  await api.setProperty('flow_routeOffer_reviewEnd', 'flow.condition', "${offer == 'REVIEW'}");
  await api.connect('routeOffer', 'declinedEnd', 'flow_routeOffer_declinedEnd');
  await api.setProperty('flow_routeOffer_declinedEnd', 'flow.default', true);
  // pick the sink decision: the task is wired to what the whole DRD reads (age, country, income, amount) and returns (offer)
  await api.setProperty('decideOffer', 'decision.pick', { decision: 'loanOffer', matched: 'matched', matchedRules: 'matchedRules' });
  if (reference !== null) await api.setProperty('decideOffer', 'decision.table', reference);
  await api.setExtensions({
    properties: [
      { name: 'age', type: 'integer' },
      { name: 'country', type: 'string' },
      { name: 'income', type: 'integer' },
      { name: 'amount', type: 'integer' },
      { name: 'offer', type: 'string' },
      { name: 'matched', type: 'boolean' },
      { name: 'matchedRules', type: 'array' },
    ],
  });
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C17-dmn-drd', { defaultMappings: 'none' });
  await loanDecision(api);
  await loanProcess(api, 'loanApplication', 'Loan application (decision id)', null);
  await loanProcess(api, 'loanApplicationByFile', 'Loan application (DMN file base name)', 'loan-decision');
  await loanProcess(api, 'loanApplicationByModelName', 'Loan application (DMN model name)', 'Loan decision');
}

export const semanticDiff = {
  allow: [] as Array<{ pattern: RegExp; reason: string }>,
};
