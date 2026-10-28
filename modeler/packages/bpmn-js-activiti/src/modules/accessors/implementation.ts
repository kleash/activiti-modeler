import { DMN_DECISION_IMPLEMENTATION, DMN_TABLE_CONSTANT, SERVICE_TASK_TYPES } from '../../support-matrix';
import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertOneOf, assertString, bo, booleanAttr, createModdle, extensionsOfType, orUndefined, processIdFor, replaceExtensions, stringAttr } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

// --- field injection ------------------------------------------------------------------------------------------------

/** A field as the modeler edits it: a literal (`string`) or an `expression`. */
export interface FieldInput {
  name: string;
  string?: string;
  expression?: string;
}

/** Reads both XML forms: attributes (`stringValue`, `expression`) and child elements. */
export function readField(field: ModdleElement): FieldInput {
  const out: FieldInput = { name: (field.get('name') as string | undefined) ?? '' };
  const string = (field.get('stringValue') as string | undefined) ?? ((field.get('string') as ModdleElement | undefined)?.get('body') as string | undefined);
  const expression = (field.get('expression') as string | undefined) ?? ((field.get('expressionElement') as ModdleElement | undefined)?.get('body') as string | undefined);
  if (string !== undefined) out.string = string;
  else if (expression !== undefined) out.expression = expression;
  return out;
}

/** Writes the canonical child-element form that Activiti's own modeler wrote. */
export function createField(ctx: AccessorContext, key: string, input: FieldInput): ModdleElement {
  if (!input.name) throw new AccessorError('INVALID_FIELD', key, 'a field needs a name');
  if (input.string !== undefined && input.expression !== undefined) throw new AccessorError('INVALID_FIELD', key, `field "${input.name}" has both a string and an expression`);
  const attrs: Record<string, unknown> = { name: input.name };
  if (input.string !== undefined) attrs['string'] = createModdle(ctx, 'activiti:String', { body: input.string });
  else if (input.expression !== undefined) attrs['expressionElement'] = createModdle(ctx, 'activiti:Expression', { body: input.expression });
  return createModdle(ctx, 'activiti:Field', attrs);
}

const FIELD_HOLDERS = ['bpmn:ServiceTask', 'bpmn:SendTask'];

const fieldsList: PropertyAccessor<FieldInput[]> = {
  key: 'fields.list',
  group: 'Field injection',
  label: 'Fields',
  writes: 'xml',
  appliesTo: (el) => FIELD_HOLDERS.some((t) => is(el, t)),
  get: (_c, el) => extensionsOfType(bo(el), 'activiti:Field').map(readField),
  set: (ctx, el, value) => {
    const names = new Set<string>();
    for (const f of value) {
      if (names.has(f.name)) throw new AccessorError('DUPLICATE_FIELD', 'fields.list', `field "${f.name}" is declared twice`);
      names.add(f.name);
    }
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:Field', value.map((f) => createField(ctx, 'fields.list', f)));
  },
};

/** One named field of a service / send task, as used by the structured mail and shell editors. */
function singleField(key: string, group: string, fieldName: string, appliesTo: (el: DiagramElement) => boolean): PropertyAccessor<string | { expression: string } | undefined> {
  return {
    key,
    group,
    label: fieldName,
    writes: 'xml',
    appliesTo,
    get: (_c, el) => {
      const field = extensionsOfType(bo(el), 'activiti:Field').find((f) => f.get('name') === fieldName);
      if (!field) return undefined;
      const read = readField(field);
      return read.expression !== undefined ? { expression: read.expression } : read.string;
    },
    set: (ctx, el, value) => {
      const all = extensionsOfType(bo(el), 'activiti:Field');
      const others = all.filter((f) => f.get('name') !== fieldName);
      let created: ModdleElement[] = [];
      if (value !== undefined && value !== '') {
        created = [createField(ctx, key, typeof value === 'string' ? { name: fieldName, string: value } : { name: fieldName, expression: value.expression })];
      }
      const previousIndex = all.findIndex((f) => f.get('name') === fieldName);
      const next = others.slice();
      next.splice(previousIndex === -1 ? next.length : Math.min(previousIndex, next.length), 0, ...created);
      replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:Field', next);
    },
  };
}

const isTypedTask = (type: string) => (el: DiagramElement): boolean =>
  (is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SendTask')) && bo(el).get('activiti:type') === type;

const MAIL_FIELDS = ['to', 'from', 'cc', 'bcc', 'subject', 'text', 'textVar', 'html', 'htmlVar', 'charset', 'ignoreException', 'exceptionVariableName', 'attachments'];
const SHELL_FIELDS = ['command', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'wait', 'redirectError', 'cleanEnv', 'outputVariable', 'errorCodeVariable', 'directory'];

// --- implementation type ------------------------------------------------------------------------------------------------

export type ImplementationType = 'none' | 'connector' | 'class' | 'expression' | 'delegateExpression' | 'mail' | 'shell' | 'decision';
const SERVICE_TYPES: readonly ImplementationType[] = ['none', 'connector', 'class', 'expression', 'delegateExpression', 'mail', 'shell', 'decision'];

export function implementationTypeOf(el: DiagramElement): ImplementationType {
  const b = bo(el);
  const activitiType = b.get('activiti:type') as string | undefined;
  if (activitiType === 'mail' || activitiType === 'shell') return activitiType;
  if (b.get('activiti:class') !== undefined) return 'class';
  if (b.get('activiti:expression') !== undefined) return 'expression';
  if (b.get('activiti:delegateExpression') !== undefined) return 'delegateExpression';
  const implementation = b.get('implementation') as string | undefined;
  if (implementation === DMN_DECISION_IMPLEMENTATION) return 'decision';
  if (implementation !== undefined) return 'connector';
  return 'none';
}

const IMPLEMENTATION_ATTRS = ['activiti:class', 'activiti:expression', 'activiti:delegateExpression', 'implementation', 'activiti:type', 'activiti:resultVariableName'];

/**
 * Switching the type sets exactly the attribute of the new type (with what the element already had when it has the
 * same kind, or an empty value to fill in) and leaves the others cleared; the ImplementationBehavior removes fields
 * that do not belong to the new type.
 */
const implementationType: PropertyAccessor<ImplementationType> = {
  key: 'impl.type',
  group: 'Implementation',
  label: 'Implementation type',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SendTask'),
  get: (_c, el) => implementationTypeOf(el),
  set: (ctx, el, value) => {
    assertOneOf('impl.type', value, SERVICE_TYPES, 'implementation type');
    if (is(el, 'bpmn:SendTask') && value !== 'mail' && value !== 'none') throw new AccessorError('NOT_APPLICABLE', 'impl.type', 'a send task only works as mail (R1 §3.3)');
    const b = bo(el);
    const cleared = Object.fromEntries(IMPLEMENTATION_ATTRS.map((a) => [a, undefined])) as Record<string, unknown>;
    const keep = (attr: string): string => (b.get(attr) as string | undefined) ?? '';
    switch (value) {
      case 'none':
        break;
      case 'class':
        cleared['activiti:class'] = keep('activiti:class');
        break;
      case 'expression':
        cleared['activiti:expression'] = keep('activiti:expression');
        cleared['activiti:resultVariableName'] = b.get('activiti:resultVariableName');
        break;
      case 'delegateExpression':
        cleared['activiti:delegateExpression'] = keep('activiti:delegateExpression');
        break;
      case 'connector': {
        const current = b.get('implementation') as string | undefined;
        cleared['implementation'] = current && current !== DMN_DECISION_IMPLEMENTATION ? current : '';
        break;
      }
      case 'decision':
        cleared['implementation'] = DMN_DECISION_IMPLEMENTATION;
        break;
      case 'mail':
      case 'shell':
        cleared['activiti:type'] = value;
        break;
    }
    ctx.modeling.updateProperties(el, cleared);
  },
};

const SERVICE = ['bpmn:ServiceTask'];
const classAttr = stringAttr({ key: 'impl.class', group: 'Implementation', attr: 'activiti:class', appliesTo: SERVICE, label: 'Java class' });
const expressionAttr = stringAttr({ key: 'impl.expression', group: 'Implementation', attr: 'activiti:expression', appliesTo: SERVICE, label: 'Expression' });
const delegateExpressionAttr = stringAttr({ key: 'impl.delegateExpression', group: 'Implementation', attr: 'activiti:delegateExpression', appliesTo: SERVICE, label: 'Delegate expression' });
const resultVariable = stringAttr({
  key: 'impl.resultVariable',
  group: 'Implementation',
  attr: 'activiti:resultVariableName',
  appliesTo: (el) => is(el, 'bpmn:ServiceTask'),
  label: 'Result variable name',
  validate: (value) => {
    // class / delegateExpression with resultVariableName is a validator error (SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE)
    if (value) return;
  },
});
const connector: PropertyAccessor<string | undefined> = {
  key: 'impl.connector',
  group: 'Implementation',
  label: 'Connector action (<connector>.<ACTION>)',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:ServiceTask'),
  get: (_c, el) => {
    const v = bo(el).get('implementation') as string | undefined;
    return v === DMN_DECISION_IMPLEMENTATION ? undefined : v;
  },
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('impl.connector', value);
    if (value === '##WebService') throw new AccessorError('UNSUPPORTED', 'impl.connector', 'web service tasks are not supported by Activiti 9 (no CXF importer)');
    // the implementation attribute is the whole connector selection; other implementation attributes go away
    const cleared = Object.fromEntries(IMPLEMENTATION_ATTRS.map((a) => [a, undefined])) as Record<string, unknown>;
    cleared['implementation'] = value;
    ctx.modeling.updateProperties(el, cleared);
  },
};

const decisionTable: PropertyAccessor<string | undefined> = {
  key: 'decision.table',
  group: 'Decision',
  label: 'Decision (DMN decision key)',
  writes: 'ext',
  appliesTo: (el) => is(el, 'bpmn:ServiceTask') && bo(el).get('implementation') === DMN_DECISION_IMPLEMENTATION,
  get: (ctx, el) => {
    const constants = ctx.store.getProcess(processIdFor('decision.table', el))?.constants[el.id];
    const value = constants?.[DMN_TABLE_CONSTANT]?.value;
    return typeof value === 'string' && value !== '' ? value : undefined;
  },
  set: (ctx, el, value) => {
    const processId = processIdFor('decision.table', el);
    const current = ctx.store.getProcess(processId)?.constants[el.id] ?? {};
    ctx.store.setConstants(processId, el.id, { ...current, [DMN_TABLE_CONSTANT]: { value: value ?? '' } });
  },
};

// --- script ---------------------------------------------------------------------------------------------------------------

const SCRIPT = ['bpmn:ScriptTask'];
const scriptFormat = stringAttr({ key: 'script.format', group: 'Script', attr: 'scriptFormat', appliesTo: SCRIPT, label: 'Script format' });
const scriptText: PropertyAccessor<string | undefined> = {
  key: 'script.text',
  group: 'Script',
  label: 'Script',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:ScriptTask'),
  get: (_c, el) => bo(el).get('script') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('script.text', value);
    ctx.modeling.updateProperties(el, { script: orUndefined(value) });
  },
};
const scriptResult = stringAttr({ key: 'script.resultVariable', group: 'Script', attr: 'activiti:resultVariable', appliesTo: SCRIPT, label: 'Result variable' });
const scriptAutoStore = booleanAttr({ key: 'script.autoStoreVariables', group: 'Script', attr: 'activiti:autoStoreVariables', appliesTo: SCRIPT, label: 'Auto-store variables' });

// --- called element ----------------------------------------------------------------------------------------------------

const CALL = ['bpmn:CallActivity'];
const calledElement = stringAttr({ key: 'call.calledElement', group: 'Called element', attr: 'calledElement', appliesTo: CALL, label: 'Called element (process key or ${expression})' });
const businessKey = stringAttr({ key: 'call.businessKey', group: 'Called element', attr: 'activiti:businessKey', appliesTo: CALL, label: 'Business key' });
const inheritBusinessKey = booleanAttr({ key: 'call.inheritBusinessKey', group: 'Called element', attr: 'activiti:inheritBusinessKey', appliesTo: CALL, label: 'Inherit business key' });
const inheritVariables = booleanAttr({ key: 'call.inheritVariables', group: 'Called element', attr: 'activiti:inheritVariables', appliesTo: CALL, label: 'Inherit variables' });

export interface CallParameter {
  source?: string;
  sourceExpression?: string;
  target: string;
}

function callParameters(key: string, type: 'activiti:In' | 'activiti:Out', label: string): PropertyAccessor<CallParameter[]> {
  return {
    key,
    group: 'Called element',
    label,
    writes: 'xml',
    appliesTo: (el) => is(el, 'bpmn:CallActivity'),
    get: (_c, el) =>
      extensionsOfType(bo(el), type).map((p) => {
        const out: CallParameter = { target: (p.get('target') as string | undefined) ?? '' };
        const source = p.get('source') as string | undefined;
        const sourceExpression = p.get('sourceExpression') as string | undefined;
        if (source !== undefined) out.source = source;
        if (sourceExpression !== undefined) out.sourceExpression = sourceExpression;
        return out;
      }),
    set: (ctx, el, value) => {
      for (const p of value) {
        // the engine drops an in/out without target, or without source and sourceExpression (R1 §4.6)
        if (!p.target) throw new AccessorError('INVALID_VALUE', key, 'a parameter needs a target');
        if (!p.source && !p.sourceExpression) throw new AccessorError('INVALID_VALUE', key, `parameter "${p.target}" needs a source or a sourceExpression`);
      }
      const items = value.map((p) => createModdle(ctx, type, { source: orUndefined(p.sourceExpression ? undefined : p.source), sourceExpression: orUndefined(p.sourceExpression), target: p.target }));
      replaceExtensions(ctx, el, bo(el), (v) => v.$type === type, items);
    },
  };
}

export const implementationAccessors: AnyAccessor[] = [
  implementationType,
  classAttr,
  expressionAttr,
  delegateExpressionAttr,
  resultVariable,
  connector,
  decisionTable,
  fieldsList,
  ...MAIL_FIELDS.map((f) => singleField(`mail.${f}`, 'Mail / Shell fields', f, (el) => isTypedTask('mail')(el))),
  ...SHELL_FIELDS.map((f) => singleField(`shell.${f}`, 'Mail / Shell fields', f, (el) => isTypedTask('shell')(el))),
  scriptFormat,
  scriptText,
  scriptResult,
  scriptAutoStore,
  calledElement,
  businessKey,
  inheritBusinessKey,
  inheritVariables,
  callParameters('call.in', 'activiti:In', 'In parameters'),
  callParameters('call.out', 'activiti:Out', 'Out parameters'),
];

export { SERVICE_TASK_TYPES };
