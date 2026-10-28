/** Small, typed readers over bpmn-moddle elements, shared by all rules. */
import type { ME } from './types';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const ACTIVITI_NS = 'http://activiti.org/bpmn';
export const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
export const CAMUNDA_MODELER_NS = 'http://camunda.org/schema/modeler/1.0';
export const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';

export const is = (node: ME | undefined | null, type: string): boolean => !!node && typeof node.$instanceOf === 'function' && node.$instanceOf(type);
export const isAny = (node: ME | undefined | null, types: readonly string[]): boolean => types.some((t) => is(node, t));

export function str(node: ME, name: string): string | undefined {
  const value = node.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function bool(node: ME, name: string): boolean | undefined {
  const value = node.get(name);
  return typeof value === 'boolean' ? value : undefined;
}

export function list(node: ME, name: string): ME[] {
  const value = node.get(name);
  return Array.isArray(value) ? (value as ME[]) : [];
}

export function child(node: ME, name: string): ME | undefined {
  const value = node.get(name);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ME) : undefined;
}

export const isBlank = (value: string | undefined | null): boolean => value === undefined || value === null || value.trim() === '';

/** Extension elements (`<extensionElements>` values) of a node, optionally of one type. */
export function extensionValues(node: ME, type?: string): ME[] {
  const container = child(node, 'extensionElements');
  const values = container ? list(container, 'values') : [];
  return type ? values.filter((v) => v.$type === type) : values;
}

/** Text of an `activiti:string` / `activiti:expression` body or of a plain body element. */
export const bodyOf = (node: ME | undefined): string | undefined => {
  if (!node) return undefined;
  const body = node['body'];
  return typeof body === 'string' ? body : undefined;
};

/** The `activiti:field` children of a service / send task or a message definition by name. */
export function fieldsOf(node: ME): Array<{ name: string; value: string | undefined; isExpression: boolean; node: ME }> {
  const direct = list(node, 'activiti:fields');
  const inExt = extensionValues(node, 'activiti:Field');
  return [...direct, ...inExt].map((f) => {
    const string = bodyOf(child(f, 'string'));
    const expressionBody = bodyOf(child(f, 'expressionElement'));
    const stringValue = str(f, 'stringValue');
    const expression = str(f, 'expression');
    const value = stringValue ?? string ?? expression ?? expressionBody;
    return { name: str(f, 'name') ?? '', value, isExpression: stringValue === undefined && string === undefined && (expression !== undefined || expressionBody !== undefined), node: f };
  });
}

export const definitionsOf = (node: ME): ME | undefined => {
  let current: ME | undefined = node;
  while (current && current.$type !== 'bpmn:Definitions') current = current.$parent;
  return current;
};

export const processOf = (node: ME): ME | undefined => {
  for (let current: ME | undefined = node; current; current = current.$parent) if (current.$type === 'bpmn:Process' || current.$instanceOf?.('bpmn:Process')) return current;
  return undefined;
};

export function rootElements(definitions: ME | undefined): ME[] {
  return definitions ? list(definitions, 'rootElements') : [];
}

export const processesOf = (definitions: ME | undefined): ME[] => rootElements(definitions).filter((r) => is(r, 'bpmn:Process'));

/** Flow elements directly in a container (process, sub process). */
export const flowElementsOf = (container: ME): ME[] => list(container, 'flowElements');

/** Every flow element below a container, depth first (sub processes included). */
export function allFlowElements(container: ME): ME[] {
  const out: ME[] = [];
  const walk = (c: ME): void => {
    for (const el of flowElementsOf(c)) {
      out.push(el);
      if (is(el, 'bpmn:SubProcess')) walk(el);
    }
  };
  walk(container);
  return out;
}

/** The container (process or sub process) a flow element lives in. */
export const containerOf = (node: ME): ME | undefined => {
  for (let current = node.$parent; current; current = current.$parent) {
    if (is(current, 'bpmn:Process') || is(current, 'bpmn:SubProcess')) return current;
  }
  return undefined;
};

export const artifactsOf = (container: ME): ME[] => list(container, 'artifacts');

/** All flow elements of all processes of the document, with their processes. */
export function eachFlowElement(definitions: ME, fn: (element: ME, process: ME) => void): void {
  for (const process of processesOf(definitions)) for (const el of allFlowElements(process)) fn(el, process);
}

/** Event definitions the Activiti 9 converter reads (R1 §3.2); the others are dropped silently. */
export const ENGINE_EVENT_DEFINITIONS = [
  'bpmn:TimerEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:SignalEventDefinition', 'bpmn:ErrorEventDefinition',
  'bpmn:TerminateEventDefinition', 'bpmn:CancelEventDefinition', 'bpmn:CompensateEventDefinition', 'bpmn:LinkEventDefinition',
] as const;

/**
 * The event definitions of an event as the Activiti converter sees them. `TerminateEventDefinitionParser` reads a terminate definition
 * in an end event only; in any other event it is dropped like the unsupported ones (docs/engine-findings.md V.3).
 */
export const engineDefinitions = (event: ME): ME[] =>
  list(event, 'eventDefinitions').filter((d) => isAny(d, ENGINE_EVENT_DEFINITIONS) && (!is(d, 'bpmn:TerminateEventDefinition') || is(event, 'bpmn:EndEvent')));

export const isEvent = (node: ME): boolean => is(node, 'bpmn:Event');

/** Namespace URI an XML prefix is bound to, searching the definitions' declarations. */
export function namespaceOfPrefix(node: ME, prefix: string): string | undefined {
  for (let current: ME | undefined = node; current; current = current.$parent) {
    const attrs = current.$attrs as Record<string, string> | undefined;
    // generic (unknown namespace) elements keep their attributes as plain properties
    const value = attrs?.[`xmlns:${prefix}`] ?? (current[`xmlns:${prefix}`] as string | undefined);
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Foreign (not understood by the descriptors) attributes of a node as `[prefix, local, value]`. */
export function foreignAttributes(node: ME): Array<{ prefix: string; local: string; name: string; value: string }> {
  const attrs = (node.$attrs ?? {}) as Record<string, string>;
  const out: Array<{ prefix: string; local: string; name: string; value: string }> = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    const colon = name.indexOf(':');
    if (colon < 0) continue;
    out.push({ prefix: name.slice(0, colon), local: name.slice(colon + 1), name, value });
  }
  return out;
}

/** The expression text of a `bpmn:FormalExpression` or `bpmn:Expression` child (conditions, cardinality, ...). */
export const expressionText = (node: ME | undefined): string | undefined => {
  if (!node) return undefined;
  const body = node['body'];
  return typeof body === 'string' ? body : undefined;
};

/** id of the node, or of its nearest ancestor that has one (listeners and fields have none). */
/** Parts of an element that have no shape of their own: a problem found in one belongs to the element that holds it. */
const PART_TYPES = ['bpmn:EventDefinition', 'bpmn:LoopCharacteristics', 'bpmn:Expression', 'bpmn:ExtensionElements', 'bpmn:ResourceRole'] as const;

export function idOf(node: ME): string | undefined {
  for (let current: ME | undefined = node; current; current = current.$parent) {
    if (current.$type === 'bpmn:Definitions') return current.id;
    if (PART_TYPES.some((t) => current!.$instanceOf(t))) continue;
    if (typeof current.id === 'string' && current.id !== '') return current.id;
  }
  return undefined;
}

/** Local name of a moddle type: `bpmn:UserTask` -> `UserTask`. */
export const localType = (type: string): string => type.slice(type.indexOf(':') + 1);

/** `bpmn:UserTask` -> `user task`. */
export const humanType = (type: string): string => localType(type).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

export function label(node: ME): string {
  const name = str(node, 'name');
  const type = humanType(node.$type);
  const id = node.id ?? '';
  return name ? `${type} "${name}" (${id})` : `${type} ${id}`.trim();
}

/** Is `target` (a referenced root element) still part of the document? A reference can point at an element that was removed. */
export function isDeclared(definitions: ME | undefined, target: ME | undefined): boolean {
  if (!target) return false;
  return rootElements(definitions).includes(target);
}

/** `timer`, `signal`, ...: the short name of an event definition. */
export const definitionLabel = (definition: ME): string => definition.$type.replace('bpmn:', '').replace('EventDefinition', '').toLowerCase();

/**
 * The element a QName reference names, the way the Activiti converter resolves it (`parseMessageRef`, `MessageParser.parseItemRef`): a
 * reference without a prefix, or with the prefix of the target namespace, names a root element of the file by its id; a prefix bound
 * to another namespace, or to none, names nothing of this file. (The descriptor keeps these references as strings, as the engine does.)
 */
export function rootElementByQName(node: ME, ref: string | undefined, type: string): ME | undefined {
  const definitions = definitionsOf(node);
  if (!definitions || ref === undefined || ref.trim() === '') return undefined;
  const text = ref.trim();
  const colon = text.indexOf(':');
  let local = text;
  if (colon > 0) {
    const namespace = namespaceOfPrefix(definitions, text.slice(0, colon));
    if (namespace === undefined || namespace !== str(definitions, 'targetNamespace')) return undefined;
    local = text.slice(colon + 1);
  }
  return rootElements(definitions).find((r) => is(r, type) && r.id === local);
}
