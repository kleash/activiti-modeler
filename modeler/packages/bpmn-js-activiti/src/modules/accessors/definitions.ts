import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertNcName, assertOneOf, definitionsOf, renameModdleElement, renamedByPosition, shapeOfEventDefinition } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

/** Definitions-level lists are reachable from the root (process or collaboration) of the diagram. */
const isRoot = (el: DiagramElement): boolean => is(el, 'bpmn:Process') || is(el, 'bpmn:Collaboration');

export interface RootElementInput {
  /** Existing definitions-level id; omit to create a new one. */
  id?: string;
  name?: string;
}
export interface MessageInput extends RootElementInput {
  name: string;
}
export interface SignalInput extends RootElementInput {
  name: string;
  scope?: 'global' | 'processInstance';
}
export interface ErrorInput extends RootElementInput {
  errorCode: string;
}

// --- references to definitions-level elements ---------------------------------------------------------------------------------

/** The reference properties that point at a definitions-level element. */
const REFERENCE_PROPERTIES = ['messageRef', 'signalRef', 'errorRef'] as const;

interface Holder {
  holder: ModdleElement;
  property: (typeof REFERENCE_PROPERTIES)[number];
  target: ModdleElement;
}

/** Every element below `root` that refers to a message, signal or error through `messageRef`, `signalRef` or `errorRef`. */
export function referencesBelow(root: ModdleElement): Holder[] {
  const found: Holder[] = [];
  const seen = new Set<ModdleElement>();
  const visit = (element: ModdleElement): void => {
    if (seen.has(element)) return;
    seen.add(element);
    // the generic elements of foreign namespaces (read from a file made with another tool) have no property list
    for (const property of element.$descriptor.properties ?? []) {
      const value = element.get(property.name) as unknown;
      if (property.isReference) {
        const name = property.name as (typeof REFERENCE_PROPERTIES)[number];
        if (REFERENCE_PROPERTIES.includes(name) && value && typeof value === 'object') found.push({ holder: element, property: name, target: value as ModdleElement });
        continue;
      }
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && '$type' in child && '$descriptor' in child) visit(child as ModdleElement);
      }
    }
  };
  visit(root);
  return found;
}

export interface DefinitionsUsage {
  messages: Record<string, number>;
  signals: Record<string, number>;
  errors: Record<string, number>;
}

/** How many event definitions, tasks and message flows refer to each message, signal and error (by id). */
export function usageOf(definitions: ModdleElement): DefinitionsUsage {
  const usage: DefinitionsUsage = { messages: {}, signals: {}, errors: {} };
  const kinds: Array<[string, keyof DefinitionsUsage]> = [['bpmn:Message', 'messages'], ['bpmn:Signal', 'signals'], ['bpmn:Error', 'errors']];
  for (const root of (definitions.get('rootElements') as ModdleElement[] | undefined) ?? []) {
    for (const [type, kind] of kinds) if (root.$instanceOf(type)) usage[kind][root.id as string] = 0;
  }
  for (const { target } of referencesBelow(definitions)) {
    for (const [type, kind] of kinds) {
      if (target.$instanceOf(type) && target.id !== undefined && target.id in usage[kind]) usage[kind][target.id] = (usage[kind][target.id] ?? 0) + 1;
    }
  }
  return usage;
}

interface ListSpec<T extends RootElementInput> {
  key: string;
  label: string;
  type: string;
  toInput(el: ModdleElement): T;
  attrs(input: T): Record<string, unknown>;
  validate(input: T, all: T[]): void;
}

/**
 * CRUD of one kind of definitions-level element (message / signal / error) as a list: an entry whose id exists is
 * updated, an entry without an id is created with a generated one, an entry with a new id is created with that id (a
 * valid, unused NCName), entries that are missing from the list are removed.
 */
function listAccessor<T extends RootElementInput>(spec: ListSpec<T>): PropertyAccessor<T[]> {
  return {
    key: spec.key,
    group: 'Messages / Signals / Errors',
    label: spec.label,
    writes: 'xml',
    appliesTo: isRoot,
    get: (_c, el) => (((definitionsOf(el).get('rootElements') as ModdleElement[] | undefined) ?? []).filter((r) => r.$instanceOf(spec.type)).map(spec.toInput)),
    set: (ctx: AccessorContext, el, value) => {
      for (const input of value) spec.validate(input, value);
      const definitions = definitionsOf(el);
      const roots = ((definitions.get('rootElements') as ModdleElement[] | undefined) ?? []).slice();
      const typed = roots.filter((r) => r.$instanceOf(spec.type));
      const existing = new Map(typed.map((r) => [r.id as string, r]));
      const renames = renamedByPosition(value, typed);
      ctx.batch(() => {
        const kept = new Set<ModdleElement>();
        const created: ModdleElement[] = [];
        for (const input of value) {
          const renamed = renames.get(input);
          if (renamed) renameModdleElement(ctx, spec.key, el, renamed, input.id);
          const found = renamed ?? (input.id ? existing.get(input.id) : undefined);
          if (input.id && !found) {
            assertNcName(spec.key, input.id);
            if (ctx.moddle.ids.assigned(input.id)) throw new AccessorError('DUPLICATE_ID', spec.key, `id "${input.id}" is already used by another element`);
            created.push(ctx.bpmnFactory.create(spec.type, { ...spec.attrs(input), id: input.id }));
          } else if (found) {
            kept.add(found);
            const attrs = spec.attrs(input);
            const changed = Object.entries(attrs).some(([k, v]) => found.get(k) !== v);
            if (changed) ctx.modeling.updateModdleProperties(el, found, attrs);
          } else {
            created.push(ctx.bpmnFactory.create(spec.type, spec.attrs(input)));
          }
        }
        const removed = [...existing.values()].filter((r) => !kept.has(r));
        // a deleted message, signal or error must not stay referenced: the references go in the same undo step
        if (removed.length > 0) {
          for (const { holder, property, target } of referencesBelow(definitions)) {
            if (!removed.includes(target)) continue;
            const owner = ownerShape(ctx, holder) ?? el;
            ctx.modeling.updateModdleProperties(owner, holder, { [property]: undefined });
          }
        }
        if (created.length > 0 || removed.length > 0) {
          const next = roots.filter((r) => !removed.includes(r));
          ctx.modeling.updateModdleProperties(el, definitions, { rootElements: [...next, ...created] });
        }
      });
    },
  };
}

const unique = <T extends RootElementInput>(key: string, what: string, name: (i: T) => string | undefined, all: T[], input: T): void => {
  const n = name(input);
  if (!n) throw new AccessorError('INVALID_VALUE', key, `a ${what} needs a ${what === 'error' ? 'errorCode' : 'name'}`);
  if (all.filter((o) => name(o) === n).length > 1) throw new AccessorError('DUPLICATE', key, `${what} "${n}" is defined twice`);
};

const messages = listAccessor<MessageInput>({
  key: 'definitions.messages',
  label: 'Messages',
  type: 'bpmn:Message',
  toInput: (m) => ({ id: m.id, name: (m.get('name') as string | undefined) ?? '' }),
  attrs: (i) => ({ name: i.name }),
  validate: (i, all) => unique('definitions.messages', 'message', (x) => x.name, all, i),
});

const signals = listAccessor<SignalInput>({
  key: 'definitions.signals',
  label: 'Signals',
  type: 'bpmn:Signal',
  toInput: (s) => {
    const out: SignalInput = { id: s.id, name: (s.get('name') as string | undefined) ?? '' };
    const scope = s.get('activiti:scope') as SignalInput['scope'] | undefined;
    if (scope) out.scope = scope;
    return out;
  },
  attrs: (i) => ({ name: i.name, 'activiti:scope': i.scope }),
  validate: (i, all) => {
    unique('definitions.signals', 'signal', (x) => x.name, all, i);
    if (i.scope !== undefined) assertOneOf('definitions.signals', i.scope, ['global', 'processInstance'], 'signal scope');
  },
});

const errors = listAccessor<ErrorInput>({
  key: 'definitions.errors',
  label: 'Errors',
  type: 'bpmn:Error',
  toInput: (e) => ({ id: e.id, name: e.get('name') as string | undefined, errorCode: (e.get('errorCode') as string | undefined) ?? '' }),
  attrs: (i) => ({ name: i.name ?? i.errorCode, errorCode: i.errorCode }),
  validate: (i, all) => unique('definitions.errors', 'error', (x) => x.errorCode, all, i),
});

/** The diagram element that carries `holder` (an event definition lives on its event, a task or message flow is itself the element). */
function ownerShape(ctx: AccessorContext, holder: ModdleElement): DiagramElement | undefined {
  if (holder.$instanceOf('bpmn:EventDefinition')) return shapeOfEventDefinition(ctx.elementRegistry, holder);
  return holder.id ? ctx.elementRegistry.get(holder.id) : undefined;
}

const sameUsage = (a: unknown, b: DefinitionsUsage): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Read only: how often each message, signal and error is referenced, for the "used by" counts and the delete warnings of the panel. */
const usage: PropertyAccessor<DefinitionsUsage> = {
  key: 'definitions.usage',
  group: 'Messages / Signals / Errors',
  label: 'References to messages, signals and errors',
  writes: 'xml',
  appliesTo: isRoot,
  get: (_c, el) => usageOf(definitionsOf(el)),
  set: (_c, el, value) => {
    if (!sameUsage(value, usageOf(definitionsOf(el)))) throw new AccessorError('READ_ONLY', 'definitions.usage', 'reference counts are derived from the event definitions; change the references instead');
  },
};

export const definitionsAccessors: AnyAccessor[] = [messages, signals, errors, usage];
