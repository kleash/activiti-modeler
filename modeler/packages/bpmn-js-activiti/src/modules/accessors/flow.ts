import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertNcName, assertOneOf, assertString, bo, createModdle, definitionsOf, extensionsOfType, formalExpression, orUndefined, renameModdleElement, renamedByPosition, replaceExtensions } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

// --- sequence flow ---------------------------------------------------------------------------------------------------

const flowCondition: PropertyAccessor<string | undefined> = {
  key: 'flow.condition',
  group: 'Condition',
  label: 'Condition expression',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:SequenceFlow'),
  get: (_c, el) => (bo(el).get('conditionExpression') as ModdleElement | undefined)?.get('body') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('flow.condition', value);
    // JUEL conditions are written as <conditionExpression xsi:type="tFormalExpression"> like bpmn-js does
    ctx.modeling.updateProperties(el, { conditionExpression: value ? formalExpression(ctx, value) : undefined });
  },
};

const DEFAULT_CAPABLE = (source: ModdleElement): boolean =>
  source.$instanceOf('bpmn:ExclusiveGateway') || source.$instanceOf('bpmn:InclusiveGateway') || source.$instanceOf('bpmn:ComplexGateway') || source.$instanceOf('bpmn:Activity');

const flowDefault: PropertyAccessor<boolean> = {
  key: 'flow.default',
  group: 'Condition',
  label: 'Default flow',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:SequenceFlow') && !!el.source && DEFAULT_CAPABLE(el.source.businessObject),
  get: (_c, el) => (el.source?.businessObject.get('default') as ModdleElement | undefined) === bo(el),
  set: (ctx, el, value) => {
    if (typeof value !== 'boolean') throw new AccessorError('INVALID_VALUE', 'flow.default', 'value must be a boolean');
    const source = el.source;
    if (!source) throw new AccessorError('NOT_APPLICABLE', 'flow.default', 'the flow has no source');
    const current = source.businessObject.get('default') as ModdleElement | undefined;
    if (value) {
      // a default flow carries no condition (EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW)
      ctx.batch(() => {
        if (bo(el).get('conditionExpression')) ctx.modeling.updateProperties(el, { conditionExpression: undefined });
        ctx.modeling.updateProperties(source, { default: bo(el) });
      });
    } else if (current === bo(el)) {
      ctx.modeling.updateProperties(source, { default: undefined });
    }
  },
};

// --- data objects ------------------------------------------------------------------------------------------------------

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

/** `itemSubjectRef="xsd:int"` is a QName: Activiti's XML parser refuses the whole deployment when the prefix is not declared. */
function declareXsdNamespace(ctx: AccessorContext, el: DiagramElement): void {
  const definitions = definitionsOf(el);
  if (definitions.$attrs?.['xmlns:xsd'] !== XSD_NAMESPACE) ctx.modeling.updateModdleProperties(el, definitions, { 'xmlns:xsd': XSD_NAMESPACE });
}

export const DATA_TYPES = ['xsd:string', 'xsd:int', 'xsd:long', 'xsd:double', 'xsd:boolean', 'xsd:datetime'] as const;
const dataObjectOf = (el: DiagramElement): ModdleElement | undefined => {
  const b = bo(el);
  if (b.$instanceOf('bpmn:DataObject')) return b;
  return b.$instanceOf('bpmn:DataObjectReference') ? (b.get('dataObjectRef') as ModdleElement | undefined) : undefined;
};
const isData = (el: DiagramElement): boolean => dataObjectOf(el) !== undefined;

const dataType: PropertyAccessor<string | undefined> = {
  key: 'data.type',
  group: 'Data object',
  label: 'Type',
  writes: 'xml',
  appliesTo: isData,
  get: (_c, el) => dataObjectOf(el)?.get('itemSubjectRef') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertOneOf('data.type', value, DATA_TYPES, 'data object type');
    ctx.batch(() => {
      ctx.modeling.updateModdleProperties(el, dataObjectOf(el)!, { itemSubjectRef: value });
      if (value !== undefined) declareXsdNamespace(ctx, el);
    });
  },
};

const dataValue: PropertyAccessor<string | undefined> = {
  key: 'data.value',
  group: 'Data object',
  label: 'Default value',
  writes: 'xml',
  appliesTo: isData,
  get: (_c, el) => extensionsOfType(dataObjectOf(el)!, 'activiti:Value')[0]?.get('body') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('data.value', value);
    const items = value ? [createModdle(ctx, 'activiti:Value', { body: value })] : [];
    replaceExtensions(ctx, el, dataObjectOf(el)!, (v) => v.$type === 'activiti:Value', items);
  },
};

/** The variable name of a data object is the name of the `bpmn:DataObject`, not of its reference shape. */
const dataName: PropertyAccessor<string | undefined> = {
  key: 'data.name',
  group: 'Data object',
  label: 'Variable name',
  writes: 'xml',
  appliesTo: isData,
  get: (_c, el) => dataObjectOf(el)?.get('name') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('data.name', value);
    ctx.batch(() => {
      ctx.modeling.updateModdleProperties(el, dataObjectOf(el)!, { name: orUndefined(value) });
      if (bo(el).$instanceOf('bpmn:DataObjectReference')) ctx.modeling.updateProperties(el, { name: orUndefined(value) });
    });
  },
};

/** The `bpmn:DataObject` has an id of its own, next to the id of the reference shape (`general.id`). */
const dataId: PropertyAccessor<string> = {
  key: 'data.id',
  group: 'Data object',
  label: 'Data object ID',
  writes: 'xml',
  appliesTo: isData,
  get: (_c, el) => dataObjectOf(el)!.id as string,
  set: (ctx, el, value) => renameModdleElement(ctx, 'data.id', el, dataObjectOf(el)!, value),
};

// --- data objects of a container, without a shape ------------------------------------------------------------------------

/** A `bpmn:DataObject` of a process or sub process as the engine reads it: a variable with a type and a default value. */
export interface DataObjectInput {
  /** Existing id to update; omit to create one with a generated id, or give a new id to create it with that id. */
  id?: string;
  name: string;
  type?: string;
  value?: string;
}

const CONTAINER_TYPES = ['bpmn:Process', 'bpmn:SubProcess'] as const;
/** The business object whose `flowElements` hold the data objects: a process, a sub process, or the process of a pool. */
const containerOf = (el: DiagramElement): ModdleElement | undefined => {
  if (el.labelTarget || !el.businessObject) return undefined;
  if (is(el, 'bpmn:Participant')) return bo(el).get('processRef') as ModdleElement | undefined;
  return CONTAINER_TYPES.some((t) => is(el, t)) ? bo(el) : undefined;
};
const dataObjectsIn = (container: ModdleElement): ModdleElement[] => ((container.get('flowElements') as ModdleElement[] | undefined) ?? []).filter((f) => f.$instanceOf('bpmn:DataObject'));

const dataObjects: PropertyAccessor<DataObjectInput[]> = {
  key: 'data.objects',
  group: 'Data object',
  label: 'Data objects',
  writes: 'xml',
  appliesTo: (el) => containerOf(el) !== undefined,
  get: (_c, el) =>
    dataObjectsIn(containerOf(el)!).map((d) => {
      const out: DataObjectInput = { id: d.id as string, name: (d.get('name') as string | undefined) ?? '' };
      const type = d.get('itemSubjectRef') as string | undefined;
      if (type !== undefined) out.type = type;
      const value = extensionsOfType(d, 'activiti:Value')[0]?.get('body') as string | undefined;
      if (value !== undefined) out.value = value;
      return out;
    }),
  set: (ctx, el, value) => {
    const container = containerOf(el)!;
    const names = new Set<string>();
    for (const input of value) {
      if (!input.name || typeof input.name !== 'string') throw new AccessorError('INVALID_VALUE', 'data.objects', 'a data object needs a name (it is the variable name)');
      if (names.has(input.name)) throw new AccessorError('DUPLICATE', 'data.objects', `data object "${input.name}" is defined twice`);
      names.add(input.name);
      if (input.type !== undefined) assertOneOf('data.objects', input.type, DATA_TYPES, 'data object type');
      if (input.value !== undefined) assertString('data.objects', input.value, 'data object value');
    }
    const current = dataObjectsIn(container);
    const existing = new Map(current.map((d) => [d.id as string, d]));
    const renames = renamedByPosition(value, current);
    ctx.batch(() => {
      const kept = new Set<ModdleElement>();
      const created: ModdleElement[] = [];
      for (const input of value) {
        const renamed = renames.get(input);
        if (renamed) renameModdleElement(ctx, 'data.objects', el, renamed, input.id);
        const found = renamed ?? (input.id ? existing.get(input.id) : undefined);
        if (input.id && !found) {
          assertNcName('data.objects', input.id);
          if (ctx.moddle.ids.assigned(input.id)) throw new AccessorError('DUPLICATE_ID', 'data.objects', `id "${input.id}" is already used`);
        }
        const attrs: Record<string, unknown> = { name: input.name, ...(input.type !== undefined ? { itemSubjectRef: input.type } : {}), ...(input.id && !found ? { id: input.id } : {}) };
        const values = input.value !== undefined && input.value !== '' ? [createModdle(ctx, 'activiti:Value', { body: input.value })] : [];
        if (found) {
          kept.add(found);
          const next = ctx.bpmnFactory.create('bpmn:ExtensionElements', { values });
          const current = extensionsOfType(found, 'activiti:Value')[0]?.get('body') as string | undefined;
          const changes: Record<string, unknown> = {};
          if (found.get('name') !== input.name) changes['name'] = input.name;
          if (found.get('itemSubjectRef') !== input.type) changes['itemSubjectRef'] = input.type;
          if (Object.keys(changes).length > 0) ctx.modeling.updateModdleProperties(el, found, changes);
          if (current !== (input.value === '' ? undefined : input.value)) {
            ctx.modeling.updateModdleProperties(el, found, { extensionElements: values.length > 0 ? next : undefined });
          }
        } else {
          const object = ctx.bpmnFactory.create('bpmn:DataObject', attrs);
          if (values.length > 0) object.set('extensionElements', ctx.bpmnFactory.create('bpmn:ExtensionElements', { values }));
          created.push(object);
        }
      }
      const removed = [...existing.values()].filter((d) => !kept.has(d));
      for (const object of removed) {
        const referenced = ctx.elementRegistry.filter((e) => is(e, 'bpmn:DataObjectReference') && bo(e).get('dataObjectRef') === object);
        if (referenced.length > 0) throw new AccessorError('IN_USE', 'data.objects', `data object "${object.id}" is drawn as ${referenced.map((r) => r.id).join(', ')}; delete the shape first`);
      }
      if (created.length > 0 || removed.length > 0) {
        const flowElements = ((container.get('flowElements') as ModdleElement[] | undefined) ?? []).filter((f) => !removed.includes(f));
        ctx.modeling.updateModdleProperties(el, container, { flowElements: [...flowElements, ...created] });
      }
      if (value.some((i) => i.type !== undefined)) declareXsdNamespace(ctx, el);
    });
  },
};

export const flowAccessors: AnyAccessor[] = [flowCondition, flowDefault, dataObjects, dataId, dataName, dataType, dataValue];
