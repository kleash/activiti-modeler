import { DMN_TABLE_CONSTANT } from '../../support-matrix';
import { type DiagramElement, is } from '../../types';
import { type ConstantValue, type DeclareHints, type MappingValue, type ProcessVariablesMapping, emptyProcessExtension } from '@activiti-modeler/activiti-project';
import { sourceTypesFor } from './decision';
import { assertOneOf, processIdFor } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

/** Elements that the runtime maps variables for: tasks, call activities and events (R1 §6.2.4). */
const mappable = (el: DiagramElement): boolean =>
  !el.labelTarget &&
  ((is(el, 'bpmn:Activity') && !is(el, 'bpmn:SubProcess')) || (is(el, 'bpmn:Event') && !is(el, 'bpmn:BoundaryEvent')) || is(el, 'bpmn:BoundaryEvent'));

export type MappingInputs = Record<string, { type: 'VARIABLE' | 'VALUE'; value: unknown }>;
export type MappingOutputs = Record<string, { type: 'VARIABLE' | 'VALUE' | 'JSONPATCH'; value: unknown; /** hint for the declared variable type; not stored */ declareType?: string }>;

const MAPPING_TYPES = ['MAP_ALL', 'MAP_ALL_INPUTS', 'MAP_ALL_OUTPUTS'] as const;

const upper = (type: unknown): string => String(type).toUpperCase();

function normalizeInputs(key: string, inputs: MappingInputs): Record<string, MappingValue> {
  const out: Record<string, MappingValue> = {};
  for (const [name, input] of Object.entries(inputs)) {
    if (!name) throw new AccessorError('INVALID_MAPPING', key, 'an input needs a target name');
    assertOneOf(key, upper(input.type), ['VARIABLE', 'VALUE'], `input "${name}" type`);
    out[name] = { type: upper(input.type), value: input.value };
  }
  return out;
}

function normalizeOutputs(key: string, outputs: MappingOutputs): { outputs: Record<string, MappingValue>; hints: DeclareHints } {
  const out: Record<string, MappingValue> = {};
  const hints: DeclareHints = { sourceTypes: {} };
  for (const [name, output] of Object.entries(outputs)) {
    if (!name) throw new AccessorError('INVALID_MAPPING', key, 'an output needs a process variable name');
    const type = upper(output.type);
    assertOneOf(key, type, ['VARIABLE', 'VALUE', 'JSONPATCH'], `output "${name}" type`);
    if (type === 'JSONPATCH' && !Array.isArray(output.value)) throw new AccessorError('INVALID_MAPPING', key, `output "${name}": a JSONPATCH value is an RFC 6902 patch array`);
    // output values may not contain expressions (R1 §6.2.4)
    if (type === 'VALUE' && typeof output.value === 'string' && /\$\{/.test(output.value)) throw new AccessorError('INVALID_MAPPING', key, `output "${name}": expressions are not allowed in output values`);
    out[name] = { type, value: output.value };
    if (output.declareType && type === 'VARIABLE') hints.sourceTypes![String(output.value)] = output.declareType;
  }
  return { outputs: out, hints };
}

function mappingAccessor<T>(options: {
  key: string;
  label: string;
  get(mapping: ProcessVariablesMapping | undefined): T;
  apply(mapping: ProcessVariablesMapping, value: T, ctx: AccessorContext, element: DiagramElement): DeclareHints | void;
}): PropertyAccessor<T> {
  return {
    key: options.key,
    group: 'Input / output mapping',
    label: options.label,
    writes: 'ext',
    appliesTo: mappable,
    get: (ctx, el) => options.get(ctx.store.getProcess(processIdFor(options.key, el))?.mappings[el.id]),
    set: (ctx, el, value) => {
      const processId = processIdFor(options.key, el);
      const current = ctx.store.getProcess(processId)?.mappings[el.id];
      const next: ProcessVariablesMapping = structuredClone(current ?? {});
      const hints = options.apply(next, value, ctx, el) ?? undefined;
      for (const k of ['inputs', 'outputs'] as const) if (next[k] && Object.keys(next[k]!).length === 0) delete next[k];
      if (next.ephemeral !== true) delete next.ephemeral;
      const empty = Object.keys(next).length === 0;
      ctx.store.setMapping(processId, el.id, empty ? undefined : next, { declare: true, hints });
    },
  };
}

const mappingType = mappingAccessor<string | undefined>({
  key: 'mapping.type',
  label: 'Mapping type',
  get: (m) => m?.mappingType as string | undefined,
  apply: (m, value) => {
    if (value === undefined || value === '' || upper(value) === 'NONE') delete m.mappingType;
    else {
      assertOneOf('mapping.type', upper(value), MAPPING_TYPES, 'mapping type');
      m.mappingType = upper(value);
    }
  },
});

const mappingInputs = mappingAccessor<MappingInputs>({
  key: 'mapping.inputs',
  label: 'Input mapping',
  get: (m) => structuredClone((m?.inputs ?? {}) as MappingInputs),
  apply: (m, value) => {
    m.inputs = normalizeInputs('mapping.inputs', value);
  },
});

const mappingOutputs = mappingAccessor<MappingOutputs>({
  key: 'mapping.outputs',
  label: 'Output mapping',
  get: (m) => structuredClone((m?.outputs ?? {}) as MappingOutputs),
  apply: (m, value, ctx, el) => {
    const { outputs, hints } = normalizeOutputs('mapping.outputs', value);
    m.outputs = outputs;
    // what the connector or decision declares for its outputs types the properties declared for the targets; a hint given with the value wins
    hints.sourceTypes = { ...sourceTypesFor(ctx, el), ...hints.sourceTypes };
    return hints;
  },
});

const mappingEphemeral = mappingAccessor<boolean>({
  key: 'mapping.ephemeral',
  label: 'Ephemeral variables',
  get: (m) => m?.ephemeral === true,
  apply: (m, value) => {
    if (typeof value !== 'boolean') throw new AccessorError('INVALID_VALUE', 'mapping.ephemeral', 'value must be a boolean');
    if (value) m.ephemeral = true;
    else delete m.ephemeral;
  },
});

/** Constants of an element; the decision-table constant belongs to `decision.table` and is left alone. */
const constants: PropertyAccessor<Record<string, unknown>> = {
  key: 'constants.values',
  group: 'Constants',
  label: 'Constants',
  writes: 'ext',
  appliesTo: mappable,
  get: (ctx, el) => {
    const stored = ctx.store.getProcess(processIdFor('constants.values', el))?.constants[el.id] ?? {};
    return Object.fromEntries(Object.entries(stored).filter(([name]) => name !== DMN_TABLE_CONSTANT).map(([name, c]) => [name, structuredClone(c.value)]));
  },
  set: (ctx, el, value) => {
    const processId = processIdFor('constants.values', el);
    const current = ctx.store.getProcess(processId)?.constants[el.id] ?? {};
    const next: Record<string, ConstantValue> = {};
    const dmn = current[DMN_TABLE_CONSTANT];
    if (dmn) next[DMN_TABLE_CONSTANT] = structuredClone(dmn);
    for (const [name, v] of Object.entries(value)) {
      if (!name) throw new AccessorError('INVALID_VALUE', 'constants.values', 'a constant needs a name');
      if (name === DMN_TABLE_CONSTANT) throw new AccessorError('RESERVED', 'constants.values', `${DMN_TABLE_CONSTANT} is set through decision.table`);
      next[name] = { value: v };
    }
    ctx.store.setConstants(processId, el.id, next);
  },
};

export const mappingAccessors: AnyAccessor[] = [mappingType, mappingInputs, mappingOutputs, mappingEphemeral, constants];

export { emptyProcessExtension };
