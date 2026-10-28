import type { DeclareHints, MappingValue } from '@activiti-modeler/activiti-project';

import { DMN_DECISION_IMPLEMENTATION, DMN_TABLE_CONSTANT } from '../../support-matrix';
import { type DiagramElement, is } from '../../types';
import { isMultiResult, type CatalogDecision } from '../project/ProjectCatalog';
import { bo, processIdFor } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

/** The outputs the DMN connector always adds, next to the output columns (ADR 0004). */
export const DMN_MATCHED = '_activiti_dmn_matched_';
export const DMN_MATCHED_RULES = '_activiti_dmn_matched_rules_';

/** The process variable type that holds a FEEL type; undefined when there is no sure answer (the declaration then falls back to json). */
export function variableTypeOfFeel(typeRef: string | undefined): string | undefined {
  switch ((typeRef ?? '').trim().toLowerCase()) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    // FEEL numbers are BigDecimals, whatever the column is called
    case 'number':
    case 'integer':
    case 'long':
    case 'double':
      return 'bigdecimal';
    case 'date':
      return 'date';
    case 'date and time':
    case 'datetime':
      return 'datetime';
    default:
      return undefined;
  }
}

const isDecisionTask = (el: DiagramElement): boolean => is(el, 'bpmn:ServiceTask') && bo(el).get('implementation') === DMN_DECISION_IMPLEMENTATION;

/** The decision a decision task names (its `_activiti_dmn_table_` constant), when a DMN file of the project defines it. */
export function decisionOf(ctx: AccessorContext, el: DiagramElement): { file: string; decision: CatalogDecision } | undefined {
  const value = ctx.store.getProcess(processIdFor('decision.table', el))?.constants[el.id]?.[DMN_TABLE_CONSTANT]?.value;
  const found = typeof value === 'string' ? ctx.catalog.decision(value) : undefined;
  return found ? { file: found.file.path, decision: found.decision } : undefined;
}

/** What each variable the DMN connector can return holds, by its source name: for the types of the properties an output mapping declares. */
export function decisionSourceTypes(decision: CatalogDecision): Record<string, string> {
  const types: Record<string, string> = { [DMN_MATCHED]: 'boolean', [DMN_MATCHED_RULES]: 'array' };
  if (isMultiResult(decision)) types[decision.id] = 'array';
  else for (const output of decision.outputs) if (output.name) types[output.name] = variableTypeOfFeel(output.type) ?? '';
  for (const key of Object.keys(types)) if (types[key] === '') delete types[key];
  return types;
}

/** The types of the values a connector or decision task can return, by name, from the project's catalog. */
export function sourceTypesFor(ctx: AccessorContext, el: DiagramElement): DeclareHints['sourceTypes'] {
  if (!is(el, 'bpmn:ServiceTask')) return {};
  const implementation = bo(el).get('implementation') as string | undefined;
  if (implementation === DMN_DECISION_IMPLEMENTATION) {
    const found = decisionOf(ctx, el);
    return found ? decisionSourceTypes(found.decision) : { [DMN_MATCHED]: 'boolean', [DMN_MATCHED_RULES]: 'array' };
  }
  const action = ctx.catalog.action(implementation);
  return Object.fromEntries((action?.action.outputs ?? []).filter((o) => o.type).map((o) => [o.name, o.type]));
}

export interface DecisionPick {
  /** The decision id (or a DMN file name, which names the file's single sink decision). */
  decision: string;
  /** Map the inputs the decision reads (default true). */
  inputs?: boolean;
  /** Map the output columns, or the result list of a multi-result decision (default true). */
  outputs?: boolean;
  /** Process variable that receives `_activiti_dmn_matched_`. */
  matched?: string;
  /** Process variable that receives `_activiti_dmn_matched_rules_`. */
  matchedRules?: string;
}

/**
 * Picks the decision of a decision task and wires the task to it in one step: the decision id into the constant, a VARIABLE input for every
 * input the decision reads, and a VARIABLE output for every output it returns (their targets are declared in `properties`). Rows the task
 * already has are left as they are, so picking again only adds what is missing.
 */
const decisionPick: PropertyAccessor<DecisionPick> = {
  key: 'decision.pick',
  group: 'Decision',
  label: 'Decision to evaluate',
  writes: 'ext',
  appliesTo: isDecisionTask,
  get: (ctx, el) => ({ decision: (ctx.store.getProcess(processIdFor('decision.pick', el))?.constants[el.id]?.[DMN_TABLE_CONSTANT]?.value as string | undefined) ?? '' }),
  set: (ctx, el, value) => {
    if (!value || typeof value.decision !== 'string' || value.decision === '') throw new AccessorError('INVALID_VALUE', 'decision.pick', 'name the decision to evaluate');
    const found = ctx.catalog.decision(value.decision);
    const decisionId = found?.decision.id ?? value.decision;
    ctx.run(el, 'decision.table', decisionId);
    if (!found) return;
    const processId = processIdFor('decision.pick', el);
    const mapping = structuredClone(ctx.store.getProcess(processId)?.mappings[el.id] ?? {});
    const inputs: Record<string, MappingValue> = { ...(mapping.inputs ?? {}) };
    if (value.inputs !== false) for (const name of found.decision.inputs) if (!(name in inputs)) inputs[name] = { type: 'VARIABLE', value: name };
    const outputs: Record<string, MappingValue> = { ...(mapping.outputs ?? {}) };
    const alreadyRead = new Set(Object.values(outputs).filter((o) => o.type === 'VARIABLE').map((o) => String(o.value)));
    const addOutput = (source: string): void => {
      if (alreadyRead.has(source) || source in outputs) return;
      outputs[source] = { type: 'VARIABLE', value: source };
    };
    if (value.outputs !== false) {
      if (isMultiResult(found.decision)) addOutput(found.decision.id);
      else for (const output of found.decision.outputs) if (output.name) addOutput(output.name);
    }
    if (value.matched && !alreadyRead.has(DMN_MATCHED)) outputs[value.matched] = { type: 'VARIABLE', value: DMN_MATCHED };
    if (value.matchedRules && !alreadyRead.has(DMN_MATCHED_RULES)) outputs[value.matchedRules] = { type: 'VARIABLE', value: DMN_MATCHED_RULES };
    if (Object.keys(inputs).length > 0) mapping.inputs = inputs;
    if (Object.keys(outputs).length > 0) mapping.outputs = outputs;
    ctx.store.setMapping(processId, el.id, mapping, { declare: true, hints: { sourceTypes: decisionSourceTypes(found.decision) } });
  },
};

/** Read only: the decision a task names, as the project defines it (undefined when no DMN file of the project has it). */
const decisionInfo: PropertyAccessor<{ file: string; decision: CatalogDecision } | undefined> = {
  key: 'decision.info',
  group: 'Decision',
  label: 'Decision of the task',
  writes: 'ext',
  appliesTo: isDecisionTask,
  get: (ctx, el) => decisionOf(ctx, el),
  set: (ctx, el, value) => {
    if (JSON.stringify(value) !== JSON.stringify(decisionOf(ctx, el))) throw new AccessorError('READ_ONLY', 'decision.info', 'the decision is chosen with decision.pick or decision.table');
  },
};

export const decisionAccessors: AnyAccessor[] = [decisionPick, decisionInfo];
