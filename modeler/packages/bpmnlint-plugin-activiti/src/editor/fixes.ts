/**
 * Quick fixes of the Problems panel. Each runs as one undoable command (`activiti.batch`), changes the BPMN XML and the
 * extensions store together, and leaves a model the rule no longer reports.
 */
import { declareOutputTargets, emptyProcessExtension, removeElementKey, type ProcessVariablesMapping } from '@activiti-modeler/activiti-project';

import { camundaOccurrences, type CamundaOccurrence } from '../rules/foreign';
import { str } from '../model';
import type { ME, Problem } from '../types';

export interface FixResult {
  ok: boolean;
  message?: string;
}

interface Injector {
  get<T>(name: string, strict?: boolean): T;
}

interface Shape {
  id: string;
  businessObject: ME;
  parent?: Shape;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Services {
  modeling: {
    updateModdleProperties(element: Shape, moddleElement: ME, properties: Record<string, unknown>): void;
    updateProperties(element: Shape, properties: Record<string, unknown>): void;
    removeElements(elements: Shape[]): void;
    createShape(shape: unknown, position: { x: number; y: number }, target: Shape, hints?: unknown): Shape;
    connect(source: Shape, target: Shape, attrs?: unknown): Shape;
  };
  bpmnFactory: { create(type: string, attrs?: Record<string, unknown>): ME };
  bpmnReplace: { replaceElement(element: Shape, target: Record<string, unknown>, hints?: unknown): Shape };
  elementRegistry: { get(id: string): Shape | undefined; getAll(): Shape[] };
  canvas: { getRootElement(): Shape };
  commandStack: { execute(command: string, context: unknown): void; undo(): void; _stack?: unknown[]; _stackIdx?: number };
  store: {
    setMapping(processId: string, elementId: string, mapping: ProcessVariablesMapping | undefined, options?: unknown): void;
    update(label: string, mutate: (file: { extensions: Record<string, ReturnType<typeof emptyProcessExtension>> }, ctx: { newId(): string }) => void): void;
  };
  accessors: { set(element: string, key: string, value: unknown): void };
  bpmnjs: { getDefinitions(): ME | undefined };
}

function services(injector: Injector): Services {
  return {
    modeling: injector.get('modeling'),
    bpmnFactory: injector.get('bpmnFactory'),
    bpmnReplace: injector.get('bpmnReplace'),
    elementRegistry: injector.get('elementRegistry'),
    canvas: injector.get('canvas'),
    commandStack: injector.get('commandStack'),
    store: injector.get('extensionsStore'),
    accessors: injector.get('propertyAccessors'),
    bpmnjs: injector.get('bpmnjs'),
  };
}

/** Runs `fn` as one undo step; on an error the partial work is undone and the error rethrown. */
function inOneStep(s: Services, fn: () => void): void {
  const context: { run: () => void; error?: unknown } = { run: fn };
  s.commandStack.execute('activiti.batch', context);
  if (context.error !== undefined) {
    s.commandStack.undo();
    if (s.commandStack._stack && typeof s.commandStack._stackIdx === 'number') s.commandStack._stack.length = s.commandStack._stackIdx + 1;
    throw context.error;
  }
}

const processIdOf = (bo: ME): string | undefined => {
  for (let current: ME | undefined = bo; current; current = current.$parent) if (current.$instanceOf('bpmn:Process')) return current.id;
  return undefined;
};

function need(s: Services, id: string | undefined): Shape {
  const shape = id ? s.elementRegistry.get(id) : undefined;
  if (!shape) throw new Error(`the element ${id ?? ''} is not on the canvas`);
  return shape;
}

// --- business rule task -> decision task ----------------------------------------------------------------------------

function convertBusinessRuleTask(s: Services, problem: Problem): void {
  const shape = need(s, problem.elementId);
  const old = shape.businessObject;
  const attrs = (old.$attrs ?? {}) as Record<string, string>;
  const decision = attrs['camunda:decisionRef'] ?? str(old, 'activiti:rules');
  const replacement = s.bpmnReplace.replaceElement(shape, { type: 'bpmn:ServiceTask' });
  s.accessors.set(replacement.id, 'impl.type', 'decision');
  if (decision) s.accessors.set(replacement.id, 'decision.table', decision);
  // a business rule task hands every process variable to the rules and takes the results back: MAP_ALL does the same
  const processId = processIdOf(replacement.businessObject);
  if (processId) s.store.setMapping(processId, replacement.id, { mappingType: 'MAP_ALL' });
}

// --- complex gateway -> exclusive gateway ----------------------------------------------------------------------------

function complexToExclusive(s: Services, problem: Problem): void {
  s.bpmnReplace.replaceElement(need(s, problem.elementId), { type: 'bpmn:ExclusiveGateway' });
}

// --- signal end event -> throw signal, then none end -----------------------------------------------------------------

function signalEndToThrow(s: Services, problem: Problem): void {
  const end = need(s, problem.elementId);
  const definition = ((end.businessObject.get('eventDefinitions') as ME[] | undefined) ?? []).find((d) => d.$instanceOf('bpmn:SignalEventDefinition'));
  const signalRef = definition?.get('signalRef');
  const expression = definition ? str(definition, 'activiti:signalExpression') : undefined;
  const container = end.parent;
  if (!container) throw new Error('the end event has no container');
  const centre = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
  const thrown = s.bpmnReplace.replaceElement(end, { type: 'bpmn:IntermediateThrowEvent' });
  const signal = s.bpmnFactory.create('bpmn:SignalEventDefinition', { ...(signalRef ? { signalRef } : {}), ...(expression ? { 'activiti:signalExpression': expression } : {}) });
  s.modeling.updateProperties(thrown, { eventDefinitions: [signal] });
  const last = s.modeling.createShape({ type: 'bpmn:EndEvent' }, { x: centre.x + 90, y: centre.y }, container);
  s.modeling.updateProperties(last, { name: 'End' });
  s.modeling.connect(thrown, last, { type: 'bpmn:SequenceFlow' });
}

// --- mappings ---------------------------------------------------------------------------------------------------------

function addMapAll(s: Services, problem: Problem): void {
  const shape = need(s, problem.elementId);
  const processId = processIdOf(shape.businessObject);
  if (!processId) throw new Error('the element does not belong to a process');
  s.store.setMapping(processId, shape.id, { mappingType: 'MAP_ALL' });
}

function declareOutputTarget(s: Services, problem: Problem): void {
  const target = String(problem.data?.['target']);
  const elementId = String(problem.data?.['elementId']);
  const processId = String(problem.data?.['processId']);
  s.store.update(`declare ${target}`, (file, ctx) => {
    const ext = (file.extensions[processId] ??= emptyProcessExtension());
    const output = ext.mappings[elementId]?.outputs?.[target];
    const declared = typeof problem.data?.['type'] === 'string' ? (problem.data['type'] as string) : undefined;
    const source = String((output ?? { value: target }).value);
    declareOutputTargets(ext, { outputs: { [target]: output ?? { type: 'VARIABLE', value: target } } }, () => ctx.newId(), declared ? { knownTypes: { [source]: declared } } : {});
  });
}

function removeProcessEntry(s: Services, problem: Problem): void {
  const key = String(problem.data?.['key']);
  s.store.update(`remove the entry of ${key}`, (file) => {
    delete file.extensions[key];
  });
}

function removeMappingKey(s: Services, problem: Problem): void {
  const key = String(problem.data?.['key']);
  const processId = String(problem.data?.['processId'] ?? (problem.elementId ? processIdOf(need(s, problem.elementId).businessObject) : ''));
  s.store.update(`remove entries of ${key}`, (file) => {
    const ext = file.extensions[processId];
    if (ext) removeElementKey(ext, key);
  });
}

// --- generic edits ----------------------------------------------------------------------------------------------------

function removeElement(s: Services, problem: Problem): void {
  const shape = problem.elementId ? s.elementRegistry.get(problem.elementId) : undefined;
  if (shape) {
    s.modeling.removeElements([shape]);
    return;
  }
  // a flow without an end is not on the canvas: take it out of its container
  const definitions = s.bpmnjs.getDefinitions();
  const hit = (function find(node: ME | undefined): { holder: ME; list: string; item: ME } | undefined {
    for (const list of ['flowElements', 'artifacts']) {
      for (const item of ((node?.get(list) as ME[] | undefined) ?? [])) {
        if (item.id === problem.elementId) return { holder: node!, list, item };
        const deeper = find(item.$instanceOf('bpmn:SubProcess') ? item : undefined);
        if (deeper) return deeper;
      }
    }
    for (const root of ((node?.get('rootElements') as ME[] | undefined) ?? [])) {
      const found = find(root.$instanceOf('bpmn:Process') ? root : undefined);
      if (found) return found;
    }
    return undefined;
  })(definitions);
  if (!hit) throw new Error(`cannot find ${problem.elementId ?? 'the element'}`);
  const holderShape = s.elementRegistry.get(hit.holder.id ?? '') ?? s.canvas.getRootElement();
  s.modeling.updateModdleProperties(holderShape, hit.holder, { [hit.list]: ((hit.holder.get(hit.list) as ME[]) ?? []).filter((x) => x !== hit.item) });
}

function setExecutable(s: Services, problem: Problem): void {
  const definitions = s.bpmnjs.getDefinitions();
  const process = ((definitions?.get('rootElements') as ME[] | undefined) ?? []).find((r) => r.$instanceOf('bpmn:Process') && r.id === problem.elementId);
  if (!process) throw new Error('process not found');
  const shape = s.elementRegistry.get(process.id ?? '') ?? s.canvas.getRootElement();
  s.modeling.updateModdleProperties(shape, process, { isExecutable: true });
}

function removeLoop(s: Services, problem: Problem): void {
  s.modeling.updateProperties(need(s, problem.elementId), { loopCharacteristics: undefined });
}

function removeAttribute(s: Services, problem: Problem): void {
  const name = String(problem.data?.['name']);
  const shape = need(s, problem.elementId);
  s.modeling.updateModdleProperties(shape, shape.businessObject, { [name]: undefined });
}

// --- camunda -> activiti ----------------------------------------------------------------------------------------------

/** A generic (unknown namespace) element: attributes are plain properties, nested elements are `$children`, text is `$body`. */
const genericAttrs = (node: ME): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) if (!key.startsWith('$') && typeof value === 'string') out[key] = value;
  return out;
};
const children = (node: ME): ME[] => (Array.isArray(node['$children']) ? (node['$children'] as ME[]) : []);
const local = (type: string): string => type.slice(type.indexOf(':') + 1);
const textOf = (node: ME): string | undefined => {
  const body = node['$body'];
  if (typeof body === 'string') return body;
  const text = children(node).map((c) => (typeof c['$body'] === 'string' ? (c['$body'] as string) : '')).join('');
  return text === '' ? undefined : text;
};

function fieldFrom(s: Services, node: ME): ME {
  const attrs = genericAttrs(node);
  const field = s.bpmnFactory.create('activiti:Field', { name: attrs['name'] ?? '' });
  if (attrs['stringValue'] !== undefined) field.set('stringValue', attrs['stringValue']);
  if (attrs['expression'] !== undefined) field.set('expression', attrs['expression']);
  for (const c of children(node)) {
    if (local(c.$type) === 'string') field.set('string', s.bpmnFactory.create('activiti:String', { body: textOf(c) ?? '' }));
    if (local(c.$type) === 'expression') field.set('expressionElement', s.bpmnFactory.create('activiti:Expression', { body: textOf(c) ?? '' }));
  }
  return field;
}

function listenerFrom(s: Services, node: ME, type: 'activiti:ExecutionListener' | 'activiti:TaskListener'): ME {
  const attrs = genericAttrs(node);
  const listener = s.bpmnFactory.create(type, {});
  for (const name of ['event', 'class', 'expression', 'delegateExpression', 'onTransaction', 'customPropertiesResolverClass', 'customPropertiesResolverExpression', 'customPropertiesResolverDelegateExpression']) {
    if (attrs[name] !== undefined) listener.set(name, attrs[name]);
  }
  const fields = children(node).filter((c) => local(c.$type) === 'field').map((c) => fieldFrom(s, c));
  if (fields.length > 0) listener.set('fields', fields);
  return listener;
}

/** Camunda input / output parameters as an extensions mapping: `${name}` is a variable, any other text a value. */
function mappingFromInputOutput(node: ME): ProcessVariablesMapping {
  const mapping: ProcessVariablesMapping = {};
  const value = (parameter: ME): string | undefined => textOf(parameter);
  const asEntry = (text: string | undefined): { type: string; value: unknown } | undefined => {
    if (text === undefined) return undefined;
    const variable = /^\s*[$#]\{\s*([\p{L}_][\p{L}\p{N}_]*)\s*\}\s*$/u.exec(text);
    return variable ? { type: 'VARIABLE', value: variable[1] } : { type: 'VALUE', value: text.trim() };
  };
  for (const parameter of children(node)) {
    const kind = local(parameter.$type);
    const name = genericAttrs(parameter)['name'];
    const entry = asEntry(value(parameter));
    if (!name || !entry) continue;
    if (kind === 'inputParameter') (mapping.inputs ??= {})[name] = entry;
    if (kind === 'outputParameter') (mapping.outputs ??= {})[name] = entry;
  }
  return mapping;
}

function translateCamundaElement(s: Services, owner: Shape, bo: ME, node: ME, occurrence: CamundaOccurrence): void {
  const container = bo.get('extensionElements') as ME | undefined;
  const values = ((container?.get('values') as ME[] | undefined) ?? []).slice();
  const index = values.indexOf(node);
  if (!container || index < 0) throw new Error('the element is not in the extension elements any more');
  const kind = occurrence.local;
  const replacement: ME[] = [];
  const props: Record<string, unknown> = {};
  let after: (() => void) | undefined;
  if (occurrence.action === 'element') {
    if (kind === 'executionListener') replacement.push(listenerFrom(s, node, 'activiti:ExecutionListener'));
    else if (kind === 'taskListener') replacement.push(listenerFrom(s, node, 'activiti:TaskListener'));
    else if (kind === 'field') replacement.push(fieldFrom(s, node));
    else if (kind === 'failedJobRetryTimeCycle') replacement.push(s.bpmnFactory.create('activiti:FailedJobRetryTimeCycle', { body: textOf(node) ?? '' }));
    else if (kind === 'in' || kind === 'out') {
      const attrs = genericAttrs(node);
      if (attrs['variables'] === 'all') {
        if (kind === 'in') props['activiti:inheritVariables'] = true;
        else {
          const processId = processIdOf(bo);
          if (processId && owner.id) after = () => s.store.setMapping(processId, owner.id, { mappingType: 'MAP_ALL_OUTPUTS' });
        }
      } else if (kind === 'in' && attrs['businessKey'] !== undefined) props['activiti:businessKey'] = attrs['businessKey'];
      else {
        const parameter = s.bpmnFactory.create(kind === 'in' ? 'activiti:In' : 'activiti:Out', {});
        for (const name of ['source', 'sourceExpression', 'target']) if (attrs[name] !== undefined) parameter.set(name, attrs[name]);
        replacement.push(parameter);
      }
    } else if (kind === 'inputOutput') {
      const mapping = mappingFromInputOutput(node);
      const processId = processIdOf(bo);
      if (processId && owner.id && (mapping.inputs || mapping.outputs)) after = () => s.store.setMapping(processId, owner.id, mapping);
    }
  }
  const next = values.slice();
  next.splice(index, 1, ...replacement);
  if (next.length === 0) s.modeling.updateModdleProperties(owner, bo, { extensionElements: undefined, ...props });
  else s.modeling.updateModdleProperties(owner, container, { values: next });
  if (next.length > 0 && Object.keys(props).length > 0) s.modeling.updateModdleProperties(owner, bo, props);
  after?.();
}

/** `bo` is the element that carries the attribute: the business object of `owner`, or the definitions (whose shape is the root). */
function translateCamundaAttribute(s: Services, owner: Shape, bo: ME, occurrence: CamundaOccurrence): void {
  const properties: Record<string, unknown> = { [occurrence.name]: undefined };
  if (occurrence.action === 'rename' || occurrence.action === 'async') {
    const target = occurrence.to!;
    const type = (bo.$descriptor as { propertiesByName?: Record<string, { type?: string }> }).propertiesByName?.[target]?.type;
    const value = occurrence.value;
    if (occurrence.action === 'async') {
      if (value === 'true') properties['activiti:async'] = true;
    } else properties[target] = type === 'Boolean' ? value === 'true' : value;
  }
  s.modeling.updateModdleProperties(owner, bo, properties);
}

/** Removes the `xmlns:` declarations of the Camunda, Zeebe and modeler namespaces once nothing uses them. */
function dropCamundaNamespaces(s: Services): void {
  const definitions = s.bpmnjs.getDefinitions();
  if (!definitions) return;
  let remaining = false;
  const visit = (node: ME): void => {
    if (remaining) return;
    if (camundaOccurrences(node).length > 0) remaining = true;
    if ((node.$descriptor as { isGeneric?: boolean } | undefined)?.isGeneric) return;
    for (const p of node.$descriptor.properties) {
      if (p.isAttr || p.isReference || ['String', 'Boolean', 'Integer', 'Real'].includes(p.type)) continue;
      const value = node[p.name];
      for (const child of Array.isArray(value) ? value : value ? [value] : []) if (typeof child === 'object' && child && '$type' in child) visit(child as ME);
    }
  };
  visit(definitions);
  if (remaining) return;
  const attrs = (definitions.$attrs ?? {}) as Record<string, string>;
  const drop = Object.entries(attrs).filter(([name, uri]) => name.startsWith('xmlns:') && uri.startsWith('http://camunda.org/schema/')).map(([name]) => name);
  if (drop.length > 0) s.modeling.updateModdleProperties(s.canvas.getRootElement(), definitions, Object.fromEntries(drop.map((n) => [n, undefined])));
}

function translateCamunda(s: Services, problem: Problem): void {
  const occurrence = problem.data as unknown as (CamundaOccurrence & { ownerType: string }) | undefined;
  if (!occurrence) throw new Error('no details for the fix');
  const definitions = s.bpmnjs.getDefinitions();
  const find = (id: string | undefined): { shape: Shape; bo: ME } => {
    if (id && definitions && id === definitions.id) return { shape: s.canvas.getRootElement(), bo: definitions };
    const shape = need(s, id);
    return { shape, bo: shape.businessObject };
  };
  const { shape, bo } = find(problem.elementId);
  if (occurrence.kind === 'attribute') {
    // the occurrence is on the element itself, or (a generic child) cannot be an attribute
    const live = camundaOccurrences(bo).find((o) => o.name === occurrence.name && o.kind === 'attribute');
    if (!live) throw new Error('the attribute is not there any more');
    translateCamundaAttribute(s, shape, bo, live);
  } else {
    const container = bo.get('extensionElements') as ME | undefined;
    const generic = ((container?.get('values') as ME[] | undefined) ?? []).find((v) => v.$type === occurrence.name && camundaOccurrences(v).length > 0);
    if (!generic) throw new Error('the element is not there any more');
    translateCamundaElement(s, shape, bo, generic, camundaOccurrences(generic).find((o) => o.kind === 'element')!);
  }
  dropCamundaNamespaces(s);
}

const FIXES: Record<string, (s: Services, problem: Problem) => void> = {
  'convert-business-rule-task': convertBusinessRuleTask,
  'complex-to-exclusive': complexToExclusive,
  'signal-end-to-throw': signalEndToThrow,
  'add-map-all': addMapAll,
  'declare-output-target': declareOutputTarget,
  'remove-mapping-key': removeMappingKey,
  'remove-process-entry': removeProcessEntry,
  'remove-element': removeElement,
  'set-executable': setExecutable,
  'remove-unsupported-loop': removeLoop,
  'remove-attribute': removeAttribute,
  'translate-camunda': translateCamunda,
  'remove-camunda': translateCamunda,
};

/** Applies the quick fix of `problem` to the modeler behind `injector`. */
export function applyFix(injector: Injector, problem: Problem): FixResult {
  const run = problem.fix ? FIXES[problem.fix.id] : undefined;
  if (!run) return { ok: false, message: `there is no quick fix for ${problem.rule}` };
  const s = services(injector);
  // nothing is selected while the shapes are replaced, so the properties panel never renders a half-replaced element
  const selection = injector.get<{ select(elements: unknown): void }>('selection');
  selection.select([]);
  try {
    inOneStep(s, () => run(s, problem));
    const shape = problem.elementId ? s.elementRegistry.get(problem.elementId) : undefined;
    if (shape) selection.select(shape);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
