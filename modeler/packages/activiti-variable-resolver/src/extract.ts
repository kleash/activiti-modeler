import { variablesInExpression } from './juel';

/**
 * Where the variables of an Activiti process are written and read (feature U14). Pure functions over the moddle model of the
 * process and the process part of its extensions file: the editor's variable resolver (`@bpmn-io/variable-resolver` with an Activiti
 * adapter) and the variable outline are built on `extractOutline`.
 *
 * Writers: the declared process variables (extensions `properties`), result variables of script and service tasks, the output
 * variables of mail and shell tasks, the initiator, form properties, multi-instance variables, `activiti:out` targets of call
 * activities, the targets of output mappings (also the outputs of a DMN decision), input mappings and constants (local to the
 * task), data objects and `execution.setVariable` calls of scripts.
 * Readers: every expression (`${...}`) in the attributes and extension elements of an element, conditions, the collection of a
 * multi-instance activity, `activiti:in` sources, the variable inputs of mappings and `execution.getVariable` calls of scripts.
 */

/** The parts of a moddle element the extraction reads. */
export interface ModdleLike {
  $type: string;
  $parent?: ModdleLike;
  $descriptor?: { properties?: Array<{ name: string; isReference?: boolean }> };
  id?: string;
  $instanceOf(type: string): boolean;
  get(name: string): unknown;
}

export interface MappingValueLike {
  type?: string;
  value?: unknown;
}

export interface ProcessExtensionLike {
  properties?: Record<string, { name: string; type?: string; value?: unknown }>;
  mappings?: Record<string, { mappingType?: string; inputs?: Record<string, MappingValueLike>; outputs?: Record<string, MappingValueLike> }>;
  constants?: Record<string, Record<string, { value?: unknown }>>;
}

export interface DecisionLike {
  id: string;
  name?: string;
  outputs: Array<{ name?: string; type?: string }>;
}

export interface ExtractInput {
  /** The `bpmn:Process`. */
  root: ModdleLike;
  extension?: ProcessExtensionLike | undefined;
  /** The DMN decision a `_activiti_dmn_table_` constant names. */
  decision?: ((reference: string) => DecisionLike | undefined) | undefined;
}

export type WriteKind =
  | 'declared' | 'result' | 'field' | 'initiator' | 'form' | 'loop-element' | 'loop-index' | 'loop-output' | 'call-out'
  | 'output-mapping' | 'decision-output' | 'input-mapping' | 'constant' | 'data-object' | 'script';

export interface VariableUse {
  element: ModdleLike;
  kind: string;
  detail: string;
}

export interface OutlineVariable {
  name: string;
  /** The element the variable is local to (an input mapping target, a loop variable); undefined for a process variable. */
  scope?: ModdleLike;
  type?: string;
  /** Declared in the extensions `properties`. */
  declared: boolean;
  writers: VariableUse[];
  readers: VariableUse[];
  /** Read but written nowhere: it must come with the start of the instance, or from the caller. */
  external: boolean;
}

export interface Outline {
  variables: OutlineVariable[];
  /** Elements whose mapping passes every variable (MAP_ALL*): they read and write names the outline cannot list. */
  mapAll: Array<{ element: ModdleLike; mappingType: string }>;
}

interface Event {
  op: 'write' | 'read';
  name: string;
  element: ModdleLike;
  kind: string;
  detail: string;
  type?: string | undefined;
  scope?: ModdleLike | undefined;
  /** A read that only counts when the name is a variable some element writes (bean names in service expressions). */
  weak?: boolean;
  /** The read takes the variable from outside the element: a local variable of the element itself (an input mapping target) is not meant. */
  outer?: boolean;
}

/** Names the engine or the expression context provides: they are not process variables. */
const BUILTIN = new Set(['execution', 'task', 'authenticatedUserId', 'nrOfInstances', 'nrOfCompletedInstances', 'nrOfActiveInstances', 'loopCounter', 'vars', 'item', 'event']);

/** Properties that hold text for people, references or children that are visited on their own. */
const SKIP = new Set([
  'id', 'name', 'documentation', 'text', 'incoming', 'outgoing', 'flowElements', 'artifacts', 'laneSets', 'default', 'sourceRef', 'targetRef',
  'processRef', 'messageRef', 'signalRef', 'errorRef', 'escalationRef', 'attachedToRef', 'dataObjectRef', 'targetNamespace', 'expressionLanguage',
  'typeLanguage', 'exporter', 'exporterVersion', 'scriptFormat', 'activiti:class', 'class', 'category', 'type', 'format', 'event', 'events',
  'implementation', 'isExecutable', 'triggeredByEvent', 'cancelActivity',
]);

/** Properties of Activiti elements that are expressions evaluated against a bean rather than a variable (weak reads). */
const BEAN_PROPERTIES = new Set(['activiti:expression', 'activiti:delegateExpression', 'expression', 'delegateExpression']);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SCRIPT_READ = /getVariable(?:Local)?\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
const SCRIPT_WRITE = /setVariable(?:Local)?\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;

export const DMN_TABLE_CONSTANT = '_activiti_dmn_table_';
export const DMN_IMPLEMENTATION = 'dmn-connector.EXECUTE_TABLE';

const is = (el: ModdleLike | undefined, type: string): boolean => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(type);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const list = (el: ModdleLike, name: string): ModdleLike[] => {
  const value = el.get(name);
  return Array.isArray(value) ? (value as ModdleLike[]) : [];
};

const labelOf = (el: ModdleLike): string => {
  const name = str(el.get('name'));
  return name ? `"${name}"` : (el.id ?? el.$type);
};

/** Every flow element below a process or sub process, at any depth. */
export function flowElementsOf(container: ModdleLike): ModdleLike[] {
  const out: ModdleLike[] = [];
  const visit = (node: ModdleLike): void => {
    for (const child of list(node, 'flowElements')) {
      out.push(child);
      if (list(child, 'flowElements').length > 0 || is(child, 'bpmn:SubProcess')) visit(child);
    }
  };
  visit(container);
  return out;
}

function extensionValues(el: ModdleLike): ModdleLike[] {
  const ext = el.get('extensionElements') as ModdleLike | undefined;
  return ext ? list(ext, 'values') : [];
}

/** `activiti:field` value by field name (text or expression). */
function fieldText(el: ModdleLike, name: string): string | undefined {
  for (const field of extensionValues(el)) {
    if (field.$type !== 'activiti:Field' || field.get('name') !== name) continue;
    const direct = str(field.get('stringValue')) ?? str(field.get('expression'));
    if (direct) return direct;
    const child = (field.get('string') ?? field.get('expressionValue')) as ModdleLike | undefined;
    const body = child ? str(child.get('body')) : undefined;
    if (body) return body;
  }
  return undefined;
}

/** Every string below an element that can hold an expression, with the name of its property. */
function* expressionTexts(el: ModdleLike, depth = 0): Generator<{ text: string; property: string; owner: ModdleLike }> {
  if (depth > 6) return;
  // the source expression of an out parameter runs against the child instance
  if (el.$type === 'activiti:Out') return;
  const properties = el.$descriptor?.properties ?? [];
  for (const prop of properties) {
    if (SKIP.has(prop.name) || prop.isReference) continue;
    const value = el.get(prop.name);
    if (typeof value === 'string') {
      if (value.includes('${') || value.includes('#{')) yield { text: value, property: prop.name, owner: el };
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && '$type' in (item as object)) yield* expressionTexts(item as ModdleLike, depth + 1);
      }
    } else if (value && typeof value === 'object' && '$type' in (value as object)) {
      yield* expressionTexts(value as ModdleLike, depth + 1);
    }
  }
}

function eventsOf(input: ExtractInput): Event[] {
  const { root, extension, decision } = input;
  const events: Event[] = [];
  const write = (element: ModdleLike, name: string | undefined, kind: WriteKind, detail: string, extra: { type?: string | undefined; scope?: ModdleLike | undefined } = {}): void => {
    if (name && IDENTIFIER.test(name) && !(BUILTIN.has(name) && kind !== 'declared')) events.push({ op: 'write', name, element, kind, detail, ...extra });
  };
  const read = (element: ModdleLike, name: string, detail: string, weak = false, outer = false): void => {
    if (IDENTIFIER.test(name) && !BUILTIN.has(name)) events.push({ op: 'read', name, element, kind: 'read', detail, weak, outer });
  };
  /**
   * Reads the variables of an expression. Where the expression calls a bean (`${pricing.quote(order)}`), the first name of each block
   * may be the bean: it only counts when some element writes a variable of that name.
   */
  const readExpression = (element: ModdleLike, text: string, detail: string, beanFirst = false, outer = false): void => {
    for (const block of text.matchAll(/[$#]\{[^}]*\}/g)) {
      variablesInExpression(block[0]).forEach((name, index) => read(element, name, detail, beanFirst && index === 0, outer));
    }
  };

  // --- the process itself
  for (const p of Object.values(extension?.properties ?? {})) write(root, p.name, 'declared', 'declared process variable', { type: p.type });

  const nodes = [root, ...flowElementsOf(root)];
  for (const el of nodes) {
    const here = labelOf(el);

    // --- expressions anywhere in the element
    for (const { text, property, owner } of expressionTexts(el)) readExpression(el, text, `expression of ${here}`, BEAN_PROPERTIES.has(property) && owner.$type !== 'activiti:Field');

    // --- result variables
    if (is(el, 'bpmn:ScriptTask')) {
      write(el, str(el.get('activiti:resultVariable')), 'result', `result variable of ${here}`);
      const script = str(el.get('script'));
      if (script) {
        for (const m of script.matchAll(SCRIPT_READ)) read(el, m[1]!, `script of ${here}`);
        for (const m of script.matchAll(SCRIPT_WRITE)) write(el, m[1], 'script', `script of ${here} sets it`);
      }
    }
    if (is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SendTask')) {
      write(el, str(el.get('activiti:resultVariableName')), 'result', `result variable of ${here}`);
      for (const field of ['outputVariable', 'errorCodeVariable', 'exceptionVariableName']) write(el, fieldText(el, field), 'field', `${field} of ${here}`);
    }

    // --- start and forms
    if (is(el, 'bpmn:StartEvent')) write(el, str(el.get('activiti:initiator')), 'initiator', `initiator of ${here}`);
    for (const form of extensionValues(el).filter((v) => v.$type === 'activiti:FormProperty')) {
      write(el, str(form.get('variable')) ?? str(form.get('id')), 'form', `form property of ${here}`);
    }

    // --- multi-instance
    const loop = el.get('loopCharacteristics') as ModdleLike | undefined;
    if (loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      write(el, str(loop.get('activiti:elementVariable')), 'loop-element', `element variable of ${here}`, { scope: el });
      write(el, str(loop.get('activiti:elementIndexVariable')), 'loop-index', `index variable of ${here}`, { scope: el });
      const output = (loop.get('outputDataItem') as ModdleLike | undefined)?.get('name');
      write(el, str(output), 'loop-output', `output element of ${here}`, { scope: el });
      write(el, str(loop.get('loopDataOutputRef')), 'loop-output', `output collection of ${here}`);
      const collection = str(loop.get('activiti:collection'));
      if (collection) {
        // a name; an expression is read with the other expressions of the element
        if (IDENTIFIER.test(collection)) read(el, collection, `collection of ${here}`);
      }
    }

    // --- call activities
    if (is(el, 'bpmn:CallActivity')) {
      for (const value of extensionValues(el)) {
        if (value.$type === 'activiti:Out') write(el, str(value.get('target')), 'call-out', `out parameter of ${here}`);
        if (value.$type === 'activiti:In') {
          const source = str(value.get('source'));
          if (source) read(el, source, `in parameter of ${here}`);
        }
      }
    }

    // --- data objects
    if (is(el, 'bpmn:DataObject')) write(el, str(el.get('name')), 'data-object', 'data object', { type: str(el.get('itemSubjectRef')) ?? 'string' });

    // --- the extensions file: constants, mappings, decision tasks
    const id = el.id;
    if (!id) continue;
    const constants = extension?.constants?.[id] ?? {};
    for (const [name, constant] of Object.entries(constants)) {
      if (name === DMN_TABLE_CONSTANT) continue;
      write(el, name, 'constant', `constant of ${here}`, { scope: el });
      if (typeof constant.value === 'string') readExpression(el, constant.value, `constant of ${here}`);
    }
    const dmnReference = typeof constants[DMN_TABLE_CONSTANT]?.value === 'string' ? (constants[DMN_TABLE_CONSTANT]!.value as string) : undefined;
    const found = dmnReference && decision ? decision(dmnReference) : undefined;
    const mapping = extension?.mappings?.[id];
    if (mapping) {
      for (const [name, value] of Object.entries(mapping.inputs ?? {})) {
        write(el, name, 'input-mapping', `input of ${here}`, { scope: el });
        const type = String(value.type ?? '').toUpperCase();
        // the inputs are taken from the process, not from the task's own inputs
        if (type === 'VARIABLE' && typeof value.value === 'string') read(el, value.value.split('.')[0]!, `input mapping of ${here}`, false, true);
        else if (typeof value.value === 'string') readExpression(el, value.value, `input mapping of ${here}`, false, true);
      }
      for (const [target, value] of Object.entries(mapping.outputs ?? {})) {
        const type = String(value.type ?? '').toUpperCase();
        const output = found && type === 'VARIABLE' && typeof value.value === 'string' ? found.outputs.find((o) => o.name === value.value) : undefined;
        const declared = extension?.properties ? Object.values(extension.properties).find((p) => p.name === target)?.type : undefined;
        if (output || (found && type === 'VARIABLE')) {
          write(el, target, 'decision-output', `output "${String(value.value)}" of decision ${found!.name ?? found!.id} (${here})`, { type: output?.type ?? declared });
        } else {
          write(el, target, 'output-mapping', `output mapping of ${here}`, { type: declared });
        }
        if (type === 'VALUE' && typeof value.value === 'string') readExpression(el, value.value, `output mapping of ${here}`);
        if (type === 'JSONPATCH') read(el, target, `JSON patch of ${here}`);
      }
    }
  }
  return events;
}

const sameOrInside = (inner: ModdleLike | undefined, outer: ModdleLike): boolean => {
  for (let cursor = inner; cursor; cursor = cursor.$parent) if (cursor === outer) return true;
  return false;
};

/**
 * Groups the writes and reads of a process into variables. A write with a scope makes a local variable; a read resolves to the
 * nearest local variable of that name around the reader, else to the process variable, else to a variable nobody writes.
 */
export function extractOutline(input: ExtractInput): Outline {
  const events = eventsOf(input);
  const variables = new Map<string, OutlineVariable>();
  const scopeKey = (scope: ModdleLike | undefined): string => scope?.id ?? '';
  const keyOf = (name: string, scope: ModdleLike | undefined): string => `${name}\u0000${scopeKey(scope)}`;
  const declared = new Map(Object.values(input.extension?.properties ?? {}).map((p) => [p.name, p]));

  const ensure = (name: string, scope: ModdleLike | undefined): OutlineVariable => {
    const key = keyOf(name, scope);
    let variable = variables.get(key);
    if (!variable) {
      variable = { name, ...(scope ? { scope } : {}), declared: !scope && declared.has(name), writers: [], readers: [], external: false };
      variables.set(key, variable);
    }
    return variable;
  };

  for (const event of events.filter((e) => e.op === 'write')) {
    const variable = ensure(event.name, event.scope);
    if (!variable.writers.some((w) => w.element === event.element && w.kind === event.kind && w.detail === event.detail)) variable.writers.push({ element: event.element, kind: event.kind, detail: event.detail });
    variable.type ??= event.type ?? (!event.scope ? declared.get(event.name)?.type : undefined);
  }

  for (const event of events.filter((e) => e.op === 'read')) {
    const local = [...variables.values()].filter((v) => v.scope && v.name === event.name && sameOrInside(event.element, v.scope) && !(event.outer && v.scope === event.element));
    // the nearest scope wins: the deepest element, which is the one with the most ancestors
    local.sort((a, b) => depth(b.scope!) - depth(a.scope!));
    let target = local[0] ?? variables.get(keyOf(event.name, undefined));
    if (!target) {
      if (event.weak) continue;
      target = ensure(event.name, undefined);
      target.external = true;
    }
    if (!target.readers.some((r) => r.element === event.element && r.detail === event.detail)) target.readers.push({ element: event.element, kind: 'read', detail: event.detail });
  }

  const mapAll: Outline['mapAll'] = [];
  for (const el of [input.root, ...flowElementsOf(input.root)]) {
    const type = el.id ? input.extension?.mappings?.[el.id]?.mappingType : undefined;
    if (type && /^MAP_ALL/i.test(type)) mapAll.push({ element: el, mappingType: type.toUpperCase() });
  }

  const ordered = [...variables.values()].sort((a, b) => Number(!!a.scope) - Number(!!b.scope) || a.name.localeCompare(b.name));
  return { variables: ordered, mapAll };
}

function depth(el: ModdleLike): number {
  let n = 0;
  for (let cursor: ModdleLike | undefined = el; cursor; cursor = cursor.$parent) n += 1;
  return n;
}
