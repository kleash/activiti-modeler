import type { ProcessVariableDefinition } from '@activiti-modeler/activiti-project';

import { type DiagramElement, type ElementRegistry, type ModdleElement, is } from '../../types';
import type { ExtensionsStore } from '../extensions';
import { extensionsOfType, processOf } from './helpers';

/**
 * Read-only questions the properties panel asks about the diagram: the options of a picker and the variables an
 * expression can use. They live next to the accessors, so the panel itself never reads the model.
 */

export type VariableKind = 'property' | 'result' | 'loop' | 'dataObject' | 'initiator' | 'form' | 'field' | 'out' | 'builtin';

export interface VariableSuggestion {
  name: string;
  kind: VariableKind;
  /** Where the variable comes from, e.g. `result variable of "Calculate total"`. */
  detail: string;
  /** Declared type (process properties and data objects). */
  type?: string;
}

const NAME = /^[A-Za-z_$][\w$]*$/;
const label = (el: DiagramElement): string => `"${(el.businessObject.get('name') as string | undefined) || el.id}"`;
const stringField = (bo: ModdleElement, name: string): string | undefined => {
  const field = extensionsOfType(bo, 'activiti:Field').find((f) => f.get('name') === name);
  const value = (field?.get('stringValue') as string | undefined) ?? ((field?.get('string') as ModdleElement | undefined)?.get('body') as string | undefined);
  return value;
};

/**
 * The names an expression on `element` can read: declared process properties first, then what the diagram writes
 * (result variables, loop variables, data objects, the initiator, form properties, mail / shell output variables,
 * `activiti:out` targets) and the context objects of the place.
 */
export function variableSuggestions(registry: ElementRegistry, store: ExtensionsStore, element: DiagramElement): VariableSuggestion[] {
  const out = new Map<string, VariableSuggestion>();
  const add = (name: string | undefined, kind: VariableKind, detail: string, type?: string): void => {
    if (!name || !NAME.test(name) || out.has(name)) return;
    out.set(name, { name, kind, detail, ...(type ? { type } : {}) });
  };

  const process = processOf(element);
  const ext = process?.id ? store.getProcess(process.id) : undefined;
  for (const p of Object.values(ext?.properties ?? {}) as ProcessVariableDefinition[]) add(p.name, 'property', 'process variable', p.type);
  // task-local variables of the element itself (input mapping targets)
  for (const name of Object.keys(ext?.mappings[element.id]?.inputs ?? {})) add(name, 'property', `input of ${label(element)}`);

  for (const el of registry.getAll()) {
    const bo = el.businessObject;
    if (!bo || el.labelTarget || el.waypoints) continue;
    if (processOf(el) !== process) continue;
    const here = label(el);
    if (is(el, 'bpmn:ScriptTask')) add(bo.get('activiti:resultVariable') as string | undefined, 'result', `result variable of ${here}`);
    if (is(el, 'bpmn:ServiceTask')) {
      add(bo.get('activiti:resultVariableName') as string | undefined, 'result', `result variable of ${here}`);
      for (const field of ['outputVariable', 'errorCodeVariable', 'exceptionVariableName']) add(stringField(bo, field), 'field', `${field} of ${here}`);
    }
    if (is(el, 'bpmn:StartEvent')) {
      add(bo.get('activiti:initiator') as string | undefined, 'initiator', `initiator of ${here}`);
    }
    for (const p of extensionsOfType(bo, 'activiti:FormProperty')) add(p.get('id') as string | undefined, 'form', `form property of ${here}`);
    if (is(el, 'bpmn:CallActivity')) {
      for (const o of extensionsOfType(bo, 'activiti:Out')) add(o.get('target') as string | undefined, 'out', `out parameter of ${here}`);
    }
    if (is(el, 'bpmn:DataObject') || is(el, 'bpmn:DataObjectReference')) {
      const object = is(el, 'bpmn:DataObjectReference') ? (bo.get('dataObjectRef') as ModdleElement | undefined) : bo;
      add(object?.get('name') as string | undefined, 'dataObject', `data object`, (object?.get('itemSubjectRef') as string | undefined) ?? 'string');
    }
    const loop = bo.get('loopCharacteristics') as ModdleElement | undefined;
    if (loop?.$instanceOf('bpmn:MultiInstanceLoopCharacteristics')) {
      add(loop.get('activiti:elementVariable') as string | undefined, 'loop', `element variable of ${here}`);
      add((loop.get('activiti:elementIndexVariable') as string | undefined) ?? 'loopCounter', 'loop', `index of ${here}`);
      add(loop.get('loopDataOutputRef') as string | undefined, 'loop', `output collection of ${here}`);
      add((loop.get('outputDataItem') as ModdleElement | undefined)?.get('name') as string | undefined, 'loop', `output element of ${here}`);
      const collection = loop.get('activiti:collection') as string | undefined;
      if (collection && NAME.test(collection)) add(collection, 'loop', `collection of ${here}`);
      for (const builtin of ['nrOfInstances', 'nrOfCompletedInstances', 'nrOfActiveInstances']) add(builtin, 'builtin', `multi-instance counter of ${here}`);
    }
    // data objects of a process or sub process are flow elements without a shape
    for (const flowElement of (bo.get?.('flowElements') as ModdleElement[] | undefined) ?? []) {
      if (flowElement.$instanceOf('bpmn:DataObject')) add(flowElement.get('name') as string | undefined, 'dataObject', 'data object', (flowElement.get('itemSubjectRef') as string | undefined) ?? 'string');
    }
  }
  for (const flowElement of (process?.get('flowElements') as ModdleElement[] | undefined) ?? []) {
    if (flowElement.$instanceOf('bpmn:DataObject')) add(flowElement.get('name') as string | undefined, 'dataObject', 'data object', (flowElement.get('itemSubjectRef') as string | undefined) ?? 'string');
  }

  add('execution', 'builtin', 'the current execution');
  if (is(element, 'bpmn:UserTask')) add('task', 'builtin', 'the task (in task listeners)');
  return [...out.values()];
}

export interface ElementChoice {
  id: string;
  name?: string;
  type: string;
}

const choice = (el: DiagramElement): ElementChoice => {
  const name = el.businessObject.get('name') as string | undefined;
  return { id: el.id, type: el.type, ...(name ? { name } : {}) };
};

/** Link catch events of the diagram: the targets a link throw event can jump to. */
export function linkCatchEvents(registry: ElementRegistry): ElementChoice[] {
  return registry
    .filter((el) => !el.labelTarget && is(el, 'bpmn:IntermediateCatchEvent') && ((el.businessObject.get('eventDefinitions') as ModdleElement[] | undefined) ?? []).some((d) => d.$instanceOf('bpmn:LinkEventDefinition')))
    .map(choice);
}

export interface CompensationTarget extends ElementChoice {
  kind: 'handler' | 'subProcess' | 'activity';
  /** The activity has a compensation boundary event: `activityRef` must name its handler instead (engine finding C08.2). */
  hasCompensationBoundary: boolean;
}

/**
 * What a compensation throw event can name: compensation handlers (`isForCompensation`) and sub processes. Other activities
 * are listed last because the engine finds nothing for them when a boundary event guards them (the subscription is keyed by the handler).
 */
export function compensationTargets(registry: ElementRegistry): CompensationTarget[] {
  const boundaryHosts = new Set<string>();
  for (const el of registry.getAll()) {
    if (el.labelTarget || !is(el, 'bpmn:BoundaryEvent') || !el.host) continue;
    if (((el.businessObject.get('eventDefinitions') as ModdleElement[] | undefined) ?? []).some((d) => d.$instanceOf('bpmn:CompensateEventDefinition'))) boundaryHosts.add(el.host.id);
  }
  const targets: CompensationTarget[] = [];
  for (const el of registry.getAll()) {
    if (el.labelTarget || !is(el, 'bpmn:Activity')) continue;
    const bo = el.businessObject;
    const kind: CompensationTarget['kind'] = bo.get('isForCompensation') === true ? 'handler' : is(el, 'bpmn:SubProcess') ? 'subProcess' : 'activity';
    targets.push({ ...choice(el), kind, hasCompensationBoundary: boundaryHosts.has(el.id) });
  }
  const order = { handler: 0, subProcess: 1, activity: 2 } as const;
  return targets.sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
}

export interface EventPlacement {
  kind: 'start' | 'boundary' | 'intermediate' | 'end';
  /** A boundary event or event sub process start that cancels its activity (the default). */
  interrupting: boolean;
}

/** Where an event sits, for hints that depend on it (a cycle on an interrupting boundary timer never repeats). */
export function eventPlacement(element: DiagramElement): EventPlacement {
  const bo = element.businessObject;
  const kind = is(element, 'bpmn:StartEvent') ? 'start' : is(element, 'bpmn:BoundaryEvent') ? 'boundary' : is(element, 'bpmn:EndEvent') ? 'end' : 'intermediate';
  const interrupting = kind === 'boundary' ? bo.get('cancelActivity') !== false : kind === 'start' ? bo.get('isInterrupting') !== false : true;
  return { kind, interrupting };
}
