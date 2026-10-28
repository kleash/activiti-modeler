import {
  DMN_MATCHED, DMN_MATCHED_RULES, implementationTypeOf, isMultiResult, type CatalogDecision, type DiagramElement, type MappingInputs, type MappingOutputs,
} from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';
import type { Row, RowColumn } from '../components/RowsEntry';
import type { PanelEnv } from '../env';
import { inputValueDiagnostic, jsonPatchProblem, mappingNameProblem, outputValueDiagnostic, valueFromText, valueToText } from '../validation/mapping';
import type { Diagnostic } from '../validation/types';

/** What the runtime maps for an element (R1 6.2.4). */
export type MappingKind = 'connector' | 'decision' | 'userTask' | 'callActivity' | 'start' | 'catch' | 'throw' | 'signal';

export interface MappingScope {
  kind: MappingKind;
  inputs: boolean;
  outputs: boolean;
  constants: boolean;
  /** The mapping types that make sense: MAP_ALL on a start or catch event is an output mapping, on a throw event an input mapping. */
  types: string[];
}

const ALL = ['MAP_ALL', 'MAP_ALL_INPUTS', 'MAP_ALL_OUTPUTS'];

const definitionTypes = (element: DiagramElement): string[] =>
  ((element.businessObject.get('eventDefinitions') as Array<{ $type: string }> | undefined) ?? []).map((d) => d.$type);

/** The kind of mapping an element takes; undefined where the engine reads none. */
export function mappingScope(element: DiagramElement): MappingScope | undefined {
  if (element.labelTarget || !element.businessObject) return undefined;
  const scope = (kind: MappingKind, inputs: boolean, outputs: boolean, constants: boolean, types: string[]): MappingScope => ({ kind, inputs, outputs, constants, types });
  switch (element.type) {
    case 'bpmn:ServiceTask': {
      const impl = implementationTypeOf(element);
      return impl === 'connector' || impl === 'decision' ? scope(impl, true, true, true, ALL) : undefined;
    }
    case 'bpmn:UserTask':
      return scope('userTask', true, true, true, ALL);
    case 'bpmn:CallActivity':
      return scope('callActivity', true, true, true, ALL);
    case 'bpmn:StartEvent': {
      const defs = definitionTypes(element);
      if (defs.length === 0 || defs.includes('bpmn:MessageEventDefinition')) return scope('start', false, true, false, ['MAP_ALL', 'MAP_ALL_OUTPUTS']);
      return defs.includes('bpmn:SignalEventDefinition') ? scope('signal', false, false, false, []) : undefined;
    }
    case 'bpmn:IntermediateCatchEvent':
    case 'bpmn:BoundaryEvent': {
      const defs = definitionTypes(element);
      if (defs.includes('bpmn:MessageEventDefinition')) return scope('catch', false, true, false, ['MAP_ALL', 'MAP_ALL_OUTPUTS']);
      return defs.includes('bpmn:SignalEventDefinition') ? scope('signal', false, false, false, []) : undefined;
    }
    case 'bpmn:IntermediateThrowEvent':
    case 'bpmn:EndEvent': {
      const defs = definitionTypes(element);
      if (defs.includes('bpmn:MessageEventDefinition')) return scope('throw', true, false, true, ['MAP_ALL', 'MAP_ALL_INPUTS']);
      return defs.includes('bpmn:SignalEventDefinition') ? scope('signal', false, false, false, []) : undefined;
    }
    default:
      return undefined;
  }
}

const KIND_LABEL: Record<MappingKind, { input: string; output: string; source: string }> = {
  connector: { input: 'Connector input', output: 'Process variable', source: 'Connector output' },
  decision: { input: 'Decision input', output: 'Process variable', source: 'Decision output' },
  userTask: { input: 'Task variable', output: 'Process variable', source: 'Task variable' },
  callActivity: { input: 'Variable in the called process', output: 'Variable in this process', source: 'Variable of the called process' },
  start: { input: 'Name', output: 'Process variable', source: 'Start payload variable' },
  catch: { input: 'Name', output: 'Process variable', source: 'Message payload variable' },
  throw: { input: 'Payload field', output: 'Name', source: 'Name' },
  signal: { input: 'Name', output: 'Name', source: 'Name' },
};

const upper = (v: unknown): string => String(v ?? '').toUpperCase();

interface Endpoints {
  /** Names the task can receive (connector inputs, decision inputs). */
  inputs: string[];
  /** Names the task can return (connector outputs, decision outputs and the matched flags, completion variables of a user task). */
  outputs: string[];
}

/** Names the connector or decision of the element declares, for the autocomplete of mapping rows. */
function endpointsOf(env: PanelEnv, element: DiagramElement, scope: MappingScope, mapped: string[]): Endpoints {
  if (scope.kind === 'connector') {
    const found = env.catalog.action(element.businessObject.get('implementation') as string | undefined);
    return { inputs: found?.action.inputs.map((i) => i.name) ?? [], outputs: found?.action.outputs.map((o) => o.name) ?? [] };
  }
  if (scope.kind === 'decision') {
    const found = env.get<{ decision: CatalogDecision } | undefined>(element, 'decision.info');
    const decision = found?.decision;
    const outputs = decision ? (isMultiResult(decision) ? [decision.id] : decision.outputs.flatMap((o) => (o.name ? [o.name] : []))) : [];
    return { inputs: decision?.inputs ?? [], outputs: [...outputs, DMN_MATCHED, DMN_MATCHED_RULES] };
  }
  if (scope.kind === 'userTask') return { inputs: [], outputs: ['sys_task_assignee', ...mapped] };
  return { inputs: [], outputs: [] };
}

const unique = (names: string[]): string[] => [...new Set(names.filter(Boolean))];

const inputRows = (inputs: MappingInputs): Row[] =>
  Object.entries(inputs).map(([target, m]) => ({ target, type: upper(m.type), value: upper(m.type) === 'VARIABLE' ? String(m.value ?? '') : valueToText(m.value) }));

const outputRows = (outputs: MappingOutputs): Row[] =>
  Object.entries(outputs).map(([target, m]) => ({
    target,
    type: upper(m.type),
    value: upper(m.type) === 'VARIABLE' ? String(m.value ?? '') : upper(m.type) === 'JSONPATCH' ? JSON.stringify(m.value) : valueToText(m.value),
  }));

/** True for a row whose key an earlier row has: the first one stays, the later ones are refused. */
const isLaterDuplicate = (rows: Row[], row: Row, key: string): boolean => rows.findIndex((r) => r[key] === row[key]) !== rows.indexOf(row);

const duplicate = (value: string | undefined, row: Row, rows: Row[]): Diagnostic | undefined =>
  value && isLaterDuplicate(rows, row, 'target') ? { severity: 'error', message: `"${value}" is mapped twice; a name can have one row.` } : undefined;

function inputColumns(scope: MappingScope, endpoints: Endpoints, variables: string[]): RowColumn[] {
  const label = KIND_LABEL[scope.kind];
  return [
    { key: 'target', kind: 'text', label: label.input, suggest: () => endpoints.inputs, validate: (v, row, rows) => duplicate(v, row, rows) },
    { key: 'type', kind: 'select', label: 'Taken from', options: [{ value: 'VARIABLE', label: 'A process variable' }, { value: 'VALUE', label: 'A value' }] },
    {
      key: 'value',
      kind: 'text',
      label: 'Variable or value',
      placeholder: (row) => (row['type'] === 'VARIABLE' ? 'customerId' : 'text, a number, true, or ${expression}'),
      suggest: (row) => (row['type'] === 'VARIABLE' ? variables : []),
      hint: (row) => (row['type'] === 'VALUE' ? 'Text is stored as it is. A number, true, false, null, a list or an object is stored as JSON; write "42" in quotes for the text 42. ${...} is resolved when the task runs.' : undefined),
      validate: (v, row) => (row['type'] === 'VARIABLE' ? mappingNameProblem(v, 'A variable') : inputValueDiagnostic(v)),
    },
  ];
}

function outputColumns(scope: MappingScope, endpoints: Endpoints, declared: string[]): RowColumn[] {
  const label = KIND_LABEL[scope.kind];
  return [
    { key: 'target', kind: 'text', label: label.output, suggest: () => declared, validate: (v, row, rows) => duplicate(v, row, rows) ?? mappingNameProblem(v, 'The target') },
    { key: 'type', kind: 'select', label: 'Set from', options: [{ value: 'VARIABLE', label: 'A variable of the result' }, { value: 'VALUE', label: 'A value' }, { value: 'JSONPATCH', label: 'A JSON patch of the variable' }] },
    {
      key: 'value',
      kind: 'text',
      label: 'Result variable, value or patch',
      placeholder: (row) => (row['type'] === 'VARIABLE' ? 'result' : row['type'] === 'JSONPATCH' ? '[{ "op": "add", "path": "/name", "value": "Ann" }]' : 'text, a number or true'),
      suggest: (row) => (row['type'] === 'VARIABLE' ? endpoints.outputs : []),
      hint: (row) =>
        row['type'] === 'VARIABLE'
          ? 'A result variable that is null is skipped: the process variable keeps its previous value.'
          : row['type'] === 'JSONPATCH'
            ? 'A JSON patch (RFC 6902) of the current value of the process variable. The result is ignored; a path may contain ${name} (a text or integer variable).'
            : 'Expressions are not allowed in an output value.',
      validate: (v, row) => (row['type'] === 'VARIABLE' ? mappingNameProblem(v, 'A result variable') : row['type'] === 'JSONPATCH' ? jsonPatchProblem(v) : outputValueDiagnostic(v)),
    },
  ];
}

/** Text of the engine's behaviour for this kind of element: shown under the fields so that nobody has to guess what happens. */
function hints(b: EntryBuilder, scope: MappingScope, type: string | undefined, outputs: MappingOutputs): Definition[] {
  const out: Definition[] = [];
  const note = (id: string, text: string, severity: 'info' | 'warning' = 'info'): void => void out.push(b.info(`mapping.${id}.hint`, text, severity, 'mapping.type'));
  switch (scope.kind) {
    case 'userTask':
      note('userTask', 'Without a mapping the task has no task-local variables and its completion variables never reach the process. An output mapping runs on every completion, also without variables, and can read the input-mapped variables and sys_task_assignee (the assignee).');
      if (type === 'MAP_ALL' || type === 'MAP_ALL_OUTPUTS') note('userTask.all', 'MAP_ALL and MAP_ALL_OUTPUTS also copy sys_task_assignee and every input-mapped variable into the process.', 'warning');
      break;
    case 'connector':
      note('connector', 'The connector gets only the mapped inputs and the constants. Its outputs reach the process only through the output mapping, and only variables that are declared (the modeler declares the targets of the rows below).');
      break;
    case 'decision':
      note('decision', 'The decision gets only the mapped inputs: an input that is missing is null in FEEL and shows up as "no rule matched". The outputs reach the process only through the output mapping; with no match the output columns are not emitted, so a mapped variable keeps its previous value.');
      break;
    case 'callActivity':
      note('callActivity', 'Mapped inputs reach the called process only when it has an entry in its own extensions file (properties may be empty). Its property defaults fill missing inputs and a missing required property fails the call. Outputs and MAP_ALL are applied when the child ends; activiti:in / activiti:out are applied after the mapping.');
      break;
    case 'start':
      note('start', 'The mapping of a start event is an output mapping on the start payload: once it yields a variable, only the mapped variables reach the process and the rest of the payload is dropped. A VALUE output is always added.');
      break;
    case 'catch':
      note('catch', 'Without a mapping the payload of the message is dropped. The mapping is an output mapping of the payload variables.');
      break;
    case 'throw':
      note('throw', 'The inputs and constants of a throw event become the payload of the message. The message is only delivered by a ThrowMessage delegate of the application.');
      break;
    case 'signal':
      note('signal', 'Signal payloads are not mapped: the signal hands every variable of the throwing execution to the catching one as a process variable. A mapping on a signal event has no effect.', 'warning');
      break;
  }
  if (scope.outputs && Object.values(outputs).some((o) => upper(o.type) === 'JSONPATCH')) {
    note('jsonpatch', 'A JSON patch changes the current value of its process variable and ignores the result of the task. Intermediate objects are created.');
  }
  return out;
}

/** Input / output mapping: the mapping type, the input and output rows with autocomplete, and the engine notes. */
export function mappingGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const scope = mappingScope(element);
  if (!scope || !env.has(element, 'mapping.type')) return [];
  if (scope.kind === 'signal') {
    return [group({ id: 'mapping', label: 'Input / output mapping', entries: hints(b, scope, undefined, {}) })];
  }
  const type = env.get<string | undefined>(element, 'mapping.type');
  const inputs = scope.inputs ? env.get<MappingInputs>(element, 'mapping.inputs') : {};
  const outputs = scope.outputs ? env.get<MappingOutputs>(element, 'mapping.outputs') : {};
  const variables = unique(env.variables(element).map((v) => v.name));
  const declared = unique(env.variables(element).filter((v) => v.kind === 'property').map((v) => v.name));
  const endpoints = endpointsOf(env, element, scope, Object.keys(inputs));

  const entries: Definition[] = [
    b.select({
      key: 'mapping.type',
      label: 'Mapping type',
      options: [
        { value: '', label: 'Only the rows below' },
        ...scope.types.map((t) => ({
          value: t,
          label: t === 'MAP_ALL' ? 'MAP_ALL: everything' : t === 'MAP_ALL_INPUTS' ? 'MAP_ALL_INPUTS: every process variable goes in' : 'MAP_ALL_OUTPUTS: every result variable comes out',
        })),
      ],
      read: (raw) => String(raw ?? ''),
      write: (text) => text,
      description: scope.kind === 'start' || scope.kind === 'catch' ? 'On this element MAP_ALL maps the payload (an output mapping).' : undefined,
    }),
  ];
  const mapEntry = (key: 'mapping.inputs' | 'mapping.outputs', label: string, rows: Row[], columns: RowColumn[], toValue: (rows: Row[]) => unknown, missing: (row: Row, rows: Row[]) => string | undefined): Definition =>
    b.rowsRaw({
      id: key,
      label,
      help: key,
      addLabel: key === 'mapping.inputs' ? 'Add input' : 'Add output',
      rows,
      columns,
      blank: () => ({ target: '', type: 'VARIABLE', value: '' }),
      missing,
      commit: (list) => void env.write(element, key, toValue(list), key),
      rowTitle: (row) => String(row['target'] ?? ''),
      reorder: true,
    });
  const missingRow = (outputsRow: boolean) => (row: Row, rows: Row[]): string | undefined => {
    const target = String(row['target'] ?? '');
    if (!target) return outputsRow ? 'An output needs the process variable it sets' : 'An input needs a name';
    if (isLaterDuplicate(rows, row, 'target')) return `"${target}" is mapped twice`;
    const text = String(row['value'] ?? '');
    if (text === '') return row['type'] === 'VARIABLE' ? `"${target}" needs the variable it is taken from` : `"${target}" needs a ${row['type'] === 'JSONPATCH' ? 'patch' : 'value'}`;
    if (!outputsRow) return row['type'] === 'VALUE' && inputValueDiagnostic(text)?.severity === 'error' ? inputValueDiagnostic(text)!.message : undefined;
    if (row['type'] === 'JSONPATCH') return jsonPatchProblem(text)?.message;
    if (row['type'] === 'VALUE') return outputValueDiagnostic(text)?.message;
    return undefined;
  };
  if (scope.inputs) {
    entries.push(
      mapEntry(
        'mapping.inputs',
        scope.kind === 'throw' ? 'Payload' : 'Inputs',
        inputRows(inputs),
        inputColumns(scope, endpoints, variables),
        (rows) =>
          Object.fromEntries(
            rows.map((r) => [String(r['target']), { type: String(r['type']), value: r['type'] === 'VARIABLE' ? String(r['value']).trim() : valueFromText(String(r['value'])) }]),
          ),
        missingRow(false),
      ),
    );
  }
  if (scope.outputs) {
    entries.push(
      mapEntry(
        'mapping.outputs',
        'Outputs',
        outputRows(outputs),
        outputColumns(scope, endpoints, declared),
        (rows) =>
          Object.fromEntries(
            rows.map((r) => [
              String(r['target']),
              { type: String(r['type']), value: r['type'] === 'VARIABLE' ? String(r['value']).trim() : r['type'] === 'JSONPATCH' ? (JSON.parse(String(r['value'])) as unknown) : valueFromText(String(r['value'])) },
            ]),
          ),
        missingRow(true),
      ),
    );
    const undeclared = Object.keys(outputs).filter((target) => !declared.includes(target));
    if (undeclared.length > 0) {
      entries.push(b.info('mapping.outputs.undeclared', `${undeclared.join(', ')} ${undeclared.length === 1 ? 'is' : 'are'} not declared as process variables; the engine drops an output whose target is not declared.`, 'warning', 'mapping.outputs'));
    }
  }
  if (scope.kind === 'connector' || scope.kind === 'decision') {
    entries.push(b.check({ key: 'mapping.ephemeral', label: 'Ephemeral variables' }));
    entries.push(b.info('mapping.ephemeral.hint', 'Ephemeral is only a flag the connector can read (IntegrationContext.hasEphemeralVariables()); the engine does nothing else with it.', 'info', 'mapping.ephemeral'));
  }
  entries.push(...hints(b, scope, type, outputs));
  return [group({ id: 'mapping', label: 'Input / output mapping', entries, shouldOpen: true })];
}

/** Constants: fixed values that arrive as inputs of the task (they are merged with the mapped inputs). */
export function constantsGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const scope = mappingScope(element);
  if (!scope?.constants || !env.has(element, 'constants.values')) return [];
  const constants = env.get<Record<string, unknown>>(element, 'constants.values');
  const rows: Row[] = Object.entries(constants).map(([name, value]) => ({ name, value: valueToText(value) }));
  const entries: Definition[] = [
    b.rowsRaw({
      id: 'constants.values',
      label: 'Constants',
      help: 'constants.values',
      addLabel: 'Add constant',
      rows,
      columns: [
        { key: 'name', kind: 'text', label: 'Name', validate: (v, row, all) => (v && isLaterDuplicate(all, row, 'name') ? { severity: 'error', message: `The constant "${v}" is defined twice.` } : undefined) },
        {
          key: 'value',
          kind: 'text',
          label: 'Value (text or JSON)',
          placeholder: 'EU, 42, true or { "a": 1 }',
          hint: 'Text is stored as it is. A number, true, false, null, a list or an object is stored as JSON; write "42" in quotes for the text 42.',
        },
      ],
      blank: () => ({ name: '', value: '' }),
      missing: (row, all) => (!row['name'] ? 'A constant needs a name' : isLaterDuplicate(all, row, 'name') ? `The constant "${String(row['name'])}" is defined twice` : row['value'] === '' ? `"${String(row['name'])}" needs a value` : undefined),
      commit: (list) => void env.write(element, 'constants.values', Object.fromEntries(list.map((r) => [String(r['name']), valueFromText(String(r['value']))])), 'constants.values'),
      rowTitle: (row) => String(row['name'] ?? ''),
    }),
    b.info('constants.values.hint', 'Constants are added to the inputs of the task, after the mapped inputs, and do not need a process variable. They are passed on with or without MAP_ALL_INPUTS.', 'info', 'constants.values'),
  ];
  return [group({ id: 'constants', label: 'Constants', entries })];
}
