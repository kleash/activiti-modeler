import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C06 messages, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`: the
 * definitions-level messages (Messages group), message start, catch, boundary and event sub process start events with their
 * correlation keys and payload mappings (Input / output mapping group: an output mapping on a catch event, an input mapping on a
 * throw event), throw and end events with a delegate (Message group). The runner compares the result with the seed semantically
 * and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C06';
const INCREMENT = 'io.github.kleash.activiti.harness.support.IncrementDelegate';
const HARNESS = 'io.github.kleash.activiti.harness.support';

type Message = { id: string; name: string };

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string, messages: Message[]): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
  await api.setProperty(id, 'definitions.messages', messages);
}

/** A message event; `message` is the name of a message of the file, `expression` names it by a JUEL expression instead. */
async function messageEvent(
  api: ModelerApi,
  spec: {
    type: 'intermediateCatchEvent' | 'intermediateThrowEvent' | 'startEvent' | 'boundaryEvent' | 'endEvent';
    id: string;
    name: string;
    message?: string;
    expression?: string;
    correlationKey?: string;
    attachedTo?: string;
    interrupting?: boolean;
    parent?: string;
    position?: { x: number; y: number };
  },
): Promise<void> {
  await api.createShape({
    type: spec.type,
    id: spec.id,
    name: spec.name,
    eventDefinition: 'message',
    ...(spec.attachedTo ? { attachedTo: spec.attachedTo } : {}),
    ...(spec.interrupting === false ? { interrupting: false } : {}),
    ...(spec.parent ? { parent: spec.parent } : {}),
    ...(spec.position ? { at: spec.position } : {}),
  });
  if (spec.message) await api.setProperty(spec.id, 'message.ref', spec.message);
  if (spec.expression) await api.setProperty(spec.id, 'message.expression', spec.expression);
  if (spec.correlationKey) await api.setProperty(spec.id, 'message.correlationKey', spec.correlationKey);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C06-messages', { defaultMappings: 'none' });

  // --- message-throw --------------------------------------------------------------------------------------------------
  await newProcess(api, 'message-throw', 'messageThrow', 'Message throw and end events',
    "Throw events never send anything by default. A delegate named on the message event definition (activiti:delegateExpression or activiti:class) receives the message with its correlation key, business key and the payload built from the throw event's input mapping.",
    [{ id: 'shippedMsg', name: 'shipped' }, { id: 'notifiedMsg', name: 'notified' }, { id: 'taggedMsg', name: 'tagged' }, { id: 'silentMsg', name: 'silent' }, { id: 'archivedMsg', name: 'archived' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await messageEvent(api, { type: 'intermediateThrowEvent', id: 'throwExpr', name: 'Shipped (delegate expression)', message: 'shipped', correlationKey: '${orderId}', position: at(1, 1) });
  await api.setProperty('throwExpr', 'message.delegateExpression', '${recordingThrowMessageDelegate}');
  await messageEvent(api, { type: 'intermediateThrowEvent', id: 'throwClass', name: 'Notified (delegate class)', message: 'notified', position: at(2, 1) });
  await api.setProperty('throwClass', 'message.class', `${HARNESS}.RecordingThrowMessageDelegate`);
  await messageEvent(api, { type: 'intermediateThrowEvent', id: 'throwField', name: 'Tagged (delegate class with a field)', message: 'tagged', position: at(3, 1) });
  await api.setProperty('throwField', 'message.class', `${HARNESS}.FieldThrowMessageDelegate`);
  await api.setProperty('throwField', 'message.fields', [{ name: 'tag', string: 'T1' }]);
  await messageEvent(api, { type: 'intermediateThrowEvent', id: 'throwSilent', name: 'Silent (no delegate)', message: 'silent', position: at(4, 1) });
  await messageEvent(api, { type: 'endEvent', id: 'archiveEnd', name: 'Archived (message end)', message: 'archived', position: at(5, 1) });
  await api.setProperty('archiveEnd', 'message.delegateExpression', '${recordingThrowMessageDelegate}');
  await chain(api, 'start', 'throwExpr', 'throwClass', 'throwField', 'throwSilent', 'archiveEnd');
  await api.setExtensions({ properties: [{ name: 'orderId', type: 'string' }, { name: 'amount', type: 'integer' }] });
  await api.setProperty('throwExpr', 'mapping.inputs', { total: { type: 'VARIABLE', value: 'amount' }, currency: { type: 'VALUE', value: 'EUR' } });

  // --- message-end ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'message-end', 'messageEnd', 'Message end event with a delegate class',
    'A message end event whose delegate is a Java class (activiti:class on the message event definition). The class receives the message name, the correlation key, the business key and the payload built from the input mapping of the end event: only the mapped values, under the names the mapping gives them.',
    [{ id: 'closedMsg', name: 'closed' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await messageEvent(api, { type: 'endEvent', id: 'closedEnd', name: 'Closed (message end, delegate class)', message: 'closed', correlationKey: '${orderId}', position: at(1, 1) });
  await api.setProperty('closedEnd', 'message.class', `${HARNESS}.RecordingThrowMessageDelegate`);
  await chain(api, 'start', 'closedEnd');
  await api.setExtensions({ properties: [{ name: 'orderId', type: 'string' }, { name: 'amount', type: 'integer' }] });
  await api.setProperty('closedEnd', 'mapping.inputs', { order: { type: 'VARIABLE', value: 'orderId' }, total: { type: 'VARIABLE', value: 'amount' }, status: { type: 'VALUE', value: 'CLOSED' } });

  // --- message-same-name ----------------------------------------------------------------------------------------------
  await newProcess(api, 'message-same-name', 'messageSameName', 'Two catches of one message name',
    'Two parallel catch events wait for the message ticket with the correlation keys keyA and keyB. ProcessRuntime.receive finds its subscription with a query that must return one result.',
    [{ id: 'ticketMsg', name: 'ticket' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'parallelGateway', id: 'fork', at: at(1, 1) });
  await messageEvent(api, { type: 'intermediateCatchEvent', id: 'catchA', name: 'Ticket A', message: 'ticket', correlationKey: '${keyA}', position: at(2, 0) });
  await messageEvent(api, { type: 'intermediateCatchEvent', id: 'catchB', name: 'Ticket B', message: 'ticket', correlationKey: '${keyB}', position: at(2, 2) });
  await api.createShape({ type: 'parallelGateway', id: 'join', at: at(3, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'fork', 'catchA', 'join', 'end');
  await chain(api, 'fork', 'catchB', 'join');

  // --- message-catch --------------------------------------------------------------------------------------------------
  await newProcess(api, 'message-catch', 'messageCatch', 'Intermediate catch message events',
    "Two catch events in a row: one named by messageRef with a correlation key, one named by a message expression. The payload reaches the process only through the catch event's mapping.",
    [{ id: 'paymentMsg', name: 'paymentReceived' }, { id: 'docsMsg', name: 'docsReceived' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await messageEvent(api, { type: 'intermediateCatchEvent', id: 'waitPayment', name: 'Payment received', message: 'paymentReceived', correlationKey: '${orderId}', position: at(1, 1) });
  await messageEvent(api, { type: 'intermediateCatchEvent', id: 'waitDocs', name: 'Documents received for the region', expression: "${'docs-'.concat(region)}", correlationKey: '${orderId}', position: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'waitPayment', 'waitDocs', 'end');
  await api.setExtensions({ properties: [{ name: 'orderId', type: 'string' }, { name: 'region', type: 'string' }, { name: 'paidAmount', type: 'integer' }] });
  await api.setProperty('waitPayment', 'mapping.outputs', { paidAmount: { type: 'VARIABLE', value: 'amount' } });
  await api.setProperty('waitDocs', 'mapping.type', 'MAP_ALL_OUTPUTS');

  // --- message-start --------------------------------------------------------------------------------------------------
  await newProcess(api, 'message-start', 'messageStart', 'Message start event',
    'A message named orderPlaced starts an instance. A mapping on the start event is an output mapping of the message variables (only the mapped ones survive); a start event without a mapping passes them on as they are (engine finding 30).',
    [{ id: 'orderPlacedMsg', name: 'orderPlaced' }, { id: 'orderImportedMsg', name: 'orderImported' }]);
  await messageEvent(api, { type: 'startEvent', id: 'startOnMessage', name: 'Order placed', message: 'orderPlaced', position: at(0, 0) });
  await messageEvent(api, { type: 'startEvent', id: 'startPlain', name: 'Order imported', message: 'orderImported', position: at(0, 2) });
  await api.createShape({ type: 'serviceTask', id: 'register', name: 'Register the order', at: at(1, 1) });
  await api.setProperty('register', 'impl.type', 'expression');
  await api.setProperty('register', 'impl.expression', "${execution.setVariable('registered', true)}");
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'startOnMessage', 'register', 'end');
  await api.connect('startPlain', 'register', 'f_startPlain_register');
  await api.setExtensions({ properties: [{ name: 'orderRef', type: 'string' }] });
  await api.setProperty('startOnMessage', 'mapping.outputs', { orderRef: { type: 'VARIABLE', value: 'ref' } });

  // --- message-boundary -----------------------------------------------------------------------------------------------
  await newProcess(api, 'message-boundary', 'messageBoundary', 'Boundary message events',
    'A user task with an interrupting boundary message (cancelRequest) and a non-interrupting one (additionalInfo) that can be received repeatedly; both correlate on the order id.',
    [{ id: 'cancelRequestMsg', name: 'cancelRequest' }, { id: 'infoMsg', name: 'additionalInfo' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review the order', at: at(1, 1) });
  await api.setProperty('review', 'user.assignee', 'ann');
  await messageEvent(api, { type: 'boundaryEvent', id: 'cancelBoundary', name: 'Cancel request', message: 'cancelRequest', correlationKey: '${orderId}', attachedTo: 'review' });
  await messageEvent(api, { type: 'boundaryEvent', id: 'infoBoundary', name: 'Additional info', message: 'additionalInfo', correlationKey: '${orderId}', attachedTo: 'review', interrupting: false });
  await api.createShape({ type: 'endEvent', id: 'cancelledEnd', name: 'Cancelled', at: at(2, 3) });
  await api.createShape({ type: 'serviceTask', id: 'noteInfo', name: 'Count the info', at: at(3, 3) });
  await api.setProperty('noteInfo', 'impl.type', 'class');
  await api.setProperty('noteInfo', 'impl.class', INCREMENT);
  await api.setProperty('noteInfo', 'fields.list', [{ name: 'variable', string: 'infos' }]);
  await api.createShape({ type: 'endEvent', id: 'infoEnd', name: 'Info noted', at: at(4, 3) });
  await api.createShape({ type: 'endEvent', id: 'reviewedEnd', name: 'Reviewed', at: at(3, 1) });
  await chain(api, 'start', 'review');
  await chain(api, 'cancelBoundary', 'cancelledEnd');
  await chain(api, 'infoBoundary', 'noteInfo', 'infoEnd');
  await api.connect('review', 'reviewedEnd', 'f_review_reviewedEnd');
  await api.setExtensions({ properties: [{ name: 'orderId', type: 'string' }, { name: 'lastInfo', type: 'string' }, { name: 'cancelReason', type: 'string' }] });
  await api.setProperty('infoBoundary', 'mapping.outputs', { lastInfo: { type: 'VARIABLE', value: 'text' } });
  await api.setProperty('cancelBoundary', 'mapping.outputs', { cancelReason: { type: 'VARIABLE', value: 'reason' } });

  // --- message-clash --------------------------------------------------------------------------------------------------
  await newProcess(api, 'message-clash', 'messageClash', 'Boundary and event sub process on one message',
    'The user task has a boundary message docs and the process an event sub process started by the same message docs, neither with a correlation key. While the receive task before the user task waits only the event sub process subscribes; at the user task both do (lint L30).',
    [{ id: 'docsMsg', name: 'docs' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'receiveTask', id: 'prepare', name: 'Prepare', at: at(1, 1) });
  await api.createShape({ type: 'userTask', id: 'collect', name: 'Collect the documents', at: at(2, 1) });
  await api.setProperty('collect', 'user.assignee', 'ann');
  await messageEvent(api, { type: 'boundaryEvent', id: 'docsBoundary', name: 'Docs (boundary)', message: 'docs', attachedTo: 'collect', interrupting: false });
  await api.createShape({ type: 'endEvent', id: 'boundaryEnd', name: 'Docs via boundary', at: at(3, 3) });
  await api.createShape({ type: 'endEvent', id: 'collectedEnd', name: 'Collected', at: at(3, 1) });
  await chain(api, 'start', 'prepare', 'collect');
  await chain(api, 'docsBoundary', 'boundaryEnd');
  await api.connect('collect', 'collectedEnd', 'f_collect_collectedEnd');
  await api.createShape({ type: 'subProcess', id: 'docsHandler', name: 'Docs handler', triggeredByEvent: true, isExpanded: true, at: { x: 560, y: 520 }, size: { width: 350, height: 160 } });
  await messageEvent(api, { type: 'startEvent', id: 'docsStart', name: 'Docs (event sub process)', message: 'docs', interrupting: false, parent: 'docsHandler', position: { x: 440, y: 520 } });
  await api.createShape({ type: 'endEvent', id: 'handlerEnd', name: 'Docs via event sub process', parent: 'docsHandler', at: { x: 640, y: 520 } });
  await api.connect('docsStart', 'handlerEnd', 'f_docsStart_handlerEnd');

  // --- message-event-subprocess ---------------------------------------------------------------------------------------
  await newProcess(api, 'message-event-subprocess', 'messageEventSubprocess', 'Message event sub processes',
    'Two event sub processes started by messages: escalate interrupts the main flow, note does not. Both correlate on the order id.',
    [{ id: 'escalateMsg', name: 'escalate' }, { id: 'noteMsg', name: 'note' }]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'work', name: 'Work on the order', at: at(1, 1) });
  await api.setProperty('work', 'user.assignee', 'ann');
  await api.createShape({ type: 'endEvent', id: 'workEnd', name: 'Worked', at: at(2, 1) });
  await chain(api, 'start', 'work', 'workEnd');
  await api.createShape({ type: 'subProcess', id: 'escalationHandler', name: 'Escalation', triggeredByEvent: true, isExpanded: true, at: { x: 420, y: 330 }, size: { width: 450, height: 160 } });
  await messageEvent(api, { type: 'startEvent', id: 'escalateStart', name: 'Escalate', message: 'escalate', correlationKey: '${orderId}', parent: 'escalationHandler', position: { x: 270, y: 330 } });
  await api.createShape({ type: 'serviceTask', id: 'markEscalated', name: 'Mark as escalated', parent: 'escalationHandler', at: { x: 400, y: 330 } });
  await api.setProperty('markEscalated', 'impl.type', 'expression');
  await api.setProperty('markEscalated', 'impl.expression', "${execution.setVariable('escalated', true)}");
  await api.createShape({ type: 'endEvent', id: 'escalatedEnd', name: 'Escalated', parent: 'escalationHandler', at: { x: 540, y: 330 } });
  await chain(api, 'escalateStart', 'markEscalated', 'escalatedEnd');
  await api.createShape({ type: 'subProcess', id: 'noteHandler', name: 'Note', triggeredByEvent: true, isExpanded: true, at: { x: 420, y: 560 }, size: { width: 450, height: 160 } });
  await messageEvent(api, { type: 'startEvent', id: 'noteStart', name: 'Note', message: 'note', correlationKey: '${orderId}', interrupting: false, parent: 'noteHandler', position: { x: 270, y: 560 } });
  await api.createShape({ type: 'serviceTask', id: 'recordNote', name: 'Count the note', parent: 'noteHandler', at: { x: 400, y: 560 } });
  await api.setProperty('recordNote', 'impl.type', 'class');
  await api.setProperty('recordNote', 'impl.class', INCREMENT);
  await api.setProperty('recordNote', 'fields.list', [{ name: 'variable', string: 'notes' }]);
  await api.createShape({ type: 'endEvent', id: 'noteEnd', name: 'Noted', parent: 'noteHandler', at: { x: 540, y: 560 } });
  await chain(api, 'noteStart', 'recordNote', 'noteEnd');
  await api.setExtensions({ properties: [{ name: 'orderId', type: 'string' }, { name: 'lastNote', type: 'string' }, { name: 'reason', type: 'string' }] });
  await api.setProperty('escalateStart', 'mapping.outputs', { reason: { type: 'VARIABLE', value: 'why' } });
  await api.setProperty('noteStart', 'mapping.outputs', { lastNote: { type: 'VARIABLE', value: 'text' } });
}

