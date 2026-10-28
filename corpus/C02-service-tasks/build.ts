import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C02 service tasks, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`:
 * Java class delegates with fields, expressions with result variables, delegate expressions, connectors with every kind of
 * mapping (the `mapping.*` and `constants.values` accessors of the Input / output mapping and Constants groups; the targets of
 * the output mappings are declared by the store, typed from the connector definitions of `seed/connectors/`, which the project
 * holds as its connector catalog) and asynchronous tasks. The runner compares the result with the seed semantically and the
 * harness runs the hand-written scenarios of this folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C02';
const HARNESS = 'io.github.kleash.activiti.harness.support';
// build files are loaded as CommonJS by the Playwright runner
const here = __dirname;

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

type Field = { name: string; string?: string; expression?: string };

/** start -> tasks -> end on one row; every task is a service task with the given name. */
async function serviceTasks(api: CorpusModeler, tasks: Array<{ id: string; name: string }>): Promise<void> {
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  for (const [i, t] of tasks.entries()) await api.createShape({ type: 'serviceTask', id: t.id, name: t.name, at: at(i + 1, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(tasks.length + 1, 1) });
  await chain(api, 'start', ...tasks.map((t) => t.id), 'end');
}

async function classTask(api: CorpusModeler, id: string, className: string, fields: Field[]): Promise<void> {
  await api.setProperty(id, 'impl.type', 'class');
  await api.setProperty(id, 'impl.class', `${HARNESS}.${className}`);
  await api.setProperty(id, 'fields.list', fields);
}

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C02-service-tasks', { defaultMappings: 'none' });
  // the connector catalog: the descriptors of the beans the corpus support library provides
  for (const name of ['crm', 'echo', 'flags']) await api.addConnector(name, readFileSync(join(here, 'seed', 'connectors', `${name}.json`), 'utf8'));

  // --- class-delegates ------------------------------------------------------------------------------------------------
  await newProcess(api, 'class-delegates', 'classDelegates', 'Class delegates',
    'Service tasks with activiti:class. The engine creates the delegate and injects the activiti:field values: a literal (nested string element or stringValue attribute) and an expression, which the delegate evaluates itself.');
  await serviceTasks(api, [
    { id: 'setGreeting', name: 'Set the greeting' },
    { id: 'setTotal', name: 'Set the total' },
    { id: 'countOnce', name: 'Count once' },
    { id: 'countTwice', name: 'Count twice' },
  ]);
  await classTask(api, 'setGreeting', 'SetVariableDelegate', [{ name: 'variable', string: 'greeting' }, { name: 'value', expression: 'Hello, ${customerName}' }]);
  await classTask(api, 'setTotal', 'SetVariableDelegate', [{ name: 'variable', string: 'total' }, { name: 'value', expression: '${price * quantity}' }]);
  await classTask(api, 'countOnce', 'IncrementDelegate', [{ name: 'variable', string: 'counter' }]);
  await classTask(api, 'countTwice', 'IncrementDelegate', [{ name: 'variable', string: 'counter' }]);

  // --- expressions ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'expressions', 'expressions', 'Expressions',
    'Service tasks with activiti:expression. The value of the expression is stored in the process variable named by activiti:resultVariableName; without a result variable only the side effect of the expression remains.');
  await serviceTasks(api, [
    { id: 'computeTotal', name: 'Compute the total' },
    { id: 'greet', name: 'Greet' },
    { id: 'sum', name: 'Add' },
    { id: 'sideEffect', name: 'Set a marker' },
  ]);
  const expressions: Array<[string, string, string | undefined]> = [
    ['computeTotal', '${price * quantity}', 'total'],
    ['greet', '${greeter.greet(customerName)}', 'greeting'],
    ['sum', '${greeter.add(price, quantity)}', 'sum'],
    ['sideEffect', "${execution.setVariable('marker', 'done')}", undefined],
  ];
  for (const [id, expression, result] of expressions) {
    await api.setProperty(id, 'impl.type', 'expression');
    await api.setProperty(id, 'impl.expression', expression);
    if (result) await api.setProperty(id, 'impl.resultVariable', result);
  }

  // --- delegate-expressions -------------------------------------------------------------------------------------------
  await newProcess(api, 'delegate-expressions', 'delegateExpressions', 'Delegate expressions',
    'Service tasks with activiti:delegateExpression: a Spring bean that implements JavaDelegate. Fields are injected into the bean before every call, so one bean can be configured differently by two tasks.');
  await serviceTasks(api, [
    { id: 'record', name: 'Record' },
    { id: 'copyName', name: 'Copy the name' },
    { id: 'labelName', name: 'Label the name' },
    { id: 'recordAgain', name: 'Record again' },
  ]);
  const delegates: Array<[string, string, Field[]]> = [
    ['record', '${recordingDelegate}', []],
    ['copyName', '${setVariableDelegate}', [{ name: 'variable', string: 'origin' }, { name: 'value', expression: '${customerName}' }]],
    ['labelName', '${setVariableDelegate}', [{ name: 'variable', string: 'label' }, { name: 'value', expression: '${customerName}-label' }]],
    ['recordAgain', '${recordingDelegate}', []],
  ];
  for (const [id, expression, fields] of delegates) {
    await api.setProperty(id, 'impl.type', 'delegateExpression');
    await api.setProperty(id, 'impl.delegateExpression', expression);
    if (fields.length > 0) await api.setProperty(id, 'fields.list', fields);
  }

  // --- connector-mappings ---------------------------------------------------------------------------------------------
  await newProcess(api, 'connector-mappings', 'connectorMappings', 'Connector mappings',
    'Connector service tasks (implementation is the connector bean name) with every kind of variable mapping: VARIABLE and VALUE inputs (a value may contain expressions), constants, VARIABLE outputs, MAP_ALL in both directions, a JSONPATCH output and the ephemeral flag.');
  await serviceTasks(api, [
    { id: 'lookup', name: 'Look up the customer' },
    { id: 'echoMapped', name: 'Echo mapped values' },
    { id: 'echoAll', name: 'Echo everything' },
    { id: 'patch', name: 'Patch the profile' },
    { id: 'flagsEphemeral', name: 'Ephemeral mapping' },
    { id: 'flagsPersistent', name: 'Persistent mapping' },
  ]);
  const connectors: Array<[string, string]> = [
    ['lookup', 'crm.LOOKUP'], ['echoMapped', 'echo.EXECUTE'], ['echoAll', 'echo.EXECUTE'], ['patch', 'echo.EXECUTE'], ['flagsEphemeral', 'flags.EXECUTE'], ['flagsPersistent', 'flags.EXECUTE'],
  ];
  for (const [id, action] of connectors) {
    await api.setProperty(id, 'impl.type', 'connector');
    await api.setProperty(id, 'impl.connector', action);
  }
  // variables the mappings read or whose type the connector descriptors do not give (the other targets are declared, typed, by the output mappings)
  await api.setExtensions({
    properties: [
      { name: 'customerId', type: 'string' },
      { name: 'echoedGreeting', type: 'string' },
    ],
  });
  await api.setProperty('lookup', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' } });
  await api.setProperty('lookup', 'mapping.outputs', { customerName: { type: 'VARIABLE', value: 'customerName' }, tier: { type: 'VARIABLE', value: 'tier' } });
  await api.setProperty('echoMapped', 'mapping.inputs', {
    greeting: { type: 'VALUE', value: 'hello' },
    tierLabel: { type: 'VALUE', value: '${tier}' },
    note: { type: 'VALUE', value: '${customerName} is ${tier}' },
  });
  await api.setProperty('echoMapped', 'mapping.outputs', { echoedGreeting: { type: 'VARIABLE', value: 'greeting' }, echoCount: { type: 'VARIABLE', value: 'echoCount' } });
  await api.setProperty('echoMapped', 'constants.values', { region: 'EU', limit: 42 });
  await api.setProperty('echoAll', 'mapping.type', 'MAP_ALL');
  await api.setProperty('patch', 'mapping.outputs', {
    profile: {
      type: 'JSONPATCH',
      value: [
        { op: 'add', path: '/name', value: 'Ann' },
        { op: 'add', path: '/address/city', value: 'Paris' },
        { op: 'add', path: '/tags', value: ['gold'] },
        { op: 'add', path: '/${customerId}', value: 'known' },
      ],
    },
  });
  await api.setProperty('flagsEphemeral', 'mapping.ephemeral', true);
  await api.setProperty('flagsEphemeral', 'mapping.outputs', { ephemeralSeen: { type: 'VARIABLE', value: 'ephemeral' } });
  await api.setProperty('flagsPersistent', 'mapping.outputs', { persistentSeen: { type: 'VARIABLE', value: 'ephemeral' } });

  // --- async-service-tasks --------------------------------------------------------------------------------------------
  await newProcess(api, 'async-service-tasks', 'asyncServiceTasks', 'Asynchronous service tasks',
    'Asynchronous service tasks: each becomes a job that must be executed. The first task is not exclusive (its job may run in parallel with other jobs of the same instance), the others use the default.');
  await serviceTasks(api, [
    { id: 'asyncDelegate', name: 'Async class delegate' },
    { id: 'asyncConnector', name: 'Async connector' },
    { id: 'asyncExpression', name: 'Async expression' },
  ]);
  await classTask(api, 'asyncDelegate', 'IncrementDelegate', [{ name: 'variable', string: 'counter' }]);
  await api.setProperty('asyncConnector', 'impl.type', 'connector');
  await api.setProperty('asyncConnector', 'impl.connector', 'crm.LOOKUP');
  await api.setProperty('asyncExpression', 'impl.type', 'expression');
  await api.setProperty('asyncExpression', 'impl.expression', "${execution.setVariable('after', 'yes')}");
  for (const id of ['asyncDelegate', 'asyncConnector', 'asyncExpression']) await api.setProperty(id, 'async.async', true);
  await api.setProperty('asyncDelegate', 'async.exclusive', false);
  await api.setExtensions({ properties: [{ name: 'customerId', type: 'string' }] });
  await api.setProperty('asyncConnector', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' } });
  await api.setProperty('asyncConnector', 'mapping.outputs', { customerName: { type: 'VARIABLE', value: 'customerName' } });
}

export const semanticDiff = {
  allow: [
    { pattern: /serviceTask\[(setTotal|countTwice)\]\/extensionElements\/field\//, reason: 'the seed writes these fields in the stringValue / expression attribute form; the modeler writes the nested element form the engine reads the same way' },
    { pattern: /exclusive/, reason: 'the seed writes activiti:exclusive="true", the engine default, which the modeler does not write' },
  ],
};

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C02-service-tasks`. */
export const uiDriven = true;
