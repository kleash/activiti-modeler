import { type DiagramElement, type ModdleElement, is, isAny } from '../../types';
import { AccessorError, type AccessorContext, type PropertyAccessor } from './types';

// --- validation --------------------------------------------------------------------------------------------------

const NCNAME = /^[\p{L}_][\p{L}\p{N}._\-·]*$/u;

export function assertNcName(key: string, id: string): void {
  if (!NCNAME.test(id)) throw new AccessorError('INVALID_ID', key, `"${id}" is not a valid NCName (letters, digits, "_", "-", "."; no spaces or colons; must not start with a digit)`);
  if (id.length > 255) throw new AccessorError('ID_TOO_LONG', key, `id has ${id.length} characters, the limit is 255`);
}

export function assertOneOf<T extends string>(key: string, value: unknown, allowed: readonly T[], what = 'value'): asserts value is T {
  if (!allowed.includes(value as T)) throw new AccessorError('INVALID_VALUE', key, `${what} "${String(value)}" is not one of ${allowed.join(', ')}`);
}

export function assertString(key: string, value: unknown, what = 'value'): asserts value is string {
  if (typeof value !== 'string') throw new AccessorError('INVALID_VALUE', key, `${what} must be a string`);
}

// --- model access ------------------------------------------------------------------------------------------------

export const bo = (element: DiagramElement): ModdleElement => element.businessObject;

/** Empty string and undefined clear an attribute. */
export const orUndefined = (value: string | undefined | null): string | undefined => (value === undefined || value === null || value === '' ? undefined : value);

export function definitionsOf(element: DiagramElement | ModdleElement): ModdleElement {
  let current: ModdleElement | undefined = 'businessObject' in element ? (element as DiagramElement).businessObject : (element as ModdleElement);
  while (current && current.$type !== 'bpmn:Definitions') current = current.$parent;
  if (!current) throw new Error('element is not attached to a bpmn:Definitions');
  return current;
}

/** Process a business object belongs to (also resolves a participant's process). */
export function processOf(element: DiagramElement): ModdleElement | undefined {
  for (let current: ModdleElement | undefined = element.businessObject; current; current = current.$parent) {
    if (current.$instanceOf('bpmn:Process')) return current;
    if (current.$instanceOf('bpmn:Participant')) return current.get('processRef') as ModdleElement | undefined;
  }
  return undefined;
}

export function processIdFor(key: string, element: DiagramElement): string {
  const process = processOf(element);
  if (!process?.id) throw new AccessorError('NO_PROCESS', key, `${element.id} does not belong to a process`);
  return process.id;
}

// --- extension elements ------------------------------------------------------------------------------------------

export function extensionValues(holder: ModdleElement): ModdleElement[] {
  const ext = holder.get('extensionElements') as ModdleElement | undefined;
  return ((ext?.get('values') as ModdleElement[] | undefined) ?? []).slice();
}

export function extensionsOfType(holder: ModdleElement, type: string): ModdleElement[] {
  return extensionValues(holder).filter((v) => v.$type === type);
}

/**
 * Replaces the extension elements matching `matches` by `items`, keeping every other extension element (including
 * foreign ones) in its place, and creating or dropping the `extensionElements` container as needed.
 */
export function replaceExtensions(ctx: AccessorContext, element: DiagramElement, holder: ModdleElement, matches: (value: ModdleElement) => boolean, items: ModdleElement[]): void {
  const container = holder.get('extensionElements') as ModdleElement | undefined;
  const current = (container?.get('values') as ModdleElement[] | undefined) ?? [];
  const firstMatch = current.findIndex(matches);
  const others = current.filter((v) => !matches(v));
  const values = others.slice();
  values.splice(firstMatch === -1 ? values.length : Math.min(firstMatch, values.length), 0, ...items);
  if (values.length === 0) {
    if (container) ctx.modeling.updateModdleProperties(element, holder, { extensionElements: undefined });
    return;
  }
  if (container) {
    ctx.modeling.updateModdleProperties(element, container, { values });
  } else {
    const created = ctx.bpmnFactory.create('bpmn:ExtensionElements', { values });
    ctx.modeling.updateModdleProperties(element, holder, { extensionElements: created });
  }
}

/**
 * The event whose `eventDefinitions` contain `definition`. A definition created in this session has no `$parent` (only
 * the XML reader sets it), so the owner is looked up on the canvas.
 */
export function shapeOfEventDefinition(registry: { filter(fn: (element: DiagramElement) => boolean): DiagramElement[] }, definition: ModdleElement): DiagramElement | undefined {
  return registry.filter((e) => !e.labelTarget && !!e.businessObject?.$instanceOf('bpmn:Event') && ((e.businessObject.get('eventDefinitions') as ModdleElement[] | undefined) ?? []).includes(definition))[0];
}

interface IdClaiming {
  claimId(id: string, element: ModdleElement): void;
  unclaimId(id: string, element: ModdleElement): void;
}

/**
 * Gives a nested moddle element (an event definition, a data object) a new id. `updateModdleProperties` does not touch
 * the id registry, so the claim moves with it through bpmn-js' own claim commands: undo and redo keep `ids.assigned` exact.
 */
export function renameModdleElement(ctx: AccessorContext, key: string, element: DiagramElement, target: ModdleElement, newId: unknown): void {
  assertString(key, newId, 'id');
  assertNcName(key, newId);
  if (newId === target.id) return;
  if (ctx.moddle.ids.assigned(newId)) throw new AccessorError('DUPLICATE_ID', key, `id "${newId}" is already used`);
  const claiming = ctx.modeling as unknown as IdClaiming;
  ctx.batch(() => {
    claiming.unclaimId(target.id as string, target);
    ctx.modeling.updateModdleProperties(element, target, { id: newId });
    claiming.claimId(newId, target);
  });
}

/**
 * Inputs that carry a new id where the element at the same position of the current list has a different, no longer listed id:
 * an id change of that element (so that its references survive), not a delete plus an add.
 */
export function renamedByPosition<T extends { id?: string }>(inputs: T[], current: ModdleElement[]): Map<T, ModdleElement> {
  const listed = new Set(inputs.map((i) => i.id).filter((id): id is string => id !== undefined));
  const known = new Set(current.map((c) => c.id as string));
  const out = new Map<T, ModdleElement>();
  inputs.forEach((input, index) => {
    const candidate = current[index];
    if (input.id && !known.has(input.id) && candidate && !listed.has(candidate.id as string)) out.set(input, candidate);
  });
  return out;
}

export const createModdle = (ctx: AccessorContext, type: string, attrs: Record<string, unknown> = {}): ModdleElement => ctx.bpmnFactory.create(type, attrs);

/** `bpmn:FormalExpression` with the given body, as bpmn-js creates conditions. */
export const formalExpression = (ctx: AccessorContext, body: string): ModdleElement => ctx.bpmnFactory.create('bpmn:FormalExpression', { body });

// --- accessor factories ------------------------------------------------------------------------------------------

export interface AccessorBase {
  key: string;
  group: string;
  label?: string;
}

/** Predicate from bpmn: type names; a function is used as is. */
export type AppliesTo = readonly string[] | ((element: DiagramElement) => boolean);
export const appliesToFn = (a: AppliesTo): ((element: DiagramElement) => boolean) => (typeof a === 'function' ? a : (el) => isAny(el, a));

interface AttrOptions extends AccessorBase {
  attr: string;
  appliesTo: AppliesTo;
  validate?: (value: string | undefined) => void;
}

/** A string attribute (`activiti:assignee`, `implementation`, ...). Empty string removes it. */
export function stringAttr(options: AttrOptions): PropertyAccessor<string | undefined> {
  return {
    key: options.key,
    group: options.group,
    label: options.label ?? options.key,
    writes: 'xml',
    appliesTo: appliesToFn(options.appliesTo),
    get: (_ctx, element) => bo(element).get(options.attr) as string | undefined,
    set: (ctx, element, value) => {
      if (value !== undefined && typeof value !== 'string') throw new AccessorError('INVALID_VALUE', options.key, 'value must be a string');
      options.validate?.(value);
      ctx.modeling.updateProperties(element, { [options.attr]: orUndefined(value) });
    },
  };
}

interface BooleanOptions extends AccessorBase {
  attr: string;
  appliesTo: AppliesTo;
  /** The value the engine assumes when the attribute is absent; writing it removes the attribute. */
  defaultValue?: boolean;
}

export function booleanAttr(options: BooleanOptions): PropertyAccessor<boolean> {
  const fallback = options.defaultValue ?? false;
  return {
    key: options.key,
    group: options.group,
    label: options.label ?? options.key,
    writes: 'xml',
    appliesTo: appliesToFn(options.appliesTo),
    get: (_ctx, element) => {
      const value = bo(element).get(options.attr) as boolean | undefined;
      return value === undefined ? fallback : value;
    },
    set: (ctx, element, value) => {
      if (typeof value !== 'boolean') throw new AccessorError('INVALID_VALUE', options.key, 'value must be a boolean');
      // the engine's default is not written (activiti:async="false" is noise; activiti:exclusive="false" is the non-default)
      const stored = value === fallback ? undefined : value;
      ctx.modeling.updateProperties(element, { [options.attr]: stored });
    },
  };
}

/** Accessor on a moddle element reached from the diagram element (event definition, loop characteristics, ...). */
export function nestedAttr(options: AccessorBase & { attr: string; appliesTo: AppliesTo; holder: (element: DiagramElement) => ModdleElement | undefined; boolean?: boolean; defaultValue?: boolean }): PropertyAccessor<string | boolean | undefined> {
  const fallback = options.defaultValue ?? false;
  return {
    key: options.key,
    group: options.group,
    label: options.label ?? options.key,
    writes: 'xml',
    appliesTo: (el) => appliesToFn(options.appliesTo)(el) && options.holder(el) !== undefined,
    get: (_ctx, element) => {
      const value = options.holder(element)?.get(options.attr) as string | boolean | undefined;
      return options.boolean ? (value === undefined ? fallback : value) : value;
    },
    set: (ctx, element, value) => {
      const holder = options.holder(element);
      if (!holder) throw new AccessorError('NOT_APPLICABLE', options.key, `${element.id} has no ${options.group} definition`);
      if (options.boolean && typeof value !== 'boolean') throw new AccessorError('INVALID_VALUE', options.key, 'value must be a boolean');
      const stored = options.boolean ? (value === fallback ? undefined : value) : orUndefined(value as string | undefined);
      ctx.modeling.updateModdleProperties(element, holder, { [options.attr]: stored });
    },
  };
}

export const isActivity = (element: DiagramElement): boolean => is(element, 'bpmn:Activity');
export const isFlowNode = (element: DiagramElement): boolean => is(element, 'bpmn:FlowNode');
