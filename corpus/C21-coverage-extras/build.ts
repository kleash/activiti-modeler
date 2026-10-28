import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C21 coverage extras, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js commands the
 * properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`, the variants no other project
 * asserts: a timer start with a duration (E2), `activiti:potentialStarter` and the starter attributes (P1), `activiti:extensionId`
 * (T15), the mapping types MAP_ALL_INPUTS and MAP_ALL_OUTPUTS on a connector and on a user task (T1, T5) and multi-instance service,
 * script, manual and receive tasks, and the standard loopDataInputRef / inputDataItem form of a loop (T16). The runner compares the
 * result with the seed semantically and the harness runs the hand-written scenarios of this folder against it, so the variants are proven
 * on a generated model too.
 *
 * `defaultMappings: 'none'` keeps the modeler from giving the user tasks the MAP_ALL it would give them by default: the seed's mappings
 * (including the ones that are deliberately absent) are the point of this project.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C21';
// build files are loaded as CommonJS by the Playwright runner
const here = __dirname;

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

async function userTask(api: ModelerApi, id: string, name: string, assignee: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'userTask', id, name, at: position });
  await api.setProperty(id, 'user.assignee', assignee);
}

interface Loop {
  type: 'parallel' | 'sequential';
  collection?: string;
  cardinality?: string;
  elementVariable?: string;
  elementIndexVariable?: string;
  outputCollection?: string;
  outputItem?: string;
  completionCondition?: string;
}

async function loop(api: ModelerApi, id: string, l: Loop): Promise<void> {
  await api.setProperty(id, 'mi.type', l.type);
  if (l.collection) await api.setProperty(id, 'mi.collection', l.collection);
  if (l.cardinality) await api.setProperty(id, 'mi.cardinality', l.cardinality);
  if (l.elementVariable) await api.setProperty(id, 'mi.elementVariable', l.elementVariable);
  if (l.elementIndexVariable) await api.setProperty(id, 'mi.elementIndexVariable', l.elementIndexVariable);
  if (l.outputCollection) await api.setProperty(id, 'mi.outputCollection', l.outputCollection);
  if (l.outputItem) await api.setProperty(id, 'mi.outputItem', l.outputItem);
  if (l.completionCondition) await api.setProperty(id, 'mi.completionCondition', l.completionCondition);
}

async function expressionService(api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
}

async function connectorService(api: ModelerApi, id: string, name: string, connector: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'connector');
  await api.setProperty(id, 'impl.connector', connector);
}

async function scriptTask(api: ModelerApi, id: string, name: string, format: string, script: string, position: { x: number; y: number }): Promise<void> {
  await api.createShape({ type: 'scriptTask', id, name, at: position });
  await api.setProperty(id, 'script.format', format);
  await api.setProperty(id, 'script.text', script);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C21-coverage-extras', { defaultMappings: 'none' });
  for (const name of ['crm', 'echo']) await api.addConnector(name, readFileSync(join(here, 'seed', 'connectors', `${name}.json`), 'utf8'));

  // --- timer-start-duration -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'timer-start-duration', 'timerStartDuration', 'Timer start with a duration',
    'A timer start event whose timer is a plain ISO duration (timeDuration): the job is created at deployment, due one hour after it; the scenario fires it.');
  await api.createShape({ type: 'startEvent', id: 'startDuration', name: 'One hour after deployment', eventDefinition: 'timer', at: at(0, 1) });
  await api.setProperty('startDuration', 'timer.definition', { type: 'duration', value: 'PT1H' });
  await expressionService(api, 'work', 'Do the scheduled work', "${execution.setVariable('ran', true)}", at(1, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'startDuration', 'work', 'end');

  // --- potential-starters ---------------------------------------------------------------------------------------------------------
  await newProcess(api, 'potential-starters', 'potentialStarters', 'Potential starters',
    'Who may start the process is written as activiti:potentialStarter with a resourceAssignmentExpression: user(x) is a candidate user, group(y) a candidate group and a bare name is a candidate group too. Spaces are trimmed.');
  await api.setProperty('potentialStarters', 'starters.potential', 'user(carl), user( dora ), group(auditors), reviewers');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.setProperty('start', 'start.initiator', 'starter');
  await userTask(api, 'work', 'Work for ${starter}', '${starter}', at(1, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'start', 'work', 'end');

  // --- starter-sources ------------------------------------------------------------------------------------------------------------
  await newProcess(api, 'starter-sources', 'starterSources', 'Starter sources combined',
    'The attributes candidateStarterUsers / candidateStarterGroups and an activiti:potentialStarter element on the same process: the engine adds up both sources.');
  await api.setProperty('starterSources', 'starters.users', 'ann');
  await api.setProperty('starterSources', 'starters.groups', 'clerks');
  await api.setProperty('starterSources', 'starters.potential', 'user(carl), group(auditors)');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.setProperty('start', 'start.initiator', 'starter');
  await userTask(api, 'work', 'Work for ${starter}', '${starter}', at(1, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(2, 1) });
  await chain(api, 'start', 'work', 'end');

  // --- extension-ids --------------------------------------------------------------------------------------------------------------
  await newProcess(api, 'extension-ids', 'extensionIds', 'Extension ids',
    'activiti:extensionId on a user task and on a connector service task, the two activities the engine (and the modeler) know it on. It has no run-time effect: extensions (mappings) are looked up by the element id, never by the extension id. The script task and the manual task are ordinary tasks that follow.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await userTask(api, 'review', 'Review', 'ann', at(1, 1));
  await api.setModdleProperty('review', 'activiti:extensionId', 'ext-review');
  await connectorService(api, 'lookup', 'Look up the customer', 'crm.LOOKUP', at(2, 1));
  await api.setModdleProperty('lookup', 'activiti:extensionId', 'ext-lookup');
  await api.createShape({ type: 'scriptTask', id: 'tally', name: 'Tally', at: at(3, 1) });
  await api.setProperty('tally', 'script.text', '${amount * 2}');
  await api.setProperty('tally', 'script.resultVariable', 'tallied');
  await api.createShape({ type: 'manualTask', id: 'confirm', name: 'Confirm', at: at(4, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await chain(api, 'start', 'review', 'lookup', 'tally', 'confirm', 'end');
  await api.setExtensions({ properties: [{ name: 'amount', type: 'integer' }, { name: 'customerId', type: 'string' }] });
  await api.setProperty('review', 'mapping.inputs', { origin: { type: 'VALUE', value: 'found by element id' } });
  await api.setProperty('lookup', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' } });
  await api.setProperty('lookup', 'mapping.outputs', { customerName: { type: 'VARIABLE', value: 'customerName' } });
  await api.setExtensions({ properties: [{ name: 'tallied', type: 'integer' }] });

  // --- map-all-variants -----------------------------------------------------------------------------------------------------------
  await newProcess(api, 'map-all-variants', 'mapAllVariants', 'MAP_ALL_INPUTS and MAP_ALL_OUTPUTS',
    'The two one-direction mapping types on a connector and on a user task: MAP_ALL_INPUTS passes every process variable in and uses the explicit outputs, MAP_ALL_OUTPUTS uses the explicit inputs and copies everything back. The explicit mappings of the other direction are ignored.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await connectorService(api, 'echoAllInputs', 'Echo with all inputs', 'echo.EXECUTE', at(1, 1));
  await userTask(api, 'reviewAllInputs', 'Review with all inputs', 'ann', at(2, 1));
  await connectorService(api, 'lookupAllOutputs', 'Look up with all outputs', 'crm.LOOKUP', at(3, 1));
  await userTask(api, 'reviewAllOutputs', 'Review with all outputs', 'ann', at(4, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(5, 1) });
  await chain(api, 'start', 'echoAllInputs', 'reviewAllInputs', 'lookupAllOutputs', 'reviewAllOutputs', 'end');
  await api.setExtensions({
    properties: [
      { name: 'customerId', type: 'string' },
      { name: 'amount', type: 'integer' },
      { name: 'region', type: 'string' },
      { name: 'ignoredOutput', type: 'string' },
    ],
  });
  await api.setProperty('echoAllInputs', 'mapping.type', 'MAP_ALL_INPUTS');
  await api.setProperty('echoAllInputs', 'mapping.inputs', { decoy: { type: 'VALUE', value: 'never sent' } });
  await api.setProperty('echoAllInputs', 'mapping.outputs', { echoSeen: { type: 'VARIABLE', value: 'echoCount' } });
  await api.setProperty('echoAllInputs', 'constants.values', { limit: 1000, region: 'from-constant' });
  await api.setProperty('reviewAllInputs', 'mapping.type', 'MAP_ALL_INPUTS');
  await api.setProperty('reviewAllInputs', 'mapping.inputs', { decoy: { type: 'VALUE', value: 'never sent' } });
  await api.setProperty('reviewAllInputs', 'constants.values', { stage: 'review' });
  await api.setProperty('lookupAllOutputs', 'mapping.type', 'MAP_ALL_OUTPUTS');
  await api.setProperty('lookupAllOutputs', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' } });
  await api.setProperty('lookupAllOutputs', 'mapping.outputs', { ignoredOutput: { type: 'VALUE', value: 'never copied' } });
  await api.setProperty('reviewAllOutputs', 'mapping.type', 'MAP_ALL_OUTPUTS');
  await api.setProperty('reviewAllOutputs', 'mapping.inputs', { amount: { type: 'VARIABLE', value: 'amount' }, tierLabel: { type: 'VALUE', value: '${tier}' } });

  // --- expression-values ----------------------------------------------------------------------------------------------------------
  await newProcess(api, 'expression-values', 'expressionValues', 'Expression text in mapped values',
    'Text that looks like an expression travels untouched through MAP_ALL_INPUTS, but any output mapping refuses to copy a value that contains an expression, so the completion of a mapped task fails. ProcessRuntime refuses such text as a start variable, so a script task creates it.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await scriptTask(api, 'prepare', 'Prepare the template', 'javascript',
    "var open = '$' + '{';\nexecution.setVariable('template', mode == 'expression' ? 'Hello ' + open + 'name}' : 'Hello');", at(1, 1));
  await userTask(api, 'showTemplate', 'Show the template', 'ann', at(2, 1));
  await userTask(api, 'ask', 'Ask for a reply', 'ann', at(3, 1));
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'prepare', 'showTemplate', 'ask', 'end');
  await api.setExtensions({ properties: [{ name: 'mode', type: 'string' }, { name: 'template', type: 'string' }, { name: 'reply', type: 'string' }] });
  await api.setProperty('showTemplate', 'mapping.type', 'MAP_ALL_INPUTS');
  await api.setProperty('ask', 'mapping.outputs', { reply: { type: 'VARIABLE', value: 'comment' } });

  // --- mi-expression-tasks --------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-expression-tasks', 'miExpressionTasks', 'Multi-instance expression service tasks',
    'Multi-instance service tasks that run an expression: a parallel one that doubles every price and a sequential one with a completion condition. Each instance writes variables local to itself; outputDataItem / loopDataOutputRef collect them into a process variable.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await expressionService(api, 'doubleEach', 'Double each price', "${execution.setVariableLocal('doubled', price * 2)}", at(1, 1));
  await loop(api, 'doubleEach', { type: 'parallel', collection: 'prices', elementVariable: 'price', elementIndexVariable: 'slot', outputCollection: 'doubledPrices', outputItem: 'doubled' });
  await expressionService(api, 'tagEach', 'Tag each label', "${execution.setVariableLocal('seenCompleted', nrOfCompletedInstances)}", at(2, 1));
  await loop(api, 'tagEach', { type: 'sequential', collection: 'labels', elementVariable: 'label', elementIndexVariable: 'turn', outputCollection: 'tags', completionCondition: '${nrOfCompletedInstances >= limit}' });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'doubleEach', 'tagEach', 'end');

  // --- mi-connector-tasks ---------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-connector-tasks', 'miConnectorTasks', 'Multi-instance connector service tasks',
    "Multi-instance on connector service tasks: a sequential crm.LOOKUP per customer id and a parallel echo.EXECUTE with MAP_ALL_INPUTS. Inside a multi-instance the connector's outbound variables stay local to the instance (the output mapping is skipped) and are collected by outputDataItem / loopDataOutputRef.");
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await connectorService(api, 'lookupEach', 'Look up each customer', 'crm.LOOKUP', at(1, 1));
  await loop(api, 'lookupEach', { type: 'sequential', collection: 'customerIds', elementVariable: 'customerId', elementIndexVariable: 'position', outputCollection: 'customerNames', outputItem: 'customerName' });
  await connectorService(api, 'echoEach', 'Echo everything per customer', 'echo.EXECUTE', at(2, 1));
  await loop(api, 'echoEach', { type: 'parallel', collection: 'customerIds', elementVariable: 'who', elementIndexVariable: 'slot', outputCollection: 'echoCounts', outputItem: 'echoCount' });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'lookupEach', 'echoEach', 'end');
  await api.setProperty('lookupEach', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' } });
  await api.setProperty('lookupEach', 'mapping.outputs', { lastTier: { type: 'VARIABLE', value: 'tier' } });
  await api.setProperty('echoEach', 'mapping.type', 'MAP_ALL_INPUTS');

  // --- mi-script-tasks ------------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-script-tasks', 'miScriptTasks', 'Multi-instance script tasks',
    'Multi-instance script tasks: a parallel JUEL script over a collection, a sequential JavaScript script over a collection that also has a result variable (a process variable shared by the rounds) and a parallel JavaScript script driven by a loop cardinality.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await scriptTask(api, 'squareEach', 'Square each number', 'juel', "${execution.setVariableLocal('square', n * n)}", at(1, 1));
  await loop(api, 'squareEach', { type: 'parallel', collection: 'numbers', elementVariable: 'n', elementIndexVariable: 'pos', outputCollection: 'squares', outputItem: 'square' });
  await scriptTask(api, 'runningTotal', 'Add up in turn', 'javascript',
    "var before = execution.getVariable('running');\nvar total = (before == null ? 0 : before) + n;\nexecution.setVariableLocal('trail', step + ':' + total);\ntotal;", at(2, 1));
  await api.setProperty('runningTotal', 'script.resultVariable', 'running');
  await loop(api, 'runningTotal', { type: 'sequential', collection: 'numbers', elementVariable: 'n', elementIndexVariable: 'step', outputCollection: 'trails', outputItem: 'trail' });
  await scriptTask(api, 'cubeEach', 'Cube each round', 'javascript', "execution.setVariableLocal('cube', round * round * round);", at(3, 1));
  await loop(api, 'cubeEach', { type: 'parallel', cardinality: '${rounds}', elementIndexVariable: 'round', outputCollection: 'cubes', outputItem: 'cube' });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'squareEach', 'runningTotal', 'cubeEach', 'end');

  // --- mi-wait-tasks --------------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mi-wait-tasks', 'miWaitTasks', 'Multi-instance manual and receive tasks',
    'A parallel multi-instance manual task, which passes straight through once per parcel, and a parallel multi-instance receive task, where every parcel waits for its own trigger. Each loop collects its element variable (outputDataItem) into a list (loopDataOutputRef) in the order the instances complete.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'manualTask', id: 'packEach', name: 'Pack each parcel', at: at(1, 1) });
  await loop(api, 'packEach', { type: 'parallel', collection: 'parcels', elementVariable: 'parcel', outputCollection: 'packed', outputItem: 'parcel' });
  await api.createShape({ type: 'receiveTask', id: 'pickUpEach', name: 'Wait until each parcel is picked up', at: at(2, 1) });
  await loop(api, 'pickUpEach', { type: 'parallel', collection: 'parcels', elementVariable: 'parcel', outputCollection: 'pickedUp', outputItem: 'parcel' });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1) });
  await chain(api, 'start', 'packEach', 'pickUpEach', 'end');

  // --- mi-standard-form -----------------------------------------------------------------------------------------------------------
  // The panel writes a loop's collection and element as activiti:collection / activiti:elementVariable; the standard loopDataInputRef /
  // inputDataItem come only from a file. So this process is not modelled: the hand-written file is opened the way the editor opens a file
  // and exported, which proves that the modeler keeps that form (the comparison with the seed) and that the engine runs what it writes.
  const standardForm = readFileSync(join(here, 'seed', 'processes', 'mi-standard-form.bpmn20.xml'), 'utf8');
  const opened = await api.importXml(standardForm, undefined, { file: 'mi-standard-form' });
  if (opened.warnings.length > 0) throw new Error(`mi-standard-form.bpmn20.xml opened with warnings: ${opened.warnings.join('; ')}`);
}
