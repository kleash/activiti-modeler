import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C15 data and properties, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`: the
 * process properties of every type with defaults and metadata (the `variables.list` accessor of the Process variables group),
 * the data objects of every xsd type (declared on their container, they have no shape), and the none start event with initiator,
 * form key, legacy form properties and a start mapping (Start initiator / form, Form and Input / output mapping groups). The
 * runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C15';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

async function expressionTask(api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }, resultVariable?: string): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
  if (resultVariable) await api.setProperty(id, 'impl.resultVariable', resultVariable);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C15-data-properties', { defaultMappings: 'none' });

  // --- property-types -------------------------------------------------------------------------------------------------
  await newProcess(api, 'property-types', 'propertyTypes', 'Process properties of every type',
    "The properties of property-types-extensions.json cover every type the runtime knows (string, integer, boolean, bigdecimal, json, file, folder, content, array, date, datetime), defaults including an expression default, a required property and the metadata fields. At start the runtime validates the start variables against them, applies the defaults and rejects missing required properties. derive reads some of the defaulted values to show their Java types; describe shows what the runtime's reader made of the metadata.");
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await expressionTask(api, 'derive', 'Derive', "${execution.setVariable('nextCount', count + 1)}", at(1, 1));
  await expressionTask(api, 'scale', 'Scale the amount', "${execution.setVariable('amountDoubled', amount * 2)}", at(2, 1));
  await expressionTask(api, 'describe', 'Describe the properties', '${extensionInspector.all(execution)}', at(3, 1), 'meta');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'derive', 'scale', 'describe', 'end');
  await api.setProperty('propertyTypes', 'variables.list', [
    { name: 'orderId', type: 'string', required: true, description: 'Order number', displayName: 'Order ID' },
    { name: 'title', type: 'string', value: 'untitled', description: 'Title shown in lists', displayName: 'Title', display: true, analytics: true },
    { name: 'count', type: 'integer', value: 7 },
    { name: 'flag', type: 'boolean', value: true },
    { name: 'amount', type: 'bigdecimal', value: '12.50' },
    { name: 'rate', type: 'bigdecimal', value: 0.25 },
    { name: 'config', type: 'json', value: { retries: 3, tags: ['a', 'b'] } },
    { name: 'attachment', type: 'file', value: { id: 'f-1', name: 'doc.pdf' } },
    { name: 'folderRef', type: 'folder', value: { id: 'd-1' } },
    { name: 'content', type: 'content', value: { id: 'c-1', mimeType: 'text/plain' } },
    { name: 'items', type: 'array', value: ['x', 'y'] },
    { name: 'due', type: 'date', value: '2030-05-17' },
    { name: 'stamp', type: 'datetime', value: '2030-05-17T10:15:30.000Z' },
    { name: 'label', type: 'string', value: '${orderId}-${count}' },
    { name: 'scratch', type: 'string', value: 'temp', display: false, ephemeral: true },
    { name: 'noDefault', type: 'integer' },
  ]);

  // --- data-objects ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'data-objects', 'dataObjects', 'Data objects of every type',
    'Data objects of every xsd type the engine reads (string, int, long, double, boolean, datetime), one without a type (a string), one without a value, and one that a start variable overrides. At process start they become process variables with the matching Java type; the data object of the embedded sub process exists only while the sub process runs.');
  await api.setProperty('dataObjects', 'data.objects', [
    { id: 'dStr', name: 'dStr', type: 'xsd:string', value: 'hello' },
    { id: 'dInt', name: 'dInt', type: 'xsd:int', value: '5' },
    { id: 'dLong', name: 'dLong', type: 'xsd:long', value: '9000000000' },
    { id: 'dDouble', name: 'dDouble', type: 'xsd:double', value: '2.5' },
    { id: 'dBool', name: 'dBool', type: 'xsd:boolean', value: 'true' },
    { id: 'dDate', name: 'dDate', type: 'xsd:datetime', value: '2030-05-17T10:15:30' },
    { id: 'dUntyped', name: 'dUntyped', value: 'plain' },
    { id: 'dEmpty', name: 'dEmpty', type: 'xsd:string' },
    { id: 'dOverridden', name: 'dOverridden', type: 'xsd:int', value: '1' },
  ]);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await expressionTask(api, 'sumUp', 'Sum up', "${execution.setVariable('total', dInt + dLong)}", at(1, 1));
  await api.createShape({ type: 'subProcess', id: 'inner', name: 'Inner', isExpanded: true, at: { x: 520, y: 150 }, size: { width: 400, height: 140 } });
  await api.setProperty('inner', 'data.objects', [{ id: 'dLocal', name: 'dLocal', type: 'xsd:int', value: '10' }]);
  await api.createShape({ type: 'startEvent', id: 'iStart', parent: 'inner', at: { x: 380, y: 150 } });
  await api.createShape({ type: 'serviceTask', id: 'readLocal', name: 'Read the local data object', parent: 'inner', at: { x: 510, y: 150 } });
  await api.setProperty('readLocal', 'impl.type', 'expression');
  await api.setProperty('readLocal', 'impl.expression', "${execution.setVariable('localPlusOne', dLocal + 1)}");
  await api.createShape({ type: 'endEvent', id: 'iEnd', parent: 'inner', at: { x: 640, y: 150 } });
  await api.connect('iStart', 'readLocal', 'f_iStart_readLocal');
  await api.connect('readLocal', 'iEnd', 'f_readLocal_iEnd');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await api.connect('start', 'sumUp', 'f_start_sumUp');
  await api.connect('sumUp', 'inner', 'f_sumUp_inner');
  await api.connect('inner', 'end', 'f_inner_end');

  // --- start-event-properties -----------------------------------------------------------------------------------------
  await newProcess(api, 'start-event-properties', 'startEventProperties', 'Start event properties',
    'The none start event with activiti:initiator (the starting user lands in the variable starter), activiti:formKey and legacy form properties (parsed and kept, never enforced: there is no form engine in Activiti 9), and an extensions mapping on the start event that works as an output mapping on the start payload: only the mapped variables reach the process, the rest of the payload is dropped.');
  await api.createShape({ type: 'startEvent', id: 'begin', name: 'Order received', at: at(0, 1) });
  await api.setProperty('begin', 'start.initiator', 'starter');
  await api.setProperty('begin', 'form.key', 'orderStartForm');
  await api.setProperty('begin', 'form.properties', [
    { id: 'customer', name: 'Customer', type: 'string', required: 'true' },
    { id: 'priority', name: 'Priority', type: 'enum', default: 'low', values: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  ]);
  await expressionTask(api, 'greet', 'Greet', "${execution.setVariable('greeting', greeter.greet(execution.getVariable('customerName')))}", at(1, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'begin', 'greet', 'end');
  await api.setExtensions({ properties: [{ name: 'customerName', type: 'string' }, { name: 'channel', type: 'string' }] });
  await api.setProperty('begin', 'mapping.outputs', { customerName: { type: 'VARIABLE', value: 'name' }, channel: { type: 'VALUE', value: 'web' } });
}
