import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';

/**
 * C18 collaboration, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js commands the
 * properties panel and the canvas use) and exported with the real export pipeline. It reproduces `seed/processes/*`:
 *  - collaboration.bpmn20.xml: two executable pools (the customer's with two lanes, the supplier's without), a black box pool, three
 *    message flows, a data store with a reference, a data object with a reference, data associations, a text annotation;
 *  - annotations.bpmn20.xml: a process without pools, with a text annotation and its association;
 *  - coloured.bpmn20.xml: one pool with a lane, coloured the way the bpmn-js colour picker does.
 * The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C18';
const centre = (x: number, y: number, w: number, h: number): { x: number; y: number } => ({ x: x + w / 2, y: y + h / 2 });
const event = (x: number, y: number): { x: number; y: number } => centre(x, y, 36, 36);
const task = (x: number, y: number): { x: number; y: number } => centre(x, y, 100, 80);

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C18-collaboration', { defaultMappings: 'none' });

  // --- collaboration.bpmn20.xml -----------------------------------------------------------------------------------------------
  // The supplier's process is drawn first, in the open process; its pool is put around it afterwards and bpmn-js turns the diagram into a
  // collaboration. (bpmn-js keeps the text annotation and the association of a pool in the collaboration, which Activiti does not read;
  // the export writes them into the process of the pool, where the seed has them.)
  await api.newProcess('supplierFulfilment', 'Supplier fulfilment', { file: 'collaboration', omitExtensions: true });
  await api.setProperty('supplierFulfilment', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('supplierFulfilment', 'documentation.text', 'The supplier pool: an order message starts it, the stock is reserved, the parcel is shipped and a confirmation message ends it. The pool has no lanes.');
  await api.setProperty('supplierFulfilment', 'definitions.messages', [{ id: 'orderPlacedMsg', name: 'orderPlaced' }, { id: 'orderConfirmedMsg', name: 'orderConfirmed' }]);
  await api.createShape({ type: 'startEvent', id: 'supplierStart', name: 'Order received', eventDefinition: 'message', at: event(402, 522) });
  await api.setProperty('supplierStart', 'message.ref', 'orderPlaced');
  await api.createShape({ type: 'serviceTask', id: 'reserveStock', name: 'Reserve stock', at: task(520, 500) });
  await api.setProperty('reserveStock', 'impl.type', 'expression');
  await api.setProperty('reserveStock', 'impl.expression', "${execution.setVariable('reserved', true)}");
  await api.createShape({ type: 'userTask', id: 'shipOrder', name: 'Ship order', at: task(670, 500) });
  await api.setProperty('shipOrder', 'user.assignee', 'ann');
  await api.createShape({ type: 'endEvent', id: 'supplierEnd', name: 'Confirmation sent', eventDefinition: 'message', at: event(852, 522) });
  await api.setProperty('supplierEnd', 'message.ref', 'orderConfirmed');
  await api.setProperty('supplierEnd', 'message.delegateExpression', '${recordingThrowMessageDelegate}');
  for (const [from, to] of [['supplierStart', 'reserveStock'], ['reserveStock', 'shipOrder'], ['shipOrder', 'supplierEnd']] as const) {
    await api.connect(from, to, `f_${from}_${to}`);
  }
  await api.createShape({ type: 'textAnnotation', id: 'shipNote', at: centre(505, 647, 130, 50), attrs: { text: 'The carrier is a black box pool: nothing is deployed for it.' } });
  await api.connect('shipOrder', 'shipNote', 'as_shipOrder_shipNote', { type: 'association' });
  await api.createShape({ type: 'participant', id: 'supplierPool', name: 'Supplier', at: centre(10, 470, 1218, 257), size: { width: 1218, height: 257 } });
  const collaboration = (await api.elementIds()).find((id) => id.startsWith('Collaboration_'))!;
  await api.setModdleProperty(collaboration, 'id', 'orderCollaboration');

  // the customer's pool: its own process, two lanes
  await api.createShape({
    type: 'participant', id: 'customerPool', name: 'Customer', at: centre(10, 20, 1218, 257), size: { width: 1218, height: 257 },
    process: { id: 'customerOrder', name: 'Customer order', documentation: "The customer pool: places an order, sends it to the supplier, waits for the confirmation and approves the delivery. Pools, lanes, message flows, the data store reference and the data object reference are documentation: the engine deploys each pool as its own process and moves no token along a message flow." },
  });
  await api.createLane('customerPool', { id: 'approverLane', name: 'Approver', first: { id: 'buyerLane', name: 'Buyer' } });
  await api.setModdleProperty('customerPool#laneSet', 'id', 'customerLanes');

  await api.createShape({ type: 'startEvent', id: 'custStart', name: 'Need an item', parent: 'buyerLane', at: event(102, 72) });
  await api.createShape({ type: 'userTask', id: 'placeOrder', name: 'Place order', parent: 'buyerLane', at: task(220, 50) });
  await api.setProperty('placeOrder', 'user.assignee', 'ann');
  await api.createShape({ type: 'intermediateThrowEvent', id: 'orderSent', name: 'Order sent', eventDefinition: 'message', parent: 'buyerLane', at: event(402, 72) });
  await api.setProperty('orderSent', 'message.ref', 'orderPlaced');
  await api.setProperty('orderSent', 'message.delegateExpression', '${recordingThrowMessageDelegate}');
  await api.createShape({ type: 'intermediateCatchEvent', id: 'awaitConfirmation', name: 'Confirmation arrives', eventDefinition: 'message', parent: 'buyerLane', at: event(852, 72) });
  await api.setProperty('awaitConfirmation', 'message.ref', 'orderConfirmed');
  await api.setProperty('awaitConfirmation', 'message.correlationKey', '${orderId}');
  // (the second lane starts below the first one, which is as high as the pool was drawn)
  await api.createShape({ type: 'userTask', id: 'approveDelivery', name: 'Approve delivery', parent: 'approverLane', at: task(970, 300) });
  await api.setProperty('approveDelivery', 'user.assignee', 'bob');
  await api.createShape({ type: 'endEvent', id: 'custEnd', name: 'Order done', parent: 'approverLane', at: event(1152, 322) });
  for (const [from, to] of [['custStart', 'placeOrder'], ['placeOrder', 'orderSent'], ['orderSent', 'awaitConfirmation'], ['awaitConfirmation', 'approveDelivery'], ['approveDelivery', 'custEnd']] as const) {
    await api.connect(from, to, `f_${from}_${to}`);
  }

  // a data object (a variable with a default value) and its reference, a data store reference, and the associations to the first task
  await api.createShape({ type: 'dataObjectReference', id: 'orderNoteRef', name: 'Order note', parent: 'customerPool', at: centre(102, 175, 36, 50) });
  await api.setProperty('orderNoteRef', 'data.id', 'orderNote');
  await api.setProperty('customerPool', 'data.objects', [{ id: 'orderNote', name: 'orderNote', type: 'xsd:string', value: 'draft' }]);
  await api.addRootElement('dataStore', { id: 'orderDb', name: 'Order database' });
  await api.createShape({ type: 'dataStoreReference', id: 'orderStore', name: 'Orders', parent: 'customerPool', at: centre(245, 197, 50, 50) });
  await api.setModdleProperty('orderStore', 'dataStoreRef', { ref: 'orderDb' });
  await api.connect('orderNoteRef', 'placeOrder', 'dia_orderNoteRef_placeOrder', { type: 'dataInputAssociation' });
  await api.connect('placeOrder', 'orderStore', 'doa_placeOrder_orderStore', { type: 'dataOutputAssociation' });

  // the carrier is a black box pool: no process
  await api.createShape({ type: 'participant', id: 'carrierPool', name: 'Carrier (black box)', at: centre(10, 767, 1218, 80), size: { width: 1218, height: 80 }, blackBox: true });

  // the message flows between the pools
  await api.connect('orderSent', 'supplierStart', 'mf_orderSent_supplierStart', { type: 'messageFlow', name: 'Order' });
  await api.setModdleProperty('mf_orderSent_supplierStart', 'messageRef', { ref: 'orderPlacedMsg' });
  await api.connect('supplierEnd', 'awaitConfirmation', 'mf_supplierEnd_awaitConfirmation', { type: 'messageFlow', name: 'Confirmation' });
  await api.setModdleProperty('mf_supplierEnd_awaitConfirmation', 'messageRef', { ref: 'orderConfirmedMsg' });
  await api.connect('shipOrder', 'carrierPool', 'mf_shipOrder_carrierPool', { type: 'messageFlow', name: 'Parcel' });

  // --- annotations.bpmn20.xml -------------------------------------------------------------------------------------------------
  // a process without pools: bpmn-js keeps the annotation and its association in the process, where Activiti reads them
  await api.newProcess('annotatedRequest', 'Annotated request', { file: 'annotations', omitExtensions: true });
  await api.setProperty('annotatedRequest', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('annotatedRequest', 'documentation.text', 'A process without pools whose user task has a text annotation, connected by an association. The editor keeps both in the process, which is where Activiti reads them; they change nothing at run time.');
  await api.createShape({ type: 'startEvent', id: 'requestStart', name: 'Request received', at: event(102, 202) });
  await api.createShape({ type: 'userTask', id: 'check', name: 'Check the request', at: task(220, 180) });
  await api.setProperty('check', 'user.assignee', 'ann');
  await api.createShape({ type: 'endEvent', id: 'requestEnd', name: 'Checked', at: event(402, 202) });
  await api.connect('requestStart', 'check', 'f_requestStart_check');
  await api.connect('check', 'requestEnd', 'f_check_requestEnd');
  await api.createShape({ type: 'textAnnotation', id: 'checkNote', at: centre(320, 80, 150, 40), attrs: { text: 'Checked by the clerk on duty.' } });
  await api.connect('check', 'checkNote', 'as_check_checkNote', { type: 'association' });

  // --- coloured.bpmn20.xml ----------------------------------------------------------------------------------------------------
  await api.newProcess('colouredReview', 'Coloured review', { file: 'coloured', omitExtensions: true });
  await api.setProperty('colouredReview', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('colouredReview', 'documentation.text', 'A reviewed request in a coloured diagram: the bpmn-js colour picker writes bioc:stroke / bioc:fill and color:border-color / color:background-color on the shapes, bioc:stroke / color:border-color on the edges. The engine ignores all of them.');
  await api.createShape({ type: 'startEvent', id: 'reviewStart', name: 'Request received', at: event(102, 72) });
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review request', at: task(220, 50) });
  await api.setProperty('review', 'user.assignee', 'ann');
  await api.createShape({ type: 'exclusiveGateway', id: 'decide', name: 'Accepted?', at: centre(395, 65, 50, 50) });
  await api.createShape({ type: 'endEvent', id: 'acceptedEnd', name: 'Accepted', at: event(552, 72) });
  await api.createShape({ type: 'endEvent', id: 'rejectedEnd', name: 'Rejected', at: event(552, 182) });
  await api.connect('reviewStart', 'review', 'f_reviewStart_review');
  await api.connect('review', 'decide', 'f_review_decide');
  await api.connect('decide', 'acceptedEnd', 'f_decide_acceptedEnd', { name: 'yes' });
  await api.setProperty('f_decide_acceptedEnd', 'flow.condition', '${accepted == true}');
  await api.connect('decide', 'rejectedEnd', 'f_decide_rejectedEnd', { name: 'no' });
  await api.setProperty('f_decide_rejectedEnd', 'flow.default', true);
  await api.createShape({ type: 'textAnnotation', id: 'colourNote', at: centre(355, 219, 130, 50), attrs: { text: 'Green is the happy path, red the rejection.' } });
  await api.connect('decide', 'colourNote', 'as_decide_colourNote', { type: 'association' });
  // the pool is put around the process; its lane takes the elements over (the first lane of a pool makes two, the spare one goes again)
  await api.createShape({ type: 'participant', id: 'colouredPool', name: 'Review desk', at: centre(12, 20, 616, 279), size: { width: 616, height: 279 } });
  const coloured = (await api.elementIds()).find((id) => id.startsWith('Collaboration_'))!;
  await api.setModdleProperty(coloured, 'id', 'colouredCollaboration');
  await api.createLane('colouredPool', { id: 'spare', first: { id: 'reviewerLane', name: 'Reviewer' } });
  await api.removeElements(['spare']);
  await api.setModdleProperty('colouredPool#laneSet', 'id', 'reviewLanes');

  const paint = async (ids: string[], fill: string | undefined, stroke: string): Promise<void> => api.setColor(ids, { ...(fill ? { fill } : {}), stroke });
  await paint(['colouredPool'], '#e3f2fd', '#1e88e5');
  await paint(['reviewerLane'], '#f5faff', '#5b8dc9');
  await paint(['reviewStart'], '#c8e6c9', '#43a047');
  await paint(['review'], '#bbdefb', '#1e88e5');
  await paint(['decide'], '#ffe0b2', '#fb8c00');
  await paint(['acceptedEnd'], '#a5d6a7', '#2e7d32');
  await paint(['rejectedEnd'], '#ffcdd2', '#c62828');
  await paint(['colourNote'], '#efebe9', '#6d4c41');
  await paint(['f_reviewStart_review'], undefined, '#1e88e5');
  await paint(['f_decide_acceptedEnd'], undefined, '#2e7d32');
  await paint(['f_decide_rejectedEnd'], undefined, '#c62828');
  await paint(['as_decide_colourNote'], undefined, '#6d4c41');
}

export const exportWarnings = [
  { pattern: /dataObjectReference "orderNoteRef" is drawn/, reason: 'the seed draws the data object reference on purpose (engine finding C18.2: DI_INVALID_REFERENCE is reported, the data object itself works)' },
];

export const semanticDiff = {
  allow: [
    { pattern: /dataInputAssociation\[dia_orderNoteRef_placeOrder\]\/targetRef: expected text "placeOrder", generated "Property_\w+"/, reason: 'bpmn-js writes the standard form of a data input association (targetRef names a property placeholder of the task); the hand-written seed points targetRef at the task itself. Activiti reads neither (engine finding C18.2)' },
    { pattern: /association\[(as_shipOrder_shipNote|as_decide_colourNote)\]\/@associationDirection: expected "None", generated no attribute/, reason: 'associationDirection="None" is the BPMN default; the modeler does not write an attribute that holds the default' },
    { pattern: /userTask\[placeOrder\]\/property\[Property_\w+\]: only in the generated model/, reason: 'the property placeholder bpmn-js adds for the data input association above' },
  ],
};
