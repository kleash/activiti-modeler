import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertOneOf, assertString, bo, booleanAttr, createModdle, extensionsOfType, formalExpression, isActivity, isFlowNode, nestedAttr, orUndefined, replaceExtensions, stringAttr } from './helpers';
import { AccessorError, type AnyAccessor, type PropertyAccessor } from './types';

// --- asynchronous continuation / jobs -----------------------------------------------------------------------------------

const asyncFlag = booleanAttr({ key: 'async.async', group: 'Asynchronous continuation', attr: 'activiti:async', appliesTo: isFlowNode, label: 'Asynchronous' });
const exclusive = booleanAttr({ key: 'async.exclusive', group: 'Asynchronous continuation', attr: 'activiti:exclusive', appliesTo: isFlowNode, defaultValue: true, label: 'Exclusive' });

/** The engine honours failedJobRetryTimeCycle on service tasks only (JobRetryCmd, R1 §3). */
const retryCycle: PropertyAccessor<string | undefined> = {
  key: 'job.failedJobRetryTimeCycle',
  group: 'Job execution',
  label: 'Failed job retry time cycle',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:ServiceTask'),
  get: (_c, el) => extensionsOfType(bo(el), 'activiti:FailedJobRetryTimeCycle')[0]?.get('body') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('job.failedJobRetryTimeCycle', value);
    const items = value ? [createModdle(ctx, 'activiti:FailedJobRetryTimeCycle', { body: value })] : [];
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:FailedJobRetryTimeCycle', items);
  },
};

export interface MapExceptionValue {
  errorCode: string;
  /** The exception class the entry maps; empty is the default entry that maps every other exception (it goes last: the first match wins). */
  exceptionClass: string;
  includeChildExceptions?: boolean;
}

/** Wired only for `activiti:class` service tasks and call activities (DefaultActivityBehaviorFactory, R1 §3). */
const mapExceptions: PropertyAccessor<MapExceptionValue[]> = {
  key: 'errors.mapExceptions',
  group: 'Error mapping',
  label: 'Exception mapping',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:CallActivity') || (is(el, 'bpmn:ServiceTask') && bo(el).get('activiti:class') !== undefined),
  get: (_c, el) =>
    extensionsOfType(bo(el), 'activiti:MapException').map((m) => ({
      errorCode: (m.get('errorCode') as string | undefined) ?? '',
      exceptionClass: (m.get('body') as string | undefined) ?? '',
      includeChildExceptions: m.get('includeChildExceptions') === true,
    })),
  set: (ctx, el, value) => {
    for (const m of value) {
      if (!m.errorCode?.trim()) throw new AccessorError('INVALID_VALUE', 'errors.mapExceptions', 'an exception mapping needs an errorCode');
    }
    const items = value.map((m) => createModdle(ctx, 'activiti:MapException', { errorCode: m.errorCode, includeChildExceptions: m.includeChildExceptions ? true : undefined, ...(m.exceptionClass?.trim() ? { body: m.exceptionClass } : {}) }));
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:MapException', items);
  },
};

const skipExpression = stringAttr({
  key: 'skip.expression',
  group: 'Skip expression',
  attr: 'activiti:skipExpression',
  appliesTo: (el) => is(el, 'bpmn:UserTask') || is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SequenceFlow'),
  label: 'Skip expression',
});

// --- multi-instance -----------------------------------------------------------------------------------------------------

const loop = (el: DiagramElement): ModdleElement | undefined => {
  const l = bo(el).get('loopCharacteristics') as ModdleElement | undefined;
  return l && l.$instanceOf('bpmn:MultiInstanceLoopCharacteristics') ? l : undefined;
};
const MI_HOSTS = (el: DiagramElement): boolean => isActivity(el) && !(is(el, 'bpmn:SubProcess') && bo(el).get('triggeredByEvent') === true);

export type MultiInstanceType = 'none' | 'parallel' | 'sequential';

const miType: PropertyAccessor<MultiInstanceType> = {
  key: 'mi.type',
  group: 'Multi-instance',
  label: 'Multi-instance',
  writes: 'xml',
  appliesTo: MI_HOSTS,
  get: (_c, el) => {
    const l = loop(el);
    return l ? (l.get('isSequential') === true ? 'sequential' : 'parallel') : 'none';
  },
  set: (ctx, el, value) => {
    assertOneOf('mi.type', value, ['none', 'parallel', 'sequential'], 'multi-instance type');
    const current = loop(el);
    if (value === 'none') {
      if (bo(el).get('loopCharacteristics')) ctx.modeling.updateProperties(el, { loopCharacteristics: undefined });
      return;
    }
    const isSequential = value === 'sequential';
    if (current) ctx.modeling.updateModdleProperties(el, current, { isSequential });
    else ctx.modeling.updateProperties(el, { loopCharacteristics: createModdle(ctx, 'bpmn:MultiInstanceLoopCharacteristics', { isSequential }) });
  },
};

const miHolder = (el: DiagramElement): ModdleElement | undefined => loop(el);
const miAttr = (field: string, attr: string, label: string): PropertyAccessor<string | boolean | undefined> =>
  nestedAttr({ key: `mi.${field}`, group: 'Multi-instance', attr, appliesTo: MI_HOSTS, holder: miHolder, label });

/**
 * `activiti:collection` / `activiti:elementVariable`, or the standard `loopDataInputRef` / `inputDataItem name` of an opened file: the
 * engine reads both into the same field, the element after the attribute (engine finding 3). The field shows the standard form when the
 * attribute is not there, and a value written replaces the standard element in the same step, so that the value shown is the one that runs.
 */
function miOrStandard(field: 'collection' | 'elementVariable', label: string, standard: 'loopDataInputRef' | 'inputDataItem'): PropertyAccessor<string | boolean | undefined> {
  const attr = miAttr(field, `activiti:${field}`, label);
  const standardValue = (l: ModdleElement | undefined): string | undefined => {
    const value = l?.get(standard) as string | ModdleElement | undefined;
    return typeof value === 'string' ? orUndefined(value) : orUndefined(value?.get('name') as string | undefined);
  };
  return {
    ...attr,
    get: (ctx, el) => attr.get(ctx, el) ?? standardValue(loop(el)),
    set: (ctx, el, value) => {
      const l = loop(el);
      if (!l || l.get(standard) === undefined) return attr.set(ctx, el, value);
      if (value !== undefined) assertString(`mi.${field}`, value);
      ctx.modeling.updateModdleProperties(el, l, { [`activiti:${field}`]: orUndefined(value as string | undefined), [standard]: undefined });
    },
  };
}

/** `loopCardinality` / `completionCondition`: an expression element with the text as body. */
function miExpression(field: 'loopCardinality' | 'completionCondition', key: string, label: string): PropertyAccessor<string | undefined> {
  return {
    key,
    group: 'Multi-instance',
    label,
    writes: 'xml',
    appliesTo: (el) => MI_HOSTS(el) && loop(el) !== undefined,
    get: (_c, el) => (loop(el)?.get(field) as ModdleElement | undefined)?.get('body') as string | undefined,
    set: (ctx, el, value) => {
      const l = loop(el);
      if (!l) throw new AccessorError('NOT_APPLICABLE', key, `${el.id} is not a multi-instance activity`);
      if (value !== undefined) assertString(key, value);
      ctx.modeling.updateModdleProperties(el, l, { [field]: value ? formalExpression(ctx, value) : undefined });
    },
  };
}

const miOutputItem: PropertyAccessor<string | undefined> = {
  key: 'mi.outputItem',
  group: 'Multi-instance',
  label: 'Output element',
  writes: 'xml',
  appliesTo: (el) => MI_HOSTS(el) && loop(el) !== undefined,
  get: (_c, el) => (loop(el)?.get('outputDataItem') as ModdleElement | undefined)?.get('name') as string | undefined,
  set: (ctx, el, value) => {
    const l = loop(el);
    if (!l) throw new AccessorError('NOT_APPLICABLE', 'mi.outputItem', `${el.id} is not a multi-instance activity`);
    ctx.modeling.updateModdleProperties(el, l, { outputDataItem: value ? createModdle(ctx, 'bpmn:DataOutput', { name: value }) : undefined });
  },
};

export const activityAccessors: AnyAccessor[] = [
  asyncFlag,
  exclusive,
  retryCycle,
  mapExceptions,
  skipExpression,
  miType,
  miExpression('loopCardinality', 'mi.cardinality', 'Loop cardinality'),
  miOrStandard('collection', 'Collection', 'loopDataInputRef'),
  miOrStandard('elementVariable', 'Element variable', 'inputDataItem'),
  miAttr('elementIndexVariable', 'activiti:elementIndexVariable', 'Element index variable'),
  miExpression('completionCondition', 'mi.completionCondition', 'Completion condition'),
  nestedAttr({ key: 'mi.outputCollection', group: 'Multi-instance', attr: 'loopDataOutputRef', appliesTo: MI_HOSTS, holder: miHolder, label: 'Output collection' }),
  miOutputItem,
];

export { orUndefined };
