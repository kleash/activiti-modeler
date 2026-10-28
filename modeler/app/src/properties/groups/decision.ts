import { isMultiResult, type CatalogDecision, type DecisionPick, type MappingInputs, type MappingOutputs } from '@activiti-modeler/bpmn-js-activiti';
import { DMN_MATCHED, DMN_MATCHED_RULES } from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';

interface Resolved {
  file: string;
  decision: CatalogDecision;
}

const listOf = (names: string[]): string => (names.length === 0 ? 'nothing' : names.join(', '));

/** The decision task: pick a DMN file and decision of the project, and wire the task to what the decision reads and returns (ADR 0004). */
export function decisionGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'decision.pick')) return [];
  const resolved = env.get<Resolved | undefined>(element, 'decision.info');
  const current = env.get<{ decision: string }>(element, 'decision.pick').decision;
  const files = env.catalog.dmn;
  const entries: Definition[] = [];

  if (files.length > 0) {
    const chosenKey = env.transientKey(element, 'decision.file');
    const chosen = (env.transient.get(chosenKey) as string | undefined) ?? resolved?.file ?? files[0]!.path;
    const file = files.find((f) => f.path === chosen) ?? files[0]!;
    entries.push(
      b.selectRaw({
        id: 'decision.pick.file',
        label: 'DMN file',
        value: file.path,
        options: files.map((f) => ({ value: f.path, label: f.path })),
        commit: (value) => {
          if (value === undefined) return;
          env.transient.set(chosenKey, value);
          env.refresh();
        },
      }),
      b.selectRaw({
        id: 'decision.pick',
        label: 'Decision',
        value: resolved?.decision.id ?? current,
        options: [{ value: '', label: '(choose a decision)' }, ...file.decisions.map((d) => ({ value: d.id, label: d.name ? `${d.name} (${d.id})` : d.id }))],
        description: 'Choosing a decision maps its inputs and outputs for you; the rows stay editable below.',
        commit: (value) => {
          if (value === undefined) return;
          env.write(element, 'decision.pick', { decision: value } satisfies DecisionPick, 'decision.pick');
        },
      }),
    );
  } else {
    entries.push(b.info('decision.pick.empty', 'The project has no DMN file yet. Add one (File > New file > DMN decision table) to pick a decision; until then type the decision id below.', 'info', 'decision.table'));
  }
  entries.push(b.text({ key: 'decision.table', label: 'Decision id', placeholder: 'riskLevel', validate: (v) => (v ? undefined : { severity: 'warning', message: 'Enter the id of the DMN decision to evaluate.' }) }));

  if (resolved) {
    const { decision } = resolved;
    const outputs = isMultiResult(decision) ? [`${decision.id} (a list of rows)`] : decision.outputs.flatMap((o) => (o.name ? [o.name] : []));
    entries.push(
      b.info('decision.info.summary', `${decision.name ?? decision.id} reads ${listOf(decision.inputs)} and returns ${listOf(outputs)}${decision.complexInputs.length > 0 ? `; ${decision.complexInputs.length} input expression${decision.complexInputs.length === 1 ? ' is' : 's are'} not a plain variable name and cannot be mapped by name` : ''}.`, 'info', 'decision.pick'),
    );
    const mapping = {
      inputs: env.get<MappingInputs>(element, 'mapping.inputs'),
      outputs: env.get<MappingOutputs>(element, 'mapping.outputs'),
    };
    const unmapped = decision.inputs.filter((name) => !(name in mapping.inputs));
    if (unmapped.length > 0) {
      entries.push(b.info('decision.inputs.hint', `${unmapped.join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} not mapped: a missing input is null in FEEL, so the decision evaluates as "no rule matched" instead of failing.`, 'warning', 'decision.pick'));
    }
    // the DMN file was edited after the task was wired: rows that name an output or an input the decision no longer has (stale mapping)
    const returned = new Set<string>([DMN_MATCHED, DMN_MATCHED_RULES, ...(isMultiResult(decision) ? [decision.id] : decision.outputs.flatMap((o) => (o.name ? [o.name] : [])))]);
    const staleOutputs = Object.entries(mapping.outputs).filter(([, m]) => m.type.toString().toUpperCase() === 'VARIABLE' && !returned.has(String(m.value)));
    if (staleOutputs.length > 0) {
      const names = staleOutputs.map(([target, m]) => `${String(m.value)} (stored in ${target})`);
      entries.push(
        b.info(
          'decision.outputs.stale',
          `The mapping is stale: the task reads ${names.join(', ')} from the decision, which does not return ${staleOutputs.length === 1 ? 'it' : 'them'} any more (it returns ${listOf([...returned].filter((r) => !r.startsWith('_activiti_')))}). Use "Map the outputs", or change the rows below.`,
          'warning',
          'decision.pick',
        ),
      );
    }
    const staleInputs = decision.complexInputs.length > 0 ? [] : Object.keys(mapping.inputs).filter((name) => !decision.inputs.includes(name));
    if (staleInputs.length > 0) {
      entries.push(b.info('decision.inputs.stale', `The mapping is stale: the task maps ${staleInputs.join(', ')}, which the decision does not read any more (it reads ${listOf(decision.inputs)}). Use "Map the inputs", or change the rows below.`, 'warning', 'decision.pick'));
    }
    const reads = new Set(Object.values(mapping.outputs).map((o) => String(o.value)));
    entries.push(
      b.action({
        id: 'decision.pick.actions',
        text: 'Wire the task to the decision:',
        buttons: [
          { id: 'inputs', label: 'Map the inputs', title: 'Add a VARIABLE input for every input the decision reads', run: () => void env.write(element, 'decision.pick', { decision: decision.id, inputs: true, outputs: false } satisfies DecisionPick, 'decision.pick') },
          { id: 'outputs', label: 'Map the outputs', title: 'Add an output for every output the decision returns; the targets are declared', run: () => void env.write(element, 'decision.pick', { decision: decision.id, inputs: false, outputs: true } satisfies DecisionPick, 'decision.pick') },
          {
            id: 'matched',
            label: 'Store "a rule matched"',
            title: 'Adds an output for _activiti_dmn_matched_ (a boolean)',
            disabled: reads.has(DMN_MATCHED),
            run: () => void env.write(element, 'decision.pick', { decision: decision.id, inputs: false, outputs: false, matched: 'decisionMatched' } satisfies DecisionPick, 'decision.pick'),
          },
          {
            id: 'matchedRules',
            label: 'Store the matched rules',
            title: 'Adds an output for _activiti_dmn_matched_rules_ (the ids of the rules that contributed, in result order)',
            disabled: reads.has(DMN_MATCHED_RULES),
            run: () => void env.write(element, 'decision.pick', { decision: decision.id, inputs: false, outputs: false, matchedRules: 'decisionMatchedRules' } satisfies DecisionPick, 'decision.pick'),
          },
        ],
      }),
    );
  } else if (current) {
    entries.push(b.info('decision.info.missing', `No DMN file of the project defines the decision "${current}" (a decision id, or the name of a DMN file, is expected).`, 'warning', 'decision.pick'));
  }
  entries.push(
    b.info(
      'decision.pick.hint',
      'The connector returns one variable per output column (the column name), or the list of result rows under the decision id for COLLECT without an aggregator, RULE ORDER and OUTPUT ORDER. It always adds _activiti_dmn_matched_ (whether a rule matched) and _activiti_dmn_matched_rules_ (the matched rule ids). With no match the output columns are not emitted. All of it reaches the process only through the output mapping.',
      'info',
      'decision.pick',
    ),
    b.info('decision.connector.hint', 'Activiti has no DMN engine: the application that runs this process needs the dependency io.github.kleash.activiti:activiti-dmn-connector. The modeler server already includes it.', 'info', 'decision'),
  );
  return [group({ id: 'decision', label: 'Decision', entries, shouldOpen: true })];
}
