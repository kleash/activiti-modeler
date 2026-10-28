import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';

/**
 * C22 Camunda 7 import. The two processes of `camunda/` are Camunda 7 models as the Camunda Modeler saves them (Camunda namespace,
 * Modeler metadata, input / output parameters, a business rule task, a call activity with `camunda:in` / `camunda:out`, a generated form,
 * listeners the engine knows and ones it does not). They are imported through the converter of the app (`window.__modelerTestApi.importCamunda`,
 * the same function as "Convert to Activiti" in the editor) and exported with the real export pipeline. It reproduces `seed/processes/*`:
 * the seed is that conversion, read through by hand (see README.md), and the hand-written scenarios run against it on Activiti 9.
 *
 * The business rule task names a decision (`orderRisk`). The DMN file is made the way every other corpus DMN is (the DMN part of the test API),
 * before the process is imported, so that the converter finds the decision in the project and maps its input and output.
 * The project keeps the default `MAP_ALL` of user tasks and catch events (ADR 0006), which the converter applies to the imported
 * user tasks without input / output parameters.
 */
async function pause(): Promise<void> {
  // the catalog of the open diagram follows the project a moment after a file is added
  await new Promise((resolve) => setTimeout(resolve, 150));
}

export default async function build(api: ModelerApi): Promise<void> {
  // Playwright loads this file as CommonJS
  const read = (name: string): Promise<string> => readFile(join(__dirname, 'camunda', name), 'utf8');

  await api.createProject('C22-camunda-import');

  // the decision the business rule task refers to
  await api.createDmn('order-risk', { id: 'Definitions_orderRisk' });
  await api.addInputData('order-risk', { id: 'InputData_quantity', name: 'quantity', typeRef: 'number', at: { x: 235, y: 322 } });
  await api.addDecisionTable('order-risk', {
    id: 'orderRisk',
    variableType: 'string',
    hitPolicy: 'UNIQUE',
    inputs: [{ label: 'Quantity', expression: 'quantity', typeRef: 'number' }],
    outputs: [{ name: 'riskClass', typeRef: 'string' }],
    rules: [
      { id: 'orderRisk_small', inputs: ['< 10'], outputs: ['"low"'] },
      { id: 'orderRisk_medium', inputs: ['[10..49]'], outputs: ['"medium"'] },
      { id: 'orderRisk_large', inputs: ['>= 50'], outputs: ['"high"'] },
    ],
    at: { x: 250, y: 140 },
  });
  await api.addRequirement('order-risk', 'InputData_quantity', 'orderRisk', 'information');
  await pause();

  // the called process first, then the process that calls it
  const label = await api.importCamunda(await read('shipping-label.bpmn'), { fileName: 'shipping-label.bpmn' });
  if (!label.converted) throw new Error('shipping-label.bpmn was not recognised as a Camunda 7 model');
  const order = await api.importCamunda(await read('order-fulfilment.bpmn'), { fileName: 'order-fulfilment.bpmn' });
  if (!order.converted) throw new Error('order-fulfilment.bpmn was not recognised as a Camunda 7 model');
  // the report is part of the product: what the engine cannot do must be said, not silently dropped
  const dropped = order.report.entries.filter((e) => e.kind === 'dropped').map((e) => `${e.elementId}|${e.item}`);
  const expected = [
    'fulfilOrder|camunda:historyTimeToLive="30"',
    'fulfilOrder|camunda:versionTag="1.4"',
    'applyDiscount|camunda:asyncAfter="true"',
    'applyDiscount|camunda:jobPriority="3"',
    'reviewOrder|camunda:followUpDate="P1D"',
  ];
  for (const item of expected) if (!dropped.includes(item)) throw new Error(`the conversion report does not name ${item}; it says: ${dropped.join(', ')}`);
}
