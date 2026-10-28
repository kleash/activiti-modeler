import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';

/**
 * C09 transactions, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces
 * `seed/processes/booking-transaction.bpmn20.xml`: a transaction sub process with two compensable user tasks (compensation boundary
 * events connected by an association to their handlers, which the modeler marks `isForCompensation`), a payment check that ends in a
 * cancel end event, and the cancel boundary event on the transaction that leads to the refund. The runner compares the result with the
 * seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C09';

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C09-transactions', { defaultMappings: 'none' });
  await api.newProcess('bookingTransaction', 'Booking transaction', { file: 'booking-transaction' });
  await api.setProperty('bookingTransaction', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('bookingTransaction', 'documentation.text',
    'A transaction sub process with compensable work. When the payment fails, the cancel end event cancels the transaction: the completed compensable activities are compensated (handlers in reverse order of completion) and the process leaves through the cancel boundary event instead of the normal flow. A cancel end event can only do this when at least one compensable activity of the transaction has completed; without one the engine fails with "No execution found for sub process of boundary cancel event" and the completion is rolled back.');

  await api.createShape({ type: 'startEvent', id: 'start', at: { x: 120, y: 260 } });
  await api.createShape({ type: 'transaction', id: 'booking', name: 'Book and pay', at: { x: 940, y: 260 }, size: { width: 1100, height: 440 } });
  const inside = (column: number, row = 0): { x: number; y: number } => ({ x: 460 + column * 150, y: 160 + row * 140 });

  await api.createShape({ type: 'startEvent', id: 'tStart', parent: 'booking', at: inside(0, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'reserveGate', name: 'Reserve first?', parent: 'booking', at: inside(1, 1) });
  await api.createShape({ type: 'userTask', id: 'reserveSeat', name: 'Reserve seat', parent: 'booking', at: inside(2, 0) });
  await api.createShape({ type: 'boundaryEvent', id: 'onSeatCompensate', name: 'Compensate seat', attachedTo: 'reserveSeat', eventDefinition: 'compensate' });
  await api.createShape({ type: 'userTask', id: 'reserveMeal', name: 'Reserve meal', parent: 'booking', at: inside(3, 0) });
  await api.createShape({ type: 'boundaryEvent', id: 'onMealCompensate', name: 'Compensate meal', attachedTo: 'reserveMeal', eventDefinition: 'compensate' });
  await api.createShape({ type: 'userTask', id: 'pay', name: 'Take payment', parent: 'booking', at: inside(4, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'paymentCheck', name: 'Paid?', parent: 'booking', at: inside(5, 1) });
  await api.createShape({ type: 'endEvent', id: 'tEnd', name: 'Paid', parent: 'booking', at: inside(6, 0) });
  await api.createShape({ type: 'endEvent', id: 'cancelEnd', name: 'Cancel the transaction', eventDefinition: 'cancel', parent: 'booking', at: inside(6, 1) });
  await api.createShape({ type: 'serviceTask', id: 'releaseSeat', name: 'Release seat', parent: 'booking', at: inside(2, 2) });
  await api.createShape({ type: 'serviceTask', id: 'releaseMeal', name: 'Release meal', parent: 'booking', at: inside(3, 2) });
  for (const id of ['reserveSeat', 'reserveMeal', 'pay']) await api.setProperty(id, 'user.assignee', 'ann');
  for (const id of ['releaseSeat', 'releaseMeal']) {
    await api.setProperty(id, 'impl.type', 'delegateExpression');
    await api.setProperty(id, 'impl.delegateExpression', '${recordingDelegate}');
  }

  await api.connect('tStart', 'reserveGate', 'f_tStart_reserveGate');
  await api.connect('reserveGate', 'reserveSeat', 'f_reserveGate_reserveSeat', { name: 'yes' });
  await api.setProperty('f_reserveGate_reserveSeat', 'flow.condition', '${reserve == true}');
  await api.connect('reserveGate', 'pay', 'f_reserveGate_pay', { name: 'no' });
  await api.setProperty('f_reserveGate_pay', 'flow.default', true);
  await chain(api, 'reserveSeat', 'reserveMeal', 'pay', 'paymentCheck');
  await api.connect('paymentCheck', 'tEnd', 'f_paymentCheck_tEnd', { name: 'yes' });
  await api.setProperty('f_paymentCheck_tEnd', 'flow.condition', '${paid == true}');
  await api.connect('paymentCheck', 'cancelEnd', 'f_paymentCheck_cancelEnd', { name: 'no' });
  await api.setProperty('f_paymentCheck_cancelEnd', 'flow.default', true);
  // the compensation handlers: an association from the compensation boundary event marks the target isForCompensation
  await api.connect('onSeatCompensate', 'releaseSeat', 'a_onSeatCompensate_releaseSeat', { type: 'association', attrs: { associationDirection: 'One' } });
  await api.connect('onMealCompensate', 'releaseMeal', 'a_onMealCompensate_releaseMeal', { type: 'association', attrs: { associationDirection: 'One' } });

  await api.createShape({ type: 'endEvent', id: 'confirmed', name: 'Confirmed', at: { x: 1620, y: 160 } });
  await api.createShape({ type: 'boundaryEvent', id: 'onCancel', name: 'Cancelled', attachedTo: 'booking', eventDefinition: 'cancel' });
  await api.createShape({ type: 'serviceTask', id: 'refund', name: 'Refund', at: { x: 1620, y: 420 } });
  await api.setProperty('refund', 'impl.type', 'expression');
  await api.setProperty('refund', 'impl.expression', "${execution.setVariable('status', 'refunded')}");
  await api.createShape({ type: 'endEvent', id: 'cancelled', name: 'Cancelled', at: { x: 1780, y: 420 } });
  await api.connect('start', 'booking', 'f_start_booking');
  await api.connect('booking', 'confirmed', 'f_booking_confirmed');
  await chain(api, 'onCancel', 'refund', 'cancelled');
}
