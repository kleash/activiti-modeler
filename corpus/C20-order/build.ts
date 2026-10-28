import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C20 order fulfilment, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js commands the
 * properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`.
 *
 * The mappings of this project are not written by hand either:
 *  - the connector tasks get theirs from the connector TEMPLATES (`template.apply`: a VARIABLE input for each input of the connector
 *    action, a VARIABLE output for each output, the output targets declared with the types of the connector descriptor); the
 *    descriptors are the project's connector catalog (`seed/connectors/*.json`);
 *  - the signal catch events get no mapping from the modeler (`createProject` is called without `defaultMappings`, and a signal catch
 *    event has no default mapping: on Activiti 9.0.0 the payload of a signal reaches the process without one, engine finding 37), and the
 *    scenarios assert that both payloads arrive. The process `signalMappingIgnored` is the control for the opposite claim: a mapping that is
 *    written on a signal catch event explicitly (the only mapping this build writes by hand) is never applied.
 * The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C20';
// build files are loaded as CommonJS by the Playwright runner
const here = __dirname;

async function expressionTask(api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
}

/** A service task that the template of a connector action turns into a connector task (implementation, mapping, declared outputs). */
async function connectorTask(api: ModelerApi, id: string, name: string, template: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'template.apply', { id: template });
}

async function flow(api: ModelerApi, from: string, to: string, options: { name?: string; condition?: string; default?: boolean } = {}): Promise<void> {
  const id = `f_${from}_${to}`;
  await api.connect(from, to, id, options.name ? { name: options.name } : undefined);
  if (options.condition) await api.setProperty(id, 'flow.condition', options.condition);
  if (options.default) await api.setProperty(id, 'flow.default', true);
}

export default async function build(api: ModelerApi): Promise<void> {
  // no `defaultMappings` option: the modeler's own default
  await api.createProject('C20-order');
  for (const name of ['crm', 'inventory', 'payment', 'shipping']) await api.addConnector(name, readFileSync(join(here, 'seed', 'connectors', `${name}.json`), 'utf8'));

  const id = 'orderFulfilment';
  await api.newProcess(id, 'Order fulfilment', { file: 'order-fulfilment' });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text',
    'A web shop order. Connector tasks (applied from the connector templates, which create their mappings) look up the customer, reserve the stock and charge the card. A declined card raises the PAYMENT_DECLINED error: the error boundary event compensates the stock reservation and cancels the order. Otherwise the shipment is prepared in parallel (packing and the shipping label) and the order waits for two signals: carrierPickedUp, whose payload (the carrier) decides the notice that is sent, and orderDelivered. Neither signal catch event has a mapping: on Activiti 9.0.0 the payload of a signal reaches the process without one.');
  await api.setProperty(id, 'definitions.errors', [{ id: 'paymentDeclinedError', name: 'Payment declined', errorCode: 'PAYMENT_DECLINED' }]);
  await api.setProperty(id, 'definitions.signals', [{ id: 'carrierPickedUpSignal', name: 'carrierPickedUp' }, { id: 'orderDeliveredSignal', name: 'orderDelivered' }]);
  // what the connector inputs read
  await api.setExtensions({
    properties: [
      { name: 'orderId', type: 'string' },
      { name: 'customerId', type: 'string' },
      { name: 'sku', type: 'string' },
      { name: 'quantity', type: 'integer' },
      { name: 'amount', type: 'integer' },
      { name: 'cardToken', type: 'string' },
      { name: 'address', type: 'string' },
    ],
  });

  await api.createShape({ type: 'startEvent', id: 'start', name: 'Order received', at: at(0, 1) });
  await connectorTask(api, 'lookupCustomer', 'Look up the customer', 'crm.LOOKUP', at(1, 1));
  await connectorTask(api, 'reserveStock', 'Reserve the stock', 'inventory.RESERVE', at(2, 1));
  await api.createShape({ type: 'boundaryEvent', id: 'onReserveCompensate', name: 'Compensate the reservation', eventDefinition: 'compensate', attachedTo: 'reserveStock' });
  await expressionTask(api, 'releaseStock', 'Release the stock', "${execution.setVariable('stockReleased', true)}", at(2, 3));
  await connectorTask(api, 'chargePayment', 'Charge the card', 'payment.CHARGE', at(3, 1));
  await api.createShape({ type: 'boundaryEvent', id: 'paymentDeclined', name: 'Payment declined', eventDefinition: 'error', attachedTo: 'chargePayment' });
  await api.setProperty('paymentDeclined', 'error.ref', 'PAYMENT_DECLINED');
  await api.createShape({ type: 'intermediateThrowEvent', id: 'rollbackOrder', name: 'Roll back the order', eventDefinition: 'compensate', at: at(4, 3) });
  await api.createShape({ type: 'endEvent', id: 'declinedEnd', name: 'Cancelled: payment declined', at: at(5, 3) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', name: 'Prepare the shipment', at: at(4, 1) });
  await expressionTask(api, 'packOrder', 'Pack the order', "${execution.setVariable('packed', true)}", at(5, 0));
  await connectorTask(api, 'createShipment', 'Create the shipping label', 'shipping.CREATE', at(5, 2));
  await api.createShape({ type: 'parallelGateway', id: 'join', name: 'Ready to ship', at: at(6, 1) });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'awaitPickup', name: 'Carrier picked up', eventDefinition: 'signal', at: at(7, 1) });
  await api.setProperty('awaitPickup', 'signal.ref', 'carrierPickedUp');
  await api.createShape({ type: 'intermediateCatchEvent', id: 'awaitDelivery', name: 'Order delivered', eventDefinition: 'signal', at: at(8, 1) });
  await api.setProperty('awaitDelivery', 'signal.ref', 'orderDelivered');
  await api.createShape({ type: 'exclusiveGateway', id: 'carrierGateway', name: 'Express carrier?', at: at(9, 1) });
  await expressionTask(api, 'expressNotice', 'Send the express notice', "${execution.setVariable('notice', 'EXPRESS')}", at(10, 0));
  await expressionTask(api, 'standardNotice', 'Send the standard notice', "${execution.setVariable('notice', 'STANDARD')}", at(10, 2));
  await api.createShape({ type: 'endEvent', id: 'expressShippedEnd', name: 'Shipped express', at: at(11, 0) });
  await api.createShape({ type: 'endEvent', id: 'shippedEnd', name: 'Shipped', at: at(11, 2) });

  await chain(api, 'start', 'lookupCustomer', 'reserveStock', 'chargePayment', 'fork');
  await api.connect('onReserveCompensate', 'releaseStock', 'a_onReserveCompensate_releaseStock', { type: 'association', attrs: { associationDirection: 'One' } });
  await chain(api, 'paymentDeclined', 'rollbackOrder', 'declinedEnd');
  await chain(api, 'fork', 'packOrder', 'join');
  await chain(api, 'fork', 'createShipment', 'join');
  await chain(api, 'join', 'awaitPickup', 'awaitDelivery', 'carrierGateway');
  await flow(api, 'carrierGateway', 'expressNotice', { name: 'express', condition: "${carrier == 'EXPRESS'}" });
  await flow(api, 'carrierGateway', 'standardNotice', { name: 'other', default: true });
  await chain(api, 'expressNotice', 'expressShippedEnd');
  await chain(api, 'standardNotice', 'shippedEnd');

  // --- signal-mapping-ignored ------------------------------------------------------------------------------------------------------
  // The control for the rule signal-catch-has-mapping: an output mapping written on a signal catch event explicitly is never applied.
  await api.newProcess('signalMappingIgnored', 'A mapping on a signal catch event', { file: 'signal-mapping-ignored' });
  await api.setProperty('signalMappingIgnored', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('signalMappingIgnored', 'documentation.text',
    'A signal catch event with an explicit output mapping that would rename the payload variable carrier to renamed. Activiti 9.0.0 applies no mapping to a signal catch event: the payload arrives under its own name and renamed is never set. This is why the modeler gives a signal catch event no default mapping (the lint rule signal-catch-has-mapping warns about the entry). Engine behaviour pinned here, not a model to copy.');
  await api.setProperty('signalMappingIgnored', 'definitions.signals', [{ id: 'pingSignal', name: 'ping' }]);
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Waiting for the ping', at: at(0, 1) });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'awaitPing', name: 'Ping', eventDefinition: 'signal', at: at(1, 1) });
  await api.setProperty('awaitPing', 'signal.ref', 'ping');
  await api.setProperty('awaitPing', 'mapping.outputs', { renamed: { type: 'VARIABLE', value: 'carrier', declareType: 'string' } });
  await api.createShape({ type: 'endEvent', id: 'pinged', name: 'Pinged', at: at(2, 1) });
  await chain(api, 'start', 'awaitPing', 'pinged');
}
