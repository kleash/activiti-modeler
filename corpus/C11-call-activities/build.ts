import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C11 call activities, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`: the
 * calling processes with every way of passing data (Called element group: activiti:in / activiti:out, inheritVariables, business
 * keys, a calledElement expression; Input / output mapping and Constants groups for the extensions mapping; Process variables
 * group for the properties the called processes declare; Multi-instance group) and the called processes in the same project.
 * The runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this folder
 * against it.
 *
 * leafChild is the "bare child" of the seed (engine finding C11.2: a called process without an entry in an extensions file drops the
 * inputs a call activity maps to it). The modeler writes an extensions entry for every process by default, which would hand it the
 * mapped inputs, so this one process is exported without a sidecar (`omitExtensions`).
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C11';

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string, options: { omitExtensions?: boolean } = {}): Promise<void> {
  await api.newProcess(id, name, { file, ...options });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

/** A called process: cStart -> steps -> cEnd, each step an expression service task. */
async function child(api: CorpusModeler, file: string, id: string, name: string, documentation: string, steps: Array<{ id: string; name: string; expression?: string; userTask?: boolean }>, options: { omitExtensions?: boolean } = {}): Promise<void> {
  await newProcess(api, file, id, name, documentation, options);
  await api.createShape({ type: 'startEvent', id: 'cStart', at: at(0, 1) });
  for (const [i, step] of steps.entries()) {
    await api.createShape({ type: step.userTask ? 'userTask' : 'serviceTask', id: step.id, name: step.name, at: at(i + 1, 1) });
    if (step.userTask) await api.setProperty(step.id, 'user.candidateUsers', 'ann');
    else {
      await api.setProperty(step.id, 'impl.type', 'expression');
      await api.setProperty(step.id, 'impl.expression', step.expression!);
    }
  }
  await api.createShape({ type: 'endEvent', id: 'cEnd', at: at(steps.length + 1, 1) });
  await chain(api, 'cStart', ...steps.map((s) => s.id), 'cEnd');
}

/** start -> calls... -> end; every call is a call activity of the given process key. */
async function calls(api: CorpusModeler, calls: Array<{ id: string; name: string; calledElement: string }>, tail: Array<{ id: string; name: string; expression: string }> = []): Promise<void> {
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  const all = [...calls.map((c) => ({ ...c, call: true })), ...tail.map((t) => ({ ...t, call: false }))];
  for (const [i, c] of all.entries()) {
    await api.createShape({ type: c.call ? 'callActivity' : 'serviceTask', id: c.id, name: c.name, at: at(i + 1, 1) });
    if ('calledElement' in c) await api.setProperty(c.id, 'call.calledElement', c.calledElement);
    else {
      await api.setProperty(c.id, 'impl.type', 'expression');
      await api.setProperty(c.id, 'impl.expression', (c as { expression: string }).expression);
    }
  }
  await api.createShape({ type: 'endEvent', id: 'end', at: at(all.length + 1, 1) });
  await chain(api, 'start', ...all.map((c) => c.id), 'end');
}

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C11-call-activities', { defaultMappings: 'none' });

  // --- the called processes -------------------------------------------------------------------------------------------
  await child(api, 'audit-child', 'auditChild', 'Audit (called)',
    'Called by callInherit. Reads the inherited orderId and changes the inherited shared counter; the changes stay in the child.', [
      { id: 'note', name: 'Note the order', expression: "${execution.setVariable('seenOrder', orderId)}" },
      { id: 'bump', name: 'Bump shared', expression: "${execution.setVariable('shared', shared + 1)}" },
    ]);
  await child(api, 'echo-child', 'echoChild', 'Echo (called)', 'Called by callMappings through a MAP_ALL mapping: sets childRan and keeps everything it was given.', [
    { id: 'mark', name: 'Mark', expression: "${execution.setVariable('childRan', true)}" },
  ]);
  await api.setExtensions({ properties: [{ name: 'childRan', type: 'boolean' }] });
  await child(api, 'item-child', 'itemChild', 'Inspect one item (called)',
    'Called once per item by the parallel multi-instance call activity of callMultiInstance. A user task keeps every child open until the scenario completes it; the result is the upper-cased item.', [
      { id: 'inspect', name: 'Inspect item', userTask: true },
      { id: 'upper', name: 'Upper-case the item', expression: "${execution.setVariable('result', item.toUpperCase())}" },
    ]);
  await child(api, 'leaf-child', 'leafChild', 'Leaf (called)', 'Called by callBusinessKey: does one visible thing so that the child instance has a path.', [
    { id: 'mark', name: 'Mark', expression: "${execution.setVariable('leafRan', true)}" },
  ], { omitExtensions: true });
  await child(api, 'position-child', 'positionChild', 'Position step (called)',
    'Called by the sequential multi-instance call activity of callMultiInstance: the result is ten times the position it was given.', [
      { id: 'scale', name: 'Scale the position', expression: "${execution.setVariable('result', position * 10)}" },
    ]);
  await child(api, 'price-calculator', 'priceCalculator', 'Price calculator (called)',
    'Called by callInOut. Multiplies price by quantity into total; a user task keeps the child instance open so that the scenario can look at it while it runs.', [
      { id: 'review', name: 'Review price', userTask: true },
      { id: 'compute', name: 'Compute total', expression: "${execution.setVariable('total', price * quantity)}" },
    ]);
  await child(api, 'risk-check', 'riskCheck', 'Risk check (called)',
    'Called by callMappings. Declares customerId (required), channel (default unknown) and retries (default 3) as properties; score 10 per character of the customer id, band high above 50.', [
      { id: 'score', name: 'Score', expression: "${execution.setVariable('riskScore', customerId.length() * 10)}" },
      { id: 'band', name: 'Band', expression: "${execution.setVariable('riskBand', riskScore > 50 ? 'high' : 'low')}" },
    ]);
  await api.setExtensions({
    properties: [
      { name: 'customerId', type: 'string', required: true },
      { name: 'channel', type: 'string', value: 'unknown' },
      { name: 'retries', type: 'integer', value: 3 },
      { name: 'riskScore', type: 'integer' },
      { name: 'riskBand', type: 'string' },
    ],
  });
  for (const [file, id, letter] of [['variant-a', 'variantA', 'A'], ['variant-b', 'variantB', 'B']] as const) {
    await child(api, file, id, `Variant ${letter} (called)`, 'One of two children that callExpression selects at run time through calledElement="${childKey}".', [
      { id: 'mark', name: `Mark ${letter}`, expression: `\${execution.setVariable('variant', '${letter}')}` },
    ]);
  }

  // --- call-business-key ----------------------------------------------------------------------------------------------
  await newProcess(api, 'call-business-key', 'callBusinessKey', 'Call activities and business keys',
    'Three calls of the same child: with an explicit business key expression, with inheritBusinessKey, and with neither (the child has no business key).');
  await calls(api, [
    { id: 'callExplicitKey', name: 'Explicit key', calledElement: 'leafChild' },
    { id: 'callInheritedKey', name: 'Inherited key', calledElement: 'leafChild' },
    { id: 'callNoKey', name: 'No key', calledElement: 'leafChild' },
  ]);
  await api.setProperty('callExplicitKey', 'call.businessKey', 'BK-${orderId}');
  await api.setProperty('callInheritedKey', 'call.inheritBusinessKey', true);

  // --- call-expression ------------------------------------------------------------------------------------------------
  await newProcess(api, 'call-expression', 'callExpression', 'Call activity with a calledElement expression',
    'calledElement is the expression ${childKey}: the process variable decides at run time which process definition key is called. A key that is not deployed fails the call.');
  await calls(api, [{ id: 'pick', name: 'Call the chosen child', calledElement: '${childKey}' }]);
  await api.setProperty('pick', 'call.out', [{ source: 'variant', target: 'chosen' }]);

  // --- call-in-out ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'call-in-out', 'callInOut', 'Call activity with activiti:in and activiti:out',
    'Explicit parameter passing without inheritVariables and without an extensions mapping: activiti:in with source (renaming) and sourceExpression, activiti:out with source and sourceExpression (evaluated on the child instance). Nothing else crosses the boundary in either direction.');
  await calls(api, [{ id: 'priceIt', name: 'Calculate price', calledElement: 'priceCalculator' }], [{ id: 'markPriced', name: 'Mark priced', expression: "${execution.setVariable('priced', true)}" }]);
  await api.setProperty('priceIt', 'call.in', [{ source: 'unitPrice', target: 'price' }, { sourceExpression: '${itemCount * 2}', target: 'quantity' }]);
  await api.setProperty('priceIt', 'call.out', [{ source: 'total', target: 'orderTotal' }, { sourceExpression: '${total * 2}', target: 'doubleTotal' }]);

  // --- call-inherit ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'call-inherit', 'callInherit', 'Call activity with inheritVariables',
    'With activiti:inheritVariables the child starts with a copy of every variable of the calling execution. The copy is one way: what the child changes or adds does not come back, because there is no activiti:out and no extensions mapping.');
  await calls(api, [{ id: 'audit', name: 'Audit order', calledElement: 'auditChild' }]);
  await api.setProperty('audit', 'call.inheritVariables', true);

  // --- call-mappings --------------------------------------------------------------------------------------------------
  await newProcess(api, 'call-mappings', 'callMappings', 'Call activities with extensions mappings',
    'The Activiti 7+ extensions mapping of a call activity. riskLookup passes selected inputs (VARIABLE, VALUE) and a constant to a child that declares properties (they are validated and defaulted) and takes back only the mapped outputs. passAll uses MAP_ALL in both directions. passBare uses MAP_ALL too, but its child has no extensions file: the inputs are then dropped (only a child with an extensions file receives mapped inputs), while the outputs still come back.');
  await calls(api, [
    { id: 'riskLookup', name: 'Look up risk', calledElement: 'riskCheck' },
    { id: 'passAll', name: 'Pass everything', calledElement: 'echoChild' },
    { id: 'passBare', name: 'Pass to a bare child', calledElement: 'leafChild' },
  ]);
  await api.setExtensions({ properties: [{ name: 'customerId', type: 'string' }, { name: 'score', type: 'integer' }, { name: 'band', type: 'string' }] });
  await api.setProperty('riskLookup', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'customerId' }, channel: { type: 'VALUE', value: 'web' } });
  await api.setProperty('riskLookup', 'mapping.outputs', { score: { type: 'VARIABLE', value: 'riskScore' }, band: { type: 'VARIABLE', value: 'riskBand' } });
  await api.setProperty('riskLookup', 'constants.values', { model: 'v2' });
  await api.setProperty('passAll', 'mapping.type', 'MAP_ALL');
  await api.setProperty('passBare', 'mapping.type', 'MAP_ALL');

  // --- call-multi-instance --------------------------------------------------------------------------------------------
  await newProcess(api, 'call-multi-instance', 'callMultiInstance', 'Multi-instance call activities',
    'inspectAll starts one child per item in parallel (collection, element variable, results collected through loopDataOutputRef and outputDataItem); stepEach starts a child per round in sequence (loop cardinality, element index variable passed on through activiti:in sourceExpression). In Activiti 9.0.0 nothing comes back from the children of a multi-instance call activity: the multi-instance wrapper does not forward the completion of the sub process to the call activity behavior, so activiti:out, output mappings and outputDataItem see no child variables (the collections hold null entries).');
  await calls(api, [
    { id: 'inspectAll', name: 'Inspect each item', calledElement: 'itemChild' },
    { id: 'stepEach', name: 'Step each round', calledElement: 'positionChild' },
  ]);
  await api.setProperty('inspectAll', 'call.in', [{ source: 'item', target: 'item' }]);
  await api.setProperty('inspectAll', 'call.out', [{ source: 'result', target: 'lastResult' }]);
  await api.setProperty('inspectAll', 'mi.type', 'parallel');
  await api.setProperty('inspectAll', 'mi.collection', 'items');
  await api.setProperty('inspectAll', 'mi.elementVariable', 'item');
  await api.setProperty('inspectAll', 'mi.outputCollection', 'itemResults');
  await api.setProperty('inspectAll', 'mi.outputItem', 'result');
  await api.setProperty('stepEach', 'call.in', [{ sourceExpression: '${step}', target: 'position' }]);
  await api.setProperty('stepEach', 'call.out', [{ source: 'result', target: 'lastStepResult' }]);
  await api.setProperty('stepEach', 'mi.type', 'sequential');
  await api.setProperty('stepEach', 'mi.cardinality', '${rounds}');
  await api.setProperty('stepEach', 'mi.elementIndexVariable', 'step');
  await api.setProperty('stepEach', 'mi.outputCollection', 'stepResults');
  await api.setProperty('stepEach', 'mi.outputItem', 'result');
}

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C11-call-activities`. */
export const uiDriven = true;
