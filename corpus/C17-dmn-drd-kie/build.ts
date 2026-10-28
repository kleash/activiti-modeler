import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C17-kie: a business knowledge model and a boxed context (KIE only), modelled through the real modeler and exported with the real
 * export pipeline. It reproduces `seed/processes/*`:
 *  - `pricing.dmn` goes through the DMN part of the test API (a dmn-js modeler with the editor's options): two input data elements,
 *    the business knowledge model `discountRate` (a function over a literal expression, drawn and edited in the boxed expression
 *    view), the decision `finalPrice`, and the information and knowledge requirements between them. dmn-js 18 draws and
 *    round-trips a boxed context with an invocation but has no editor to author one, so the API builds the context from moddle
 *    elements and sets it through the same modeling command that the editor uses for every property (`updateModdleProperties`);
 *  - the process has one decision task that names `finalPrice`.
 * The project needs the KIE engine: `corpus/C17-dmn-drd-kie/harness.properties` (hand-written) selects it for the harness, and
 * the modeler's lint L29 reports the same constructs on the Operaton profile.
 */
const NAMESPACE = 'http://kleash.github.io/corpus/C17-kie';

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C17-dmn-drd-kie', { defaultMappings: 'none' });

  const file = 'pricing';
  await api.createDmn(file, { id: 'Definitions_pricing' });
  await api.addInputData(file, { id: 'InputData_basePrice', name: 'basePrice', typeRef: 'number', at: { x: 180, y: 262 } });
  await api.addInputData(file, { id: 'InputData_loyaltyYears', name: 'loyaltyYears', typeRef: 'number', at: { x: 360, y: 262 } });
  await api.addBusinessKnowledgeModel(file, {
    id: 'discountRate',
    parameters: [{ name: 'years', typeRef: 'number' }],
    expression: 'if years >= 5 then 0.1 else if years >= 2 then 0.05 else 0',
    expressionType: 'number',
    at: { x: 495, y: 90 },
  });
  await api.addContextDecision(file, {
    id: 'finalPrice',
    variableType: 'number',
    entries: [
      { name: 'rate', typeRef: 'number', invocation: { function: 'discountRate', bindings: [{ parameter: 'years', expression: 'loyaltyYears' }] } },
      { expression: 'basePrice * (1 - rate)' },
    ],
    at: { x: 290, y: 100 },
  });
  await api.addRequirement(file, 'InputData_basePrice', 'finalPrice', 'information');
  await api.addRequirement(file, 'InputData_loyaltyYears', 'finalPrice', 'information');
  await api.addRequirement(file, 'discountRate', 'finalPrice', 'knowledge');

  await api.newProcess('pricing', 'Pricing with a business knowledge model', { file: 'pricing' });
  await api.setProperty('pricing', 'general.targetNamespace', NAMESPACE);
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Start', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'decidePrice', name: 'Decide price', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' }, at: at(1, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', name: 'End', at: at(2, 1) });
  await api.connect('start', 'decidePrice', 'flow_start_decidePrice');
  await api.connect('decidePrice', 'end', 'flow_decidePrice_end');
  // a boxed context has no output columns: the picker maps its inputs, the result is mapped by name
  await api.setProperty('decidePrice', 'decision.pick', { decision: 'finalPrice', outputs: false, matched: 'priced' });
  await api.setProperty('decidePrice', 'mapping.outputs', { price: { type: 'VARIABLE', value: 'finalPrice' }, priced: { type: 'VARIABLE', value: '_activiti_dmn_matched_' } });
  await api.setExtensions({
    properties: [
      { name: 'basePrice', type: 'integer' },
      { name: 'loyaltyYears', type: 'integer' },
      { name: 'price', type: 'integer' },
      { name: 'priced', type: 'boolean' },
    ],
  });
}

export const semanticDiff = {
  allow: [] as Array<{ pattern: RegExp; reason: string }>,
};
