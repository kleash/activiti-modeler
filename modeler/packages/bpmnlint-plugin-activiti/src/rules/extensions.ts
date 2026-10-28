/**
 * Rules that read the extensions JSON of the process (`ctx.extensions`) and the rest of the project (`ctx.project`):
 * the cross-document rules L8 to L11, L21 to L25, L36, L37 and the engine findings about mappings.
 */
import { DMN_DECISION_IMPLEMENTATION, DMN_TABLE_CONSTANT } from '@activiti-modeler/bpmn-js-activiti/support-matrix';
import { VARIABLE_TYPES, keyedElementIds, type ProcessExtension, type ProcessVariablesMapping } from '@activiti-modeler/activiti-project';

import { requiredInputNames, resolveDecision } from '../dmn';
import { defineRule, onDefinitions, onTypes, type RuleApi } from '../define';
import { allFlowElements, bool, child, extensionValues, is, isBlank, label, list, processesOf, str } from '../model';
import type { ME } from '../types';

const ALL_INPUTS = new Set(['MAP_ALL', 'MAP_ALL_INPUTS']);
const upper = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase() : '');

/** The process extension for the process a node lives in, or undefined when the extensions are not known. */
function extensionOf(api: RuleApi, node: ME): ProcessExtension | undefined {
  if (!api.ctx.extensions) return undefined;
  let process: ME | undefined = node;
  while (process && !is(process, 'bpmn:Process')) process = process.$parent;
  return (process?.id ? api.ctx.extensions.extensions[process.id] : undefined) ?? { properties: {}, mappings: {}, constants: {} };
}

const mappingOf = (api: RuleApi, node: ME): ProcessVariablesMapping | undefined => (node.id ? extensionOf(api, node)?.mappings[node.id] : undefined);
const hasEntry = (api: RuleApi, node: ME): boolean => {
  const ext = extensionOf(api, node);
  return !!node.id && !!ext && (node.id in ext.mappings || node.id in ext.constants);
};

const isConnectorTask = (node: ME): boolean => is(node, 'bpmn:ServiceTask') && !isBlank(str(node, 'implementation')) && str(node, 'implementation') !== '##WebService';
const isDecisionTask = (node: ME): boolean => is(node, 'bpmn:ServiceTask') && str(node, 'implementation') === DMN_DECISION_IMPLEMENTATION;

/** Splits `crm.LOOKUP` into the connector and the action. */
function splitImplementation(implementation: string): { connector: string; action?: string } {
  const dot = implementation.indexOf('.');
  return dot < 0 ? { connector: implementation } : { connector: implementation.slice(0, dot), action: implementation.slice(dot + 1) };
}

/** The type the connector declares for the output an output mapping reads (`{ type }`), when the connector is in the project. */
function typeOfConnectorOutput(api: RuleApi, task: ME | undefined, output: { type?: unknown; value?: unknown } | undefined): { type?: string } {
  const implementation = task ? str(task, 'implementation') : undefined;
  if (!implementation || !output || String(output.type).toUpperCase() !== 'VARIABLE') return {};
  const { connector, action } = splitImplementation(implementation);
  const def = api.ctx.project?.connectors?.find((c) => c.name === connector)?.actions[action ?? ''];
  const type = def?.outputs.find((o) => o.name === output.value || o.id === output.value)?.type;
  return type && (VARIABLE_TYPES as readonly string[]).includes(type) ? { type } : {};
}

const decisionTableOf = (api: RuleApi, task: ME): string | undefined => {
  const value = task.id ? extensionOf(api, task)?.constants[task.id]?.[DMN_TABLE_CONSTANT]?.value : undefined;
  return typeof value === 'string' ? value : undefined;
};

const messageNameOf = (definition: ME): string | undefined => {
  const ref = definition.get('messageRef') as ME | undefined;
  return ref ? str(ref, 'name') : undefined;
};

const ext = (...inner: string[]): string => `<extensionElements>${inner.join('')}</extensionElements>`;
const EXT = (processEntry: Record<string, unknown>): Record<string, unknown> => ({ properties: {}, mappings: {}, constants: {}, ...processEntry });
const CRM_ACTIONS = { LOOKUP: { id: 'LOOKUP', inputs: [{ id: 'customerId', name: 'customerId', required: true }], outputs: [{ id: 'tier', name: 'tier' }] } };
/** The connector as ADR 0003 has it: the descriptor holds only the runtime's fields, the template version is in project.json. */
const CONNECTOR_FILES = {
  'connectors/crm.json': JSON.stringify({ id: 'crm', name: 'crm', actions: CRM_ACTIONS }),
  'project.json': JSON.stringify({ name: 'fixture', connectors: { crm: { version: '2' } } }),
};
/** A descriptor that still carries the version itself (written by an older modeler or by hand) is read as before. */
const LEGACY_CONNECTOR_FILES = { 'connectors/crm.json': JSON.stringify({ id: 'crm', name: 'crm', version: '2', actions: CRM_ACTIONS }) };
const DMN_FILES = {
  'processes/rules.dmn': `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="rules" namespace="urn:r"><inputData id="in_age" name="age"><variable id="v1" name="age" typeRef="number"/></inputData><decision id="grade" name="grade"><variable id="gv" name="grade" typeRef="string"/><informationRequirement id="ir"><requiredInput href="#in_age"/></informationRequirement><decisionTable id="t"><input id="i1"><inputExpression typeRef="number"><text>age</text></inputExpression></input><input id="i2"><inputExpression typeRef="string"><text>region</text></inputExpression></input><output id="o1" name="grade" typeRef="string"/></decisionTable></decision></definitions>`,
};
const decisionTask = (id = 'dt'): string => `<serviceTask id="${id}" name="Decide" implementation="${DMN_DECISION_IMPLEMENTATION}"/>`;
const tableConstant = (task: string, value: string): Record<string, unknown> => ({ constants: { [task]: { [DMN_TABLE_CONSTANT]: { value } } } });

export const extensionRules = [
  defineRule({
    id: 'extensions-unknown-process',
    tag: 'L10',
    severity: 'error',
    title: 'The extensions file configures a process that is not in this file',
    why: 'Activiti looks the extension up by the process key (`extensions.<processId>`). An entry for a key that is not a process of the file is never read: its mappings and properties are silently inert.',
    evidence: ['R1 §6.2.1', 'R1 §7.1 L10'],
    howToFix: 'Rename the key to the process id, or delete the entry (the quick fix does). The modeler renames it together with the process.',
    quickFix: 'remove-process-entry',
    serverKeys: ['extensions-unknown-process'],
    needs: ['extensions'],
    check: onDefinitions((definitions, api) => {
      if (!api.ctx.extensions) return;
      const processes = processesOf(definitions);
      const ids = new Set(processes.map((p) => p.id));
      for (const key of Object.keys(api.ctx.extensions.extensions)) {
        if (!ids.has(key) && processes[0]) api.report(processes[0], `The extensions file has an entry for the process "${key}", which is not in this file`, { data: { key } });
      }
    }),
    bad: [{ ext: { extensions: { ghost: EXT({}) }, id: 'x' }, ids: ['p'] }],
    good: [{ ext: EXT({}) }],
  }),
  defineRule({
    id: 'extensions-unknown-element',
    tag: 'L22',
    severity: 'error',
    title: 'A mapping or constant belongs to an element that does not exist',
    why: 'Mappings, constants, templates and assignments are keyed by BPMN element id. An entry whose key is not an element of the process is never applied (the element was deleted or renamed outside the modeler).',
    evidence: ['R1 §6.2.4', 'R1 §7.1 L10', 'ADR 0006'],
    howToFix: 'Remove the entry, or rename the key to the id of the element it was meant for.',
    quickFix: 'remove-mapping-key',
    serverKeys: ['extensions-unknown-element'],
    needs: ['extensions'],
    check: onTypes('bpmn:Process', (process, api) => {
      const entry = extensionOf(api, process);
      if (!entry || !api.ctx.extensions?.extensions[process.id ?? '']) return;
      const ids = new Set(allFlowElements(process).map((e) => e.id));
      for (const key of keyedElementIds(entry)) {
        if (!ids.has(key)) api.report(process, `The extensions of ${process.id} have an entry for the element "${key}", which does not exist`, { data: { key, processId: process.id } });
      }
    }),
    bad: [{ body: '<task id="t"/>', ext: EXT({ mappings: { gone: { mappingType: 'MAP_ALL' } } }), ids: ['p'] }],
    good: [{ body: '<task id="t"/>', ext: EXT({ mappings: { t: { mappingType: 'MAP_ALL' } } }) }],
  }),
  defineRule({
    id: 'property-type-invalid',
    tag: 'L11',
    severity: 'error',
    title: 'A process variable has a type the runtime does not know',
    why: 'The runtime knows boolean, string, integer, bigdecimal, json, file, folder, content, date, datetime and array. A property of another type with a default value throws a NullPointerException when the process starts; without a default its validation falls back to json.',
    evidence: ['R1 §6.2.3', 'R1 §7.1 L11', 'engine run t17v'],
    howToFix: 'Pick one of the listed types in **Process variables**.',
    entry: 'variables.list',
    needs: ['extensions'],
    check: onTypes('bpmn:Process', (process, api) => {
      const entry = extensionOf(api, process);
      for (const property of Object.values(entry?.properties ?? {})) {
        if (!(VARIABLE_TYPES as readonly string[]).includes(String(property.type))) {
          api.report(process, `Process variable "${property.name}" has the type "${String(property.type)}"${property.value !== undefined ? ' and a default value: the process cannot start (NullPointerException)' : ''}`);
        }
      }
    }),
    bad: [{ ext: EXT({ properties: { a: { id: 'a', name: 'amount', type: 'number', value: 1 } } }), ids: ['p'] }],
    good: [{ ext: EXT({ properties: { a: { id: 'a', name: 'amount', type: 'integer', value: 1 } } }) }],
  }),
  defineRule({
    id: 'output-target-undeclared',
    tag: 'L21',
    severity: 'warn',
    title: 'An output mapping writes a variable that is not declared in the process properties',
    why: 'The runtime applies an output mapping only when its target is a declared property or an already existing variable; otherwise the output is dropped silently. The modeler declares the targets it creates.',
    evidence: ['R1 §6.2.4', 'engine-findings 16', 'ADR 0003'],
    howToFix: 'Declare the variable in **Process variables** (the quick fix does), or make sure an earlier step creates it.',
    quickFix: 'declare-output-target',
    serverKeys: ['extensions-undeclared-output'],
    needs: ['extensions'],
    check: onTypes('bpmn:Process', (process, api) => {
      const entry = extensionOf(api, process);
      if (!entry) return;
      const declared = new Set(Object.values(entry.properties).map((p) => p.name));
      const elements = new Map(allFlowElements(process).map((e) => [e.id, e]));
      for (const [elementId, mapping] of Object.entries(entry.mappings)) {
        for (const target of Object.keys(mapping.outputs ?? {})) {
          if (declared.has(target)) continue;
          const element = elements.get(elementId);
          api.report(element ?? process, `The output "${target}" of ${elementId} is not declared in the process variables: Activiti drops it unless the variable exists`, { data: { target, elementId, processId: process.id, ...typeOfConnectorOutput(api, element, mapping.outputs?.[target]) } });
        }
      }
    }),
    bad: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', ext: EXT({ mappings: { s: { outputs: { tier: { type: 'VARIABLE', value: 'tier' } } } } }), ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', ext: EXT({ properties: { t: { id: 't', name: 'tier', type: 'string' } }, mappings: { s: { outputs: { tier: { type: 'VARIABLE', value: 'tier' } } } } }) }],
  }),
  defineRule({
    id: 'extensions-invalid-structure',
    tag: 'X',
    severity: 'error',
    title: 'The extensions file has a mapping the runtime cannot read',
    why: 'The runtime reads the extensions with Jackson and fails the first process start with `Unable to read process extension` when a mapping type is not MAP_ALL / MAP_ALL_INPUTS / MAP_ALL_OUTPUTS, an input or output type is not VARIABLE / VALUE / JSONPATCH, or a constant is a bare value instead of `{ "value": ... }`. Deployment does not notice.',
    evidence: ['R1 §6.2.4', 'engine run (constants given as a bare string)'],
    howToFix: 'Fix the entry in the extensions JSON view, or re-enter it in the **Input / output mapping** group.',
    needs: ['extensions'],
    check: onTypes('bpmn:Process', (process, api) => {
      const entry = extensionOf(api, process);
      if (!entry) return;
      for (const [elementId, mapping] of Object.entries(entry.mappings)) {
        if (mapping.mappingType !== undefined && !['MAP_ALL', 'MAP_ALL_INPUTS', 'MAP_ALL_OUTPUTS'].includes(upper(mapping.mappingType))) api.report(process, `Mapping of ${elementId}: mappingType "${String(mapping.mappingType)}" is not MAP_ALL, MAP_ALL_INPUTS or MAP_ALL_OUTPUTS`);
        for (const side of ['inputs', 'outputs'] as const) {
          for (const [name, value] of Object.entries(mapping[side] ?? {})) {
            if (typeof value !== 'object' || value === null || !['VARIABLE', 'VALUE', 'JSONPATCH'].includes(upper(value.type))) api.report(process, `Mapping of ${elementId}: ${side === 'inputs' ? 'input' : 'output'} "${name}" needs a type of VARIABLE, VALUE or JSONPATCH`);
          }
        }
      }
      for (const [elementId, constants] of Object.entries(entry.constants)) {
        for (const [name, value] of Object.entries(constants)) {
          if (typeof value !== 'object' || value === null || !('value' in value)) api.report(process, `Constant "${name}" of ${elementId} must be written as { "value": ... }`);
        }
      }
    }),
    bad: [
      { ext: EXT({ mappings: { t: { mappingType: 'ALL' } } }), ids: ['p'] },
      { ext: EXT({ constants: { t: { greeting: 'hello' } } }), ids: ['p'] },
    ],
    good: [{ ext: EXT({ mappings: { t: { mappingType: 'MAP_ALL', inputs: { a: { type: 'variable', value: 'a' } } } }, constants: { t: { greeting: { value: 'hello' } } } }) }],
  }),
  defineRule({
    id: 'json-property-without-default',
    tag: 'X',
    severity: 'info',
    title: 'A json (or unknown type) property without a default value',
    why: 'Such a property creates a process variable holding JSON null when the process starts; it then travels with `MAP_ALL` and shows up in every connector call (engine finding 4).',
    evidence: ['engine-findings 4'],
    howToFix: 'Give the property an explicit default, for example `{}`.',
    entry: 'variables.list',
    needs: ['extensions'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const property of Object.values(extensionOf(api, process)?.properties ?? {})) {
        if (property.type === 'json' && property.value === undefined) api.report(process, `Process variable "${property.name}" is json without a default: it starts as null`);
      }
    }),
    bad: [{ ext: EXT({ properties: { a: { id: 'a', name: 'profile', type: 'json' } } }), ids: ['p'] }],
    good: [{ ext: EXT({ properties: { a: { id: 'a', name: 'profile', type: 'json', value: {} } } }) }],
  }),
  defineRule({
    id: 'missing-mapping',
    tag: 'L9',
    severity: 'warn',
    title: 'A user task, call activity, message catch event or connector task without an input / output mapping',
    why: 'Variables flow in and out of these elements only through the extensions mapping: a connector gets no inputs and its outputs are dropped, a user task has no task-local variables and the variables it is completed with never reach the process, a call activity gets nothing back from its child, a message payload is dropped. A task works without one only when it needs no variables.',
    evidence: ['R1 §0.3-17', 'R1 §6.2.4', 'R1 §7.1 L8 L9', 'engine-findings 1'],
    howToFix: 'Add a mapping in the **Input / output mapping** group; `MAP_ALL` passes everything (the quick fix adds it).',
    quickFix: 'add-map-all',
    entry: 'mapping.type',
    needs: ['extensions'],
    check: (node, api) => {
      if (!api.ctx.extensions || !node.id) return;
      const messageCatch = (is(node, 'bpmn:IntermediateCatchEvent') || is(node, 'bpmn:BoundaryEvent')) && list(node, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition'));
      const applies = is(node, 'bpmn:UserTask') || is(node, 'bpmn:CallActivity') || messageCatch || isConnectorTask(node);
      if (applies && !hasEntry(api, node)) api.report(node, `${label(node)} has no entry in the extensions file: ${is(node, 'bpmn:UserTask') ? 'its completion variables are not copied to the process' : is(node, 'bpmn:CallActivity') ? 'nothing comes back from the called process' : messageCatch ? 'the message payload is dropped' : 'the connector gets no inputs and its outputs are dropped'}`);
    },
    bad: [{ body: '<userTask id="u"/>', ext: EXT({}), ids: ['u'] }, { body: '<serviceTask id="s" name="Look up" implementation="crm.LOOKUP"/>', ext: EXT({}), ids: ['s'] }],
    good: [{ body: '<userTask id="u"/>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL' } } }) }, { body: '<userTask id="u"/>' }],
  }),
  defineRule({
    id: 'signal-catch-has-mapping',
    tag: 'X',
    severity: 'warn',
    title: 'A signal catch event has a mapping',
    why: 'A caught signal sets the throwing execution\'s variables on the catcher as process variables, with or without a mapping (the modeler does not give a signal catch event a default mapping for that reason). Unlike messages there is no mapping on a signal catch event, so an entry for it is never applied: a renaming output mapping, for example, renames nothing and the signal\'s own variable names arrive as they are.',
    evidence: ['engine-findings 37', 'engine-findings C20.2'],
    howToFix: 'Remove the mapping; read the signal variables directly.',
    quickFix: 'remove-mapping-key',
    needs: ['extensions'],
    check: (node, api) => {
      if (!(is(node, 'bpmn:IntermediateCatchEvent') || is(node, 'bpmn:BoundaryEvent')) || !list(node, 'eventDefinitions').some((d) => is(d, 'bpmn:SignalEventDefinition'))) return;
      if (mappingOf(api, node)) api.report(node, `${label(node)} is a signal catch event: Activiti does not apply a mapping to it`, { data: { key: node.id, processId: undefined } });
    },
    bad: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>', ext: EXT({ mappings: { c: { mappingType: 'MAP_ALL' } } }), ids: ['c'] }],
    good: [{ head: '<signal id="sg" name="go"/>', body: '<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>', ext: EXT({}) }],
  }),
  defineRule({
    id: 'parallel-multi-instance-user-task-map-all',
    tag: 'X',
    severity: 'warn',
    title: 'MAP_ALL on a parallel multi-instance user task',
    why: '`MAP_ALL` and `MAP_ALL_INPUTS` hand a task every variable of its execution. On a parallel multi-instance user task those include the loop variables of the instance (`nrOfInstances`, `nrOfCompletedInstances`, `nrOfActiveInstances`, `loopCounter`) and the output collection; completing the task writes them back as local variables of the instance, and the multi-instance bookkeeping never sees the instances complete: the process instance stays active with nothing active and the flow never leaves the task. The completion variables of a multi-instance task stay local to the instance and are collected by `outputDataItem` whatever the mapping, so no mapping (or `MAP_ALL_OUTPUTS`) loses nothing. A sequential multi-instance user task is not affected.',
    evidence: ['engine-findings C20.1', 'C20-claims map-all-multi-instance'],
    howToFix: 'Set the mapping type of the task to `MAP_ALL_OUTPUTS` (what the modeler gives a new multi-instance user task), or remove the mapping.',
    entry: 'mapping.type',
    needs: ['extensions'],
    check: onTypes('bpmn:UserTask', (task, api) => {
      const loop = child(task, 'loopCharacteristics');
      if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics') || bool(loop, 'isSequential') === true) return;
      const type = upper(mappingOf(api, task)?.mappingType);
      if (ALL_INPUTS.has(type)) api.report(task, `${label(task)} is a parallel multi-instance user task with ${type}: the instance never completes`);
    }),
    bad: [
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL' } } }), ids: ['u'] },
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics isSequential="false"><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL_INPUTS' } } }), ids: ['u'] },
    ],
    good: [
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL_OUTPUTS' } } }) },
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ext: EXT({}) },
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics isSequential="true"><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL' } } }) },
      { body: '<userTask id="u"/>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL' } } }) },
    ],
  }),
  defineRule({
    id: 'message-event-subprocess-multi-instance',
    tag: 'X',
    severity: 'warn',
    title: 'An interrupting message event sub process in a process with a multi-instance activity',
    why: 'When the message of an interrupting event sub process arrives while a multi-instance activity (a user task, a call activity or a sub process, parallel or sequential) is active, cancelling its executions fails with `PersistenceException ... ACT_FK_EXE_PARENT` (a referential integrity violation), the whole delivery is rolled back and the message is not consumed. Without an active multi-instance activity the same event sub process works, and so does an interrupting message boundary event on the multi-instance activity. Only event sub processes directly under the process are armed by Activiti 9.0.0 at all.',
    evidence: ['engine-findings C20.3', 'C20-claims interrupt-multi-instance'],
    howToFix: 'Use an interrupting message boundary event on the multi-instance activity (or its sub process) instead, or make the event sub process non-interrupting.',
    entry: 'event.definition',
    check: onTypes('bpmn:StartEvent', (start, api) => {
      const eventSubProcess = start.$parent;
      if (!eventSubProcess || !is(eventSubProcess, 'bpmn:SubProcess') || bool(eventSubProcess, 'triggeredByEvent') !== true || !is(eventSubProcess.$parent, 'bpmn:Process')) return;
      if (bool(start, 'isInterrupting') === false || !list(start, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition'))) return;
      const inside = new Set(allFlowElements(eventSubProcess));
      const loops = allFlowElements(eventSubProcess.$parent!).filter((e) => e !== eventSubProcess && !inside.has(e) && is(child(e, 'loopCharacteristics'), 'bpmn:MultiInstanceLoopCharacteristics'));
      if (loops.length > 0) api.report(start, `${eventSubProcess.id} interrupts on a message, and ${loops.map((l) => l.id).join(', ')} ${loops.length > 1 ? 'are' : 'is'} multi-instance: delivering the message while it is active fails with ACT_FK_EXE_PARENT`);
    }),
    bad: [
      { head: '<message id="m" name="stop"/>', body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><subProcess id="esp" triggeredByEvent="true"><startEvent id="es"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>', ids: ['es'] },
      { head: '<message id="m" name="stop"/>', body: '<subProcess id="each"><multiInstanceLoopCharacteristics isSequential="true"><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics><userTask id="inner"/></subProcess><subProcess id="esp" triggeredByEvent="true"><startEvent id="es" isInterrupting="true"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>', ids: ['es'] },
    ],
    good: [
      { head: '<message id="m" name="stop"/>', body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><subProcess id="esp" triggeredByEvent="true"><startEvent id="es" isInterrupting="false"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>' },
      { head: '<message id="m" name="stop"/>', body: '<userTask id="u"/><subProcess id="esp" triggeredByEvent="true"><startEvent id="es"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>' },
      { head: '<message id="m" name="stop"/>', body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><boundaryEvent id="b" attachedToRef="u"><messageEventDefinition messageRef="m"/></boundaryEvent>' },
    ],
  }),
  defineRule({
    id: 'user-task-map-all-copies-assignee',
    tag: 'X',
    severity: 'info',
    title: 'MAP_ALL on a user task',
    why: 'When a task is completed Activiti offers `sys_task_assignee` and every input-mapped task variable to the output mapping, so `MAP_ALL` / `MAP_ALL_OUTPUTS` copies them (and all the input variables) into the process as well. Usually harmless, sometimes surprising.',
    evidence: ['engine-findings 1'],
    howToFix: 'List the outputs you need instead of `MAP_ALL`.',
    entry: 'mapping.type',
    needs: ['extensions'],
    check: onTypes('bpmn:UserTask', (task, api) => {
      const type = upper(mappingOf(api, task)?.mappingType);
      if (type === 'MAP_ALL' || type === 'MAP_ALL_OUTPUTS') api.report(task, `${label(task)} uses ${type}: sys_task_assignee and the input variables are copied into the process too`);
    }),
    bad: [{ body: '<userTask id="u"/>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL' } } }), ids: ['u'] }],
    good: [{ body: '<userTask id="u"/>', ext: EXT({ mappings: { u: { mappingType: 'MAP_ALL_INPUTS' } } }) }],
  }),
  // --- connectors
  defineRule({
    id: 'connector-bean-unknown',
    tag: 'L8',
    severity: 'error',
    title: 'A service task calls a connector that is not in the project',
    why: 'A service task with `implementation="<connector>.<ACTION>"` runs the Spring bean of that name; if there is none, the task fails at run time with `NoSuchBeanDefinitionException` (nothing checks it at deployment). The project\'s `connectors/` folder is the catalog of the beans the application provides.',
    evidence: ['R1 §6.1', 'R1 §7.1 L8'],
    howToFix: 'Add the connector to `connectors/` (Connector catalog editor), or fix the name. A bean without a descriptor can be added there too.',
    entry: 'impl.connector',
    needs: ['project'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const connectors = api.ctx.project?.connectors;
      const implementation = str(task, 'implementation');
      if (!connectors || !isConnectorTask(task) || isDecisionTask(task) || !implementation) return;
      const { connector } = splitImplementation(implementation);
      if (!connectors.some((c) => c.name === connector)) api.report(task, `${label(task)} calls "${implementation}", but the project has no connector named "${connector}"`);
    }),
    bad: [{ body: '<serviceTask id="s" implementation="mailer.SEND"/>', files: CONNECTOR_FILES, ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', files: CONNECTOR_FILES }, { body: `<serviceTask id="s" implementation="${DMN_DECISION_IMPLEMENTATION}"/>`, files: CONNECTOR_FILES }, { body: '<serviceTask id="s" implementation="mailer.SEND"/>' }],
  }),
  defineRule({
    id: 'connector-action-unknown',
    tag: 'L24',
    severity: 'error',
    title: 'A service task calls an action the connector does not define',
    why: 'The connector exists in the project but has no action of that name.',
    evidence: ['R1 §6.1', 'FEATURE_MATRIX §D L24'],
    howToFix: 'Pick one of the connector\'s actions, or add the action to its definition.',
    entry: 'impl.connector',
    needs: ['project'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const connectors = api.ctx.project?.connectors;
      const implementation = str(task, 'implementation');
      if (!connectors || !isConnectorTask(task) || isDecisionTask(task) || !implementation) return;
      const { connector, action } = splitImplementation(implementation);
      const def = connectors.find((c) => c.name === connector);
      if (def && (!action || !(action in def.actions))) api.report(task, `${label(task)} calls "${implementation}", but connector ${connector} has no action "${action ?? ''}" (it has ${Object.keys(def.actions).join(', ') || 'none'})`);
    }),
    bad: [{ body: '<serviceTask id="s" implementation="crm.DELETE"/>', files: CONNECTOR_FILES, ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', files: CONNECTOR_FILES }],
  }),
  defineRule({
    id: 'connector-required-input-unmapped',
    tag: 'L24',
    severity: 'error',
    title: 'A required input of a connector action is not mapped',
    why: 'The connector gets only the inputs the mapping provides (and the constants). A required input that is missing makes the connector fail or return nothing.',
    evidence: ['R1 §6.2.4', 'FEATURE_MATRIX §D L24'],
    howToFix: 'Map the input in **Input / output mapping**, or add `MAP_ALL`.',
    entry: 'mapping.inputs',
    needs: ['project', 'extensions'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const connectors = api.ctx.project?.connectors;
      const implementation = str(task, 'implementation');
      if (!connectors || !api.ctx.extensions || !isConnectorTask(task) || isDecisionTask(task) || !implementation || !task.id) return;
      const { connector, action } = splitImplementation(implementation);
      const def = connectors.find((c) => c.name === connector)?.actions[action ?? ''];
      if (!def) return;
      const mapping = mappingOf(api, task);
      if (ALL_INPUTS.has(upper(mapping?.mappingType))) return;
      const provided = new Set([...Object.keys(mapping?.inputs ?? {}), ...Object.keys(extensionOf(api, task)?.constants[task.id] ?? {})]);
      const missing = def.inputs.filter((i) => i.required && !provided.has(i.name));
      if (missing.length > 0) api.report(task, `${label(task)}: the required input ${missing.map((m) => `"${m.name}"`).join(', ')} of ${implementation} is not mapped`);
    }),
    bad: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', files: CONNECTOR_FILES, ext: EXT({ mappings: { s: { inputs: {} } } }), ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', files: CONNECTOR_FILES, ext: EXT({ mappings: { s: { inputs: { customerId: { type: 'VARIABLE', value: 'customerId' } } } } }) }, { body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', files: CONNECTOR_FILES, ext: EXT({ mappings: { s: { mappingType: 'MAP_ALL' } } }) }],
  }),
  defineRule({
    id: 'connector-task-missing-name',
    tag: 'L15',
    severity: 'warn',
    title: 'A connector service task without a name',
    why: 'The name of a connector task becomes `IntegrationContext.clientName` (JUEL-evaluated). A connector that logs or routes by client name sees an empty one.',
    evidence: ['R1 §6.1', 'R1 §7.1 L15'],
    howToFix: 'Name the task.',
    entry: 'general.name',
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (isConnectorTask(task) && isBlank(str(task, 'name'))) api.report(task, `Service task ${task.id} calls ${str(task, 'implementation')} but has no name`);
    }),
    bad: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>', ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" name="Look up" implementation="crm.LOOKUP"/>' }],
  }),
  defineRule({
    id: 'connector-template-outdated',
    tag: 'L36',
    severity: 'warn',
    title: 'A connector task uses an older version of its template',
    why: 'Applying a connector template records the template id and version on the element (`activiti:templateId`, `activiti:templateVersion`). When the version of the connector (`project.json`, `connectors.<name>.version`) is newer, the task\'s inputs and outputs may no longer match it.',
    evidence: ['FEATURE_MATRIX §D L36'],
    howToFix: 'Update the task from the template (**Update** in the template banner of the properties panel).',
    needs: ['project'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const connectors = api.ctx.project?.connectors;
      // a declared attribute of the moddle (a plain property), or an extension attribute in `$attrs` when the descriptor does not know it
      const attrs = (task.$attrs ?? {}) as Record<string, string>;
      const version = str(task, 'templateVersion') ?? attrs['activiti:templateVersion'];
      const implementation = str(task, 'implementation');
      if (!connectors || !version || !implementation) return;
      const def = connectors.find((c) => c.name === splitImplementation(implementation).connector);
      if (def?.version && def.version !== version) api.report(task, `${label(task)} was created from version ${version} of the ${def.name} template; the connector is now at version ${def.version}`);
    }),
    bad: [
      { body: '<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="1"/>', files: CONNECTOR_FILES, ids: ['s'] },
      { body: '<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="1"/>', files: LEGACY_CONNECTOR_FILES, ids: ['s'], note: 'the version is still in the descriptor' },
    ],
    good: [
      { body: '<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="2"/>', files: CONNECTOR_FILES },
      { body: '<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="2"/>', files: LEGACY_CONNECTOR_FILES },
    ],
  }),
  // --- decision tasks
  defineRule({
    id: 'decision-task-unknown-decision',
    tag: 'L23',
    severity: 'error',
    title: 'A decision task has no decision, or one that is not in the project',
    why: 'A Decision task is a service task for `dmn-connector.EXECUTE_TABLE`; the constant `_activiti_dmn_table_` names the decision (a decision id, a DMN file name or a definitions name). Without it, or with a name no DMN file of the deployment resolves, the connector fails when the task runs.',
    evidence: ['ADR 0004', 'FEATURE_MATRIX §D L23'],
    howToFix: 'Choose the decision in the **Decision** group.',
    entry: 'decision.table',
    needs: ['extensions', 'project'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (!isDecisionTask(task) || !api.ctx.extensions) return;
      const table = decisionTableOf(api, task);
      if (isBlank(table)) {
        api.report(task, `${label(task)} does not name a decision (constant ${DMN_TABLE_CONSTANT})`);
        return;
      }
      const dmn = api.ctx.project?.dmn;
      if (dmn && !resolveDecision(dmn, table!)) api.report(task, `${label(task)} uses the decision "${table}", which no DMN file of the project defines`);
    }),
    bad: [{ body: decisionTask(), ext: EXT({}), ids: ['dt'] }, { body: decisionTask(), ext: EXT(tableConstant('dt', 'nope')), files: DMN_FILES, ids: ['dt'] }],
    good: [{ body: decisionTask(), ext: EXT(tableConstant('dt', 'grade')), files: DMN_FILES }],
  }),
  defineRule({
    id: 'decision-input-unmapped',
    tag: 'L37',
    severity: 'warn',
    title: 'A decision input is not mapped',
    why: 'A decision input that the task does not provide is `null` in FEEL, and a comparison with `null` never matches: the mistake shows up as "no rule matched", not as an error.',
    evidence: ['ADR 0004', 'docs/user-guide/dmn-conventions.md (Inputs and null)', 'FEATURE_MATRIX §D L37'],
    howToFix: 'Map every input name the decision reads (the Decision group offers them), or use `MAP_ALL_INPUTS`.',
    entry: 'mapping.inputs',
    needs: ['extensions', 'project'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (!isDecisionTask(task) || !api.ctx.extensions || !task.id) return;
      const table = decisionTableOf(api, task);
      const dmn = api.ctx.project?.dmn;
      const resolved = table && dmn ? resolveDecision(dmn, table) : undefined;
      if (!resolved?.decision) return;
      const mapping = mappingOf(api, task);
      if (ALL_INPUTS.has(upper(mapping?.mappingType))) return;
      const provided = new Set([...Object.keys(mapping?.inputs ?? {}), ...Object.keys(extensionOf(api, task)?.constants[task.id] ?? {})]);
      const missing = requiredInputNames(resolved.file, resolved.decision.id).filter((n) => !provided.has(n));
      if (missing.length > 0) api.report(task, `${label(task)}: the decision reads ${missing.map((m) => `"${m}"`).join(', ')}, which the task does not map; it evaluates as null`);
    }),
    bad: [{ body: decisionTask(), ext: EXT({ ...tableConstant('dt', 'grade'), mappings: { dt: { inputs: { age: { type: 'VARIABLE', value: 'age' } } } } }), files: DMN_FILES, ids: ['dt'] }],
    good: [{ body: decisionTask(), ext: EXT({ ...tableConstant('dt', 'grade'), mappings: { dt: { inputs: { age: { type: 'VARIABLE', value: 'age' }, region: { type: 'VARIABLE', value: 'region' } } } } }), files: DMN_FILES }],
  }),
  // --- call activities
  defineRule({
    id: 'called-element-invalid',
    tag: 'L25',
    severity: 'error',
    title: 'A call activity without a valid called element',
    why: '`calledElement` is the key (id) of the process to call, or an expression. Empty, it fails at run time; a key with spaces or other characters a process id cannot have never matches.',
    evidence: ['R1 §4.6', 'FEATURE_MATRIX §D L25'],
    howToFix: 'Pick the process in the **Called element** group.',
    entry: 'call.calledElement',
    check: onTypes('bpmn:CallActivity', (call, api) => {
      const key = str(call, 'calledElement');
      if (isBlank(key)) api.report(call, `Call activity ${call.id} has no called element`);
      else if (!key!.includes('{') && !/^[\p{L}_][\p{L}\p{N}._\-·]*$/u.test(key!.trim())) api.report(call, `"${key}" is not a valid process key (letters, digits, "_", "-" and "." only)`);
    }),
    bad: [{ body: '<callActivity id="c"/>', ids: ['c'] }, { body: '<callActivity id="c" calledElement="my process"/>', ids: ['c'] }],
    good: [{ body: '<callActivity id="c" calledElement="child"/><callActivity id="d" calledElement="${key}"/>' }],
  }),
  defineRule({
    id: 'called-element-unknown',
    tag: 'L25',
    severity: 'warn',
    title: 'A call activity calls a process that is not in the project',
    why: 'The called process must be deployed with this one (or exist in the engine). If no file of the project defines a process with that key the call fails at run time with "no processes deployed with key".',
    evidence: ['R1 §4.6', 'FEATURE_MATRIX §D L25'],
    howToFix: 'Add the process to the project, fix the key, or ignore the warning if the process is deployed elsewhere.',
    entry: 'call.calledElement',
    needs: ['project'],
    check: onTypes('bpmn:CallActivity', (call, api) => {
      const key = str(call, 'calledElement')?.trim();
      const processes = api.ctx.project?.processes;
      // an invalid key is reported by called-element-invalid
      if (!key || key.includes('{') || !processes || !/^[\p{L}_][\p{L}\p{N}._\-·]*$/u.test(key)) return;
      const local = processesOf(api.definitions).some((p) => p.id === key);
      if (!local && !processes.some((p) => p.id === key)) api.report(call, `Call activity ${call.id} calls the process "${key}", which no file of the project defines`);
    }),
    bad: [{ body: '<callActivity id="c" calledElement="child"/>', files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="other" isExecutable="true"/></definitions>' }, ids: ['c'] }],
    good: [{ body: '<callActivity id="c" calledElement="other"/>', files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="other" isExecutable="true"/></definitions>' } }],
  }),
  defineRule({
    id: 'call-activity-called-process-without-extensions',
    tag: 'X',
    severity: 'warn',
    title: 'Inputs are mapped into a called process that has no extensions entry',
    why: 'The mapped inputs of a call activity reach the child only when the child has an entry in an extensions file (possibly empty); otherwise the child starts without them, silently. `activiti:in` is not affected.',
    evidence: ['engine-findings C11.2'],
    howToFix: 'Give the called process an extensions file (the modeler writes one for every process).',
    needs: ['project', 'extensions'],
    check: onTypes('bpmn:CallActivity', (call, api) => {
      const key = str(call, 'calledElement')?.trim();
      const project = api.ctx.project;
      const mapping = mappingOf(api, call);
      if (!key || key.includes('{') || !project?.extensions || !mapping || !call.id) return;
      const hasInputs = Object.keys(mapping.inputs ?? {}).length > 0 || ALL_INPUTS.has(upper(mapping.mappingType)) || Object.keys(extensionOf(api, call)?.constants[call.id] ?? {}).length > 0;
      const target = project.processes.find((p) => p.id === key && p.path !== api.ctx.path);
      if (hasInputs && target && !project.extensions[target.path]?.extensions[key]) api.report(call, `${label(call)} maps inputs into "${key}", which has no entry in an extensions file: the child starts without them`);
    }),
    bad: [{ body: '<callActivity id="c" calledElement="other"/>', ext: EXT({ mappings: { c: { mappingType: 'MAP_ALL' } } }), files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="other" isExecutable="true"/></definitions>' }, ids: ['c'] }],
    good: [{ body: '<callActivity id="c" calledElement="other"/>', ext: EXT({ mappings: { c: { mappingType: 'MAP_ALL' } } }), files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="other" isExecutable="true"/></definitions>', 'processes/other-extensions.json': '{ "id": "o", "extensions": { "other": { "properties": {}, "mappings": {}, "constants": {} } } }' } }],
  }),
  defineRule({
    id: 'multi-instance-call-activity-output',
    tag: 'X',
    severity: 'warn',
    title: 'Output from a multi-instance call activity',
    why: 'A multi-instance call activity gets nothing back from its children: `activiti:out`, an output mapping and the output collection are all skipped (the collection holds one null per instance).',
    evidence: ['engine-findings C11.1'],
    howToFix: 'Write the child\'s result somewhere shared (a signal, a message or a service), or wrap the call in a multi-instance sub process.',
    check: onTypes('bpmn:CallActivity', (call, api) => {
      const loop = child(call, 'loopCharacteristics');
      if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) return;
      const outs = extensionValues(call, 'activiti:Out').length > 0;
      const collects = !isBlank(typeof loop['loopDataOutputRef'] === 'string' ? (loop['loopDataOutputRef'] as string) : undefined) || !!child(loop, 'outputDataItem');
      const mapped = Object.keys(mappingOf(api, call)?.outputs ?? {}).length > 0 || upper(mappingOf(api, call)?.mappingType) === 'MAP_ALL' || upper(mappingOf(api, call)?.mappingType) === 'MAP_ALL_OUTPUTS';
      if (outs || collects || mapped) api.report(call, `${label(call)} is multi-instance: ${outs ? 'activiti:out' : collects ? 'the output collection' : 'its output mapping'} gets nothing back from the children`);
    }),
    bad: [{ body: `<callActivity id="c" calledElement="x">${ext('<activiti:out source="r" target="r"/>')}<multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></callActivity>`, ids: ['c'] }],
    good: [{ body: `<callActivity id="c" calledElement="x"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></callActivity>` }],
  }),
  // --- project wide uniqueness
  defineRule({
    id: 'process-key-not-unique-in-project',
    tag: 'L34',
    severity: 'error',
    title: 'Two files of the project define a process with the same key',
    why: 'The process id is the definition key. Two files with one key deployed together produce two versions of one definition; the later file silently replaces the earlier one.',
    evidence: ['FEATURE_MATRIX §D L34', 'R1 §3.1'],
    howToFix: 'Rename one of the processes.',
    entry: 'general.id',
    needs: ['project'],
    check: onTypes('bpmn:Process', (process, api) => {
      const project = api.ctx.project;
      if (!project || !process.id) return;
      const other = project.processes.find((p) => p.id === process.id && p.path !== api.ctx.path);
      if (other) api.report(process, `The process key "${process.id}" is also used by ${other.path}`);
    }),
    bad: [{ files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="p" isExecutable="true"/></definitions>' }, ids: ['p'] }],
    good: [{ files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="q" isExecutable="true"/></definitions>' } }],
  }),
  defineRule({
    id: 'message-start-name-not-unique',
    tag: 'L17',
    severity: 'error',
    title: 'Two message start events listen for the same message name',
    why: 'Activiti subscribes every message start event at deployment and refuses a second subscription to the same name: `there already is a message event subscription for the message start event`.',
    evidence: ['R1 §2.1-4', 'R1 §7.1 L17', 'FEATURE_MATRIX §D L34'],
    howToFix: 'Give each message start its own message name.',
    entry: 'event.definition',
    needs: ['project'],
    check: onTypes('bpmn:StartEvent', (start, api) => {
      if (!is(start.$parent, 'bpmn:Process')) return;
      const definition = list(start, 'eventDefinitions').find((d) => is(d, 'bpmn:MessageEventDefinition'));
      const name = definition ? messageNameOf(definition) : undefined;
      if (!name) return;
      const sameFile = processesOf(api.definitions).flatMap((p) => list(p, 'flowElements')).filter((e) => e !== start && is(e, 'bpmn:StartEvent') && list(e, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition') && messageNameOf(d) === name));
      const others = (api.ctx.project?.messageCatches ?? []).filter((c) => c.kind === 'start' && c.message === name && c.path !== api.ctx.path);
      if (sameFile.length > 0 || others.length > 0) api.report(start, `Another message start event also listens for "${name}"${others[0] ? ` (${others[0].path})` : ''}`);
    }),
    bad: [{ head: '<message id="m" name="order"/>', body: '<startEvent id="s"><messageEventDefinition messageRef="m"/></startEvent>', files: { 'processes/other.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><message id="m2" name="order"/><process id="q" isExecutable="true"><startEvent id="s2"><messageEventDefinition messageRef="m2"/></startEvent></process></definitions>' }, ids: ['s'] }],
    good: [{ head: '<message id="m" name="order"/>', body: '<startEvent id="s"><messageEventDefinition messageRef="m"/></startEvent>' }],
  }),
  defineRule({
    id: 'message-subscription-clash',
    tag: 'L30',
    severity: 'warn',
    title: 'Two message subscriptions of the same name can be active at the same time',
    why: '`ProcessRuntime.receive` finds the subscription by name (and correlation key) with a single-result query and throws `Query return 2 results instead of max 1` when two exist. That happens with an event sub process message start next to another catch of the same message, a message catch inside a multi-instance scope (every instance subscribes), and message catches without a correlation key that exist in more than one place. Two subscriptions with the same name and the same key cannot even be created. A message boundary event on a multi-instance activity is not a clash: it subscribes once for the whole multi-instance scope, not once per instance (engine findings C20.4).',
    evidence: ['engine-findings 31', 'engine-findings 32', 'engine-findings C20.4', 'FEATURE_MATRIX §D L30'],
    howToFix: 'Use distinct message names, or set an `activiti:correlationKey` on the catch events so a message selects one subscription.',
    entry: 'event.definition',
    check: onTypes('bpmn:Event', (event, api) => {
      if (!(is(event, 'bpmn:IntermediateCatchEvent') || is(event, 'bpmn:BoundaryEvent') || (is(event, 'bpmn:StartEvent') && is(event.$parent, 'bpmn:SubProcess')))) return;
      const definition = list(event, 'eventDefinitions').find((d) => is(d, 'bpmn:MessageEventDefinition'));
      const name = definition ? messageNameOf(definition) : undefined;
      if (!definition || !name) return;
      const process = processesOf(api.definitions).find((p) => allFlowElements(p).includes(event));
      if (!process) return;
      const keyed = !isBlank(str(definition, 'activiti:correlationKey'));
      // (a) the same message in an event sub process and anywhere else of the process
      const peers = allFlowElements(process).filter((e) => e !== event && is(e, 'bpmn:Event') && list(e, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition') && messageNameOf(d) === name));
      const eventSubProcessStart = is(event, 'bpmn:StartEvent');
      const peerIsEventSubProcess = peers.some((e) => is(e, 'bpmn:StartEvent') && is(e.$parent, 'bpmn:SubProcess'));
      if (eventSubProcessStart && peers.length > 0) return void api.report(event, `The event sub process start ${event.id} and ${peers[0]!.id} both wait for "${name}"`);
      if (peerIsEventSubProcess) return void api.report(event, `${event.id} waits for "${name}", which an event sub process of ${process.id} also waits for`);
      // (b) multi-instance
      for (let current: ME | undefined = event.$parent; current && !is(current, 'bpmn:Process'); current = current.$parent) {
        if (child(current, 'loopCharacteristics')) return void api.report(event, `${event.id} waits for "${name}" inside the multi-instance ${current.id}: every instance subscribes`);
      }
      // a boundary event on a multi-instance activity is NOT reported: it subscribes once for the whole multi-instance scope (C20-claims, `onWithdrawal`)
      // (c) the same name without a key in several places
      if (!keyed) {
        const external = (api.ctx.project?.messageCatches ?? []).filter((c) => c.path !== api.ctx.path && c.message === name && c.kind !== 'start' && !c.hasCorrelationKey);
        const internal = peers.filter((e) => list(e, 'eventDefinitions').some((d) => is(d, 'bpmn:MessageEventDefinition') && messageNameOf(d) === name && isBlank(str(d, 'activiti:correlationKey'))));
        if (external.length + internal.length > 0) api.report(event, `${event.id} waits for "${name}" without a correlation key, and ${internal[0]?.id ?? external[0]?.elementId} does too`);
      }
    }),
    bad: [
      { head: '<message id="m" name="note"/>', body: '<subProcess id="esp" triggeredByEvent="true"><startEvent id="es" isInterrupting="false"><messageEventDefinition messageRef="m"/></startEvent></subProcess><userTask id="u"/><boundaryEvent id="b" attachedToRef="u"><messageEventDefinition messageRef="m"/></boundaryEvent>', ids: ['es', 'b'] },
      { head: '<message id="m" name="note"/>', body: '<subProcess id="each"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics><startEvent id="s"/><intermediateCatchEvent id="c"><messageEventDefinition messageRef="m"/></intermediateCatchEvent></subProcess>', ids: ['c'] },
    ],
    good: [
      { head: '<message id="m" name="note"/>', body: '<intermediateCatchEvent id="c"><messageEventDefinition messageRef="m" activiti:correlationKey="${key}"/></intermediateCatchEvent>' },
      // one subscription for the whole multi-instance scope, received with two open instances (C20-claims)
      { head: '<message id="m" name="note"/>', body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><boundaryEvent id="b" attachedToRef="u"><messageEventDefinition messageRef="m"/></boundaryEvent>' },
    ],
  }),
  defineRule({
    id: 'initiator-needs-authenticated-user',
    tag: 'L26',
    severity: 'info',
    title: 'A start event stores the process initiator',
    why: '`activiti:initiator` receives the authenticated user id, but nothing in Activiti 9 sets it: the host application must call `Authentication.setAuthenticatedUserId(...)` before starting the process (the modeler server does). Without it the variable is null.',
    evidence: ['R1 §0.3-20', 'R1 §7.1 L26', 'engine-findings C15.7'],
    howToFix: 'Set the authenticated user in the host application, or ignore this note.',
    entry: 'start.initiator',
    check: onTypes('bpmn:StartEvent', (start, api) => {
      if (!isBlank(str(start, 'activiti:initiator'))) api.report(start, `Start event ${start.id} stores the initiator in "${str(start, 'activiti:initiator')}": the host application must set the authenticated user`);
    }),
    bad: [{ body: '<startEvent id="s" activiti:initiator="starter"/>', ids: ['s'] }],
    good: [{ body: '<startEvent id="s"/>' }],
  }),
  defineRule({
    id: 'skip-expression-needs-enable-variable',
    tag: 'L20',
    severity: 'warn',
    title: 'A skip expression without the _ACTIVITI_SKIP_EXPRESSION_ENABLED variable',
    why: 'Activiti evaluates `activiti:skipExpression` only when the process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is `true`; otherwise the expression is ignored and the task runs. The process runtime rejects start variables whose name starts with an underscore, so declare the variable as a process property with the default `true`.',
    evidence: ['R1 §3.3', 'R1 §7.1 L20', 'engine-findings 6'],
    howToFix: 'Add a boolean process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` with the default `true` in **Process variables**.',
    entry: 'skip.expression',
    needs: ['extensions'],
    check: (node, api) => {
      if (!api.ctx.extensions || isBlank(str(node, 'activiti:skipExpression'))) return;
      const entry = extensionOf(api, node);
      const declared = Object.values(entry?.properties ?? {}).some((p) => p.name === '_ACTIVITI_SKIP_EXPRESSION_ENABLED');
      if (!declared) api.report(node, `${label(node)} has a skip expression, but the process does not declare _ACTIVITI_SKIP_EXPRESSION_ENABLED: Activiti ignores the expression`);
    },
    bad: [{ body: '<userTask id="u" activiti:skipExpression="${skip}"/>', ext: EXT({}), ids: ['u'] }],
    good: [{ body: '<userTask id="u" activiti:skipExpression="${skip}"/>', ext: EXT({ properties: { s: { id: 's', name: '_ACTIVITI_SKIP_EXPRESSION_ENABLED', type: 'boolean', value: true } } }) }],
  }),
];
