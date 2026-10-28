import type { DmnInputSpec, DmnOutputSpec, DmnRuleSpec, CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { at } from '../support/layout';

/**
 * C16 DMN hit policies, modelled through the real modeler and exported with the real export pipeline. It reproduces `seed/processes/*`:
 *  - the 13 decision tables go through the DMN part of the test API, which drives a dmn-js modeler with the editor's own options: a
 *    DRD with an input data element and a decision, the decision replaced by a decision table, hit policy, columns, allowed
 *    values, rules (their ids are what the scenarios assert as matched rules) and cells (`app/src/dmnTestApi.ts`);
 *  - the three processes go through the property accessors: the decision task wiring (`decision.pick`, DM11) maps what the decision
 *    reads and returns, and the explicit rows are the ones whose process variable has another name than the decision's output.
 * The runner compares the DMN files and the processes with the seed semantically (the diagram is not compared; decision, input
 * data and rule ids are) and the harness runs the hand-written scenarios of this folder against the result.
 */
const NAMESPACE = 'http://kleash.github.io/corpus/C16';
const CONNECTOR = 'dmn-connector.EXECUTE_TABLE';

interface Table {
  /** The DMN file's base name (`processes/<file>.dmn`). */
  file: string;
  /** The decision id; the file's definitions get `Definitions_<id>`. */
  id: string;
  /** What the decision's variable is typed as; none for the decisions that return a list or several columns. */
  variableType?: string;
  /** The one input data element the decision reads. */
  input: { name: string; type: string; label: string };
  hitPolicy?: string;
  aggregation?: string;
  outputs: DmnOutputSpec[];
  /** `[rule name, input entry, output entries]`; the rule id is `<decision id>_<rule name>`. */
  rules: Array<[string, string, ...string[]]>;
}

const NUMBER = 'number';
const STRING = 'string';

const TABLES: Table[] = [
  { file: 'unique-grade', id: 'uniqueGrade', variableType: STRING, input: { name: 'score', type: NUMBER, label: 'Score' }, hitPolicy: 'UNIQUE', outputs: [{ name: 'grade', typeRef: STRING }],
    rules: [['low', '< 50', '"low"'], ['mid', '[50..80)', '"mid"'], ['high', '>= 80', '"high"']] },
  { file: 'first-tier', id: 'firstTier', variableType: STRING, input: { name: 'score', type: NUMBER, label: 'Score' }, hitPolicy: 'FIRST', outputs: [{ name: 'tier', typeRef: STRING }],
    rules: [['platinum', '>= 90', '"platinum"'], ['gold', '>= 70', '"gold"'], ['silver', '>= 50', '"silver"'], ['bronze', '-', '"bronze"']] },
  { file: 'any-region', id: 'anyRegion', variableType: STRING, input: { name: 'country', type: STRING, label: 'Country' }, hitPolicy: 'ANY', outputs: [{ name: 'region', typeRef: STRING }],
    rules: [['dach1', '"DE","AT"', '"DACH"'], ['dach2', '"DE","CH"', '"DACH"'], ['us', '"US"', '"NA"']] },
  { file: 'priority-risk', id: 'priorityRisk', variableType: STRING, input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'PRIORITY', outputs: [{ name: 'risk', typeRef: STRING, allowedValues: ['"high"', '"medium"', '"low"'] }],
    rules: [['low', '> 0', '"low"'], ['medium', '> 1000', '"medium"'], ['high', '> 10000', '"high"']] },
  { file: 'priority-two-outputs', id: 'priorityTwoOutputs', input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'PRIORITY',
    outputs: [{ name: 'risk', typeRef: STRING, allowedValues: ['"high"', '"low"'] }, { name: 'action', typeRef: STRING, allowedValues: ['"escalate"', '"none"'] }],
    rules: [['lowEscalate', '> 0', '"low"', '"escalate"'], ['highNone', '> 1000', '"high"', '"none"'], ['highEscalate', '> 10000', '"high"', '"escalate"'], ['lowNone', '> 0', '"low"', '"none"']] },
  { file: 'rule-order-badges', id: 'ruleOrderBadges', input: { name: 'score', type: NUMBER, label: 'Score' }, hitPolicy: 'RULE ORDER', outputs: [{ name: 'badge', typeRef: STRING }],
    rules: [['participant', '>= 0', '"participant"'], ['achiever', '>= 50', '"achiever"'], ['star', '>= 80', '"star"']] },
  { file: 'output-order-badges', id: 'outputOrderBadges', input: { name: 'score', type: NUMBER, label: 'Score' }, hitPolicy: 'OUTPUT ORDER', outputs: [{ name: 'badge', typeRef: STRING, allowedValues: ['"star"', '"achiever"', '"participant"'] }],
    rules: [['participant', '>= 0', '"participant"'], ['star', '>= 80', '"star"'], ['achiever', '>= 50', '"achiever"']] },
  { file: 'collect-flags', id: 'collectFlags', input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'COLLECT', outputs: [{ name: 'flag', typeRef: STRING }],
    rules: [['base', '> 0', '"base-check"'], ['review', '> 1000', '"manual-review"'], ['approval', '> 5000', '"approval-needed"']] },
  { file: 'collect-sum-points', id: 'collectSumPoints', variableType: NUMBER, input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'COLLECT', aggregation: 'SUM', outputs: [{ name: 'points', typeRef: NUMBER }],
    rules: [['base', '> 0', '1'], ['silver', '> 100', '10'], ['gold', '> 1000', '100']] },
  { file: 'collect-min-price', id: 'collectMinPrice', variableType: NUMBER, input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'COLLECT', aggregation: 'MIN', outputs: [{ name: 'unitPrice', typeRef: NUMBER }],
    rules: [['list', '> 0', '30'], ['bulk', '> 100', '20'], ['wholesale', '> 1000', '10']] },
  { file: 'collect-max-penalty', id: 'collectMaxPenalty', variableType: NUMBER, input: { name: 'delay', type: NUMBER, label: 'Delay in days' }, hitPolicy: 'COLLECT', aggregation: 'MAX', outputs: [{ name: 'penalty', typeRef: NUMBER }],
    rules: [['late', '> 0', '5'], ['weekLate', '> 7', '50'], ['monthLate', '> 30', '500']] },
  { file: 'collect-count-alerts', id: 'collectCountAlerts', variableType: NUMBER, input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'COLLECT', aggregation: 'COUNT', outputs: [{ name: 'alerts', typeRef: NUMBER }],
    rules: [['large', '> 100', '1'], ['huge', '> 1000', '2'], ['extreme', '> 10000', '3']] },
  { file: 'routing', id: 'routeByAmount', variableType: STRING, input: { name: 'amount', type: NUMBER, label: 'Amount' }, hitPolicy: 'UNIQUE', outputs: [{ name: 'route', typeRef: STRING }],
    rules: [['standard', '[1..1000)', '"standard"'], ['review', '[1000..10000)', '"review"']] },
];

async function buildTable(api: CorpusModeler, t: Table): Promise<void> {
  await api.createDmn(t.file, { id: `Definitions_${t.id}` });
  const dataId = `InputData_${t.input.name}`;
  await api.addInputData(t.file, { id: dataId, name: t.input.name, typeRef: t.input.type, at: { x: 235, y: 322 } });
  const inputs: DmnInputSpec[] = [{ label: t.input.label, expression: t.input.name, typeRef: t.input.type }];
  const rules: DmnRuleSpec[] = t.rules.map(([name, entry, ...outputs]) => ({ id: `${t.id}_${name}`, inputs: [entry], outputs }));
  await api.addDecisionTable(t.file, {
    id: t.id,
    ...(t.variableType ? { variableType: t.variableType } : {}),
    ...(t.hitPolicy ? { hitPolicy: t.hitPolicy } : {}),
    ...(t.aggregation ? { aggregation: t.aggregation } : {}),
    inputs,
    outputs: t.outputs,
    rules,
    at: { x: 250, y: 140 },
  });
  await api.addRequirement(t.file, dataId, t.id, 'information');
}

async function newProcess(api: CorpusModeler, file: string, id: string, name: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
}

/** One row of the `hitPolicies` process: a decision task, the decision it evaluates and how it is wired. */
interface Task {
  id: string;
  name: string;
  decision: string;
  /** The input variable the decision reads (the task maps it by the same name). */
  input: string;
  /** `pick`: the decision's own outputs, mapped by the picker. Otherwise explicit `[process variable, source]` rows. */
  outputs: 'pick' | Array<[string, string]>;
  /** The process variable that receives the matched rule ids. */
  rules: string;
}

const TASKS: Task[] = [
  { id: 'decideUnique', name: 'Decide unique grade', decision: 'uniqueGrade', input: 'score', outputs: 'pick', rules: 'rulesUnique' },
  { id: 'decideFirst', name: 'Decide first tier', decision: 'firstTier', input: 'score', outputs: 'pick', rules: 'rulesFirst' },
  { id: 'decideAny', name: 'Decide any region', decision: 'anyRegion', input: 'country', outputs: 'pick', rules: 'rulesAny' },
  { id: 'decidePriority', name: 'Decide priority risk', decision: 'priorityRisk', input: 'amount', outputs: 'pick', rules: 'rulesPriority' },
  { id: 'decideRuleOrder', name: 'Decide rule order badges', decision: 'ruleOrderBadges', input: 'score', outputs: [['badgesInRuleOrder', 'ruleOrderBadges']], rules: 'rulesRuleOrder' },
  { id: 'decidePriorityTwo', name: 'Decide priority with two outputs', decision: 'priorityTwoOutputs', input: 'amount', outputs: [['riskLevel', 'risk'], ['action', 'action']], rules: 'rulesPriorityTwo' },
  { id: 'decideOutputOrder', name: 'Decide output order badges', decision: 'outputOrderBadges', input: 'score', outputs: [['badgesByPriority', 'outputOrderBadges']], rules: 'rulesOutputOrder' },
  { id: 'decideCollect', name: 'Decide collect flags', decision: 'collectFlags', input: 'amount', outputs: [['flags', 'collectFlags']], rules: 'rulesCollect' },
  { id: 'decideSum', name: 'Decide collect sum', decision: 'collectSumPoints', input: 'amount', outputs: 'pick', rules: 'rulesSum' },
  { id: 'decideMin', name: 'Decide collect min', decision: 'collectMinPrice', input: 'amount', outputs: 'pick', rules: 'rulesMin' },
  { id: 'decideMax', name: 'Decide collect max', decision: 'collectMaxPenalty', input: 'delay', outputs: 'pick', rules: 'rulesMax' },
  { id: 'decideCount', name: 'Decide collect count', decision: 'collectCountAlerts', input: 'amount', outputs: 'pick', rules: 'rulesCount' },
];

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C16-dmn-hit-policies', { defaultMappings: 'none' });

  // --- the decision tables ----------------------------------------------------------------------------------------------------
  for (const table of TABLES) await buildTable(api, table);

  // --- hitPolicies: twelve decision tasks in a row -----------------------------------------------------------------------------
  await newProcess(api, 'hitPolicies', 'hitPolicies', 'DMN hit policies');
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Start', at: at(0, 1) });
  let previous = 'start';
  for (const [index, task] of TASKS.entries()) {
    await api.createShape({ type: 'serviceTask', id: task.id, name: task.name, attrs: { implementation: CONNECTOR }, at: at(index + 1, 1) });
    await api.connect(previous, task.id, `flow_${previous}_${task.id}`);
    previous = task.id;
    if (task.outputs === 'pick') {
      // the picker: the decision id, a VARIABLE input for what the decision reads, a VARIABLE output for what it returns
      await api.setProperty(task.id, 'decision.pick', { decision: task.decision, matchedRules: task.rules });
    } else {
      await api.setProperty(task.id, 'decision.pick', { decision: task.decision, outputs: false, matchedRules: task.rules });
      const outputs = Object.fromEntries(task.outputs.map(([variable, source]) => [variable, { type: 'VARIABLE', value: source }]));
      await api.setProperty(task.id, 'mapping.outputs', { ...outputs, [task.rules]: { type: 'VARIABLE', value: '_activiti_dmn_matched_rules_' } });
    }
  }
  await api.createShape({ type: 'endEvent', id: 'end', name: 'End', at: at(TASKS.length + 1, 1) });
  await api.connect(previous, 'end', `flow_${previous}_end`);
  // the declared variables of the seed, with its types (the picker declares what it maps; numbers it declares as bigdecimal)
  await api.setExtensions({
    properties: [
      ...['score', 'amount', 'delay', 'points', 'unitPrice', 'penalty', 'alerts'].map((name) => ({ name, type: 'integer' })),
      ...['country', 'grade', 'tier', 'region', 'risk', 'riskLevel', 'action'].map((name) => ({ name, type: 'string' })),
      ...['badgesInRuleOrder', 'badgesByPriority', 'flags', ...TASKS.map((t) => t.rules)].map((name) => ({ name, type: 'array' })),
    ],
  });

  // --- noMatchRouting: reacts to "no match" -------------------------------------------------------------------------------------
  await newProcess(api, 'noMatchRouting', 'noMatchRouting', 'Route by amount (reacts to no match)');
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Start', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'decideRoute', name: 'Decide route', attrs: { implementation: CONNECTOR }, at: at(1, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'isRouted', name: 'Routed?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'routedEnd', name: 'Routed', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'unroutedEnd', name: 'No route', at: at(3, 2) });
  await api.connect('start', 'decideRoute', 'flow_start_decideRoute');
  await api.connect('decideRoute', 'isRouted', 'flow_decideRoute_isRouted');
  await api.connect('isRouted', 'routedEnd', 'flow_isRouted_routedEnd');
  await api.setProperty('flow_isRouted_routedEnd', 'flow.condition', '${matched}');
  await api.connect('isRouted', 'unroutedEnd', 'flow_isRouted_unroutedEnd');
  await api.setProperty('flow_isRouted_unroutedEnd', 'flow.default', true);
  await api.setProperty('decideRoute', 'decision.pick', { decision: 'routeByAmount', matched: 'matched', matchedRules: 'matchedRules' });
  await api.setExtensions({
    properties: [
      { name: 'amount', type: 'integer' },
      { name: 'route', type: 'string' },
      { name: 'matched', type: 'boolean' },
      { name: 'matchedRules', type: 'array' },
    ],
  });

  // --- mapAllOutputs: every output of the decision becomes a process variable ----------------------------------------------------
  await newProcess(api, 'mapAllOutputs', 'mapAllOutputs', 'Decision task with MAP_ALL_OUTPUTS');
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Start', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'decideAlerts', name: 'Count alerts', attrs: { implementation: CONNECTOR }, at: at(1, 1) });
  await api.createShape({ type: 'endEvent', id: 'end', name: 'End', at: at(2, 1) });
  await api.connect('start', 'decideAlerts', 'flow_start_decideAlerts');
  await api.connect('decideAlerts', 'end', 'flow_decideAlerts_end');
  // a decision task can name the DMN file instead of the decision: the file holds one decision (ADR 0004, form 1)
  await api.setProperty('decideAlerts', 'decision.table', 'collect-count-alerts');
  await api.setProperty('decideAlerts', 'mapping.type', 'MAP_ALL_OUTPUTS');
  await api.setProperty('decideAlerts', 'mapping.inputs', { amount: { type: 'VARIABLE', value: 'amount' } });
  await api.setExtensions({ properties: [{ name: 'amount', type: 'integer' }] });
}

export const semanticDiff = {
  allow: [] as Array<{ pattern: RegExp; reason: string }>,
};

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C16-dmn-hit-policies`. */
export const uiDriven = true;
