import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertString, bo, createModdle, extensionsOfType, orUndefined, replaceExtensions, stringAttr } from './helpers';
import { createResourceAssignment, resourceExpressionText } from './general';
import { AccessorError, type AnyAccessor, type PropertyAccessor } from './types';

const USER_TASK = ['bpmn:UserTask'];
const user = (field: string, label: string, attr = field): PropertyAccessor<string | undefined> =>
  stringAttr({ key: `user.${field}`, group: 'User assignment', attr: `activiti:${attr}`, appliesTo: USER_TASK, label });

/** A standard resource role (`humanPerformer` / `potentialOwner`): `user(x)`, `group(y)` or an expression. */
function resourceRole(key: string, type: 'bpmn:HumanPerformer' | 'bpmn:PotentialOwner', label: string): PropertyAccessor<string | undefined> {
  return {
    key,
    group: 'User assignment',
    label,
    writes: 'xml',
    appliesTo: (el) => is(el, 'bpmn:UserTask'),
    get: (_c, el) => resourceExpressionText(((bo(el).get('resources') as ModdleElement[] | undefined) ?? []).find((r) => r.$type === type)),
    set: (ctx, el, value) => {
      if (value !== undefined) assertString(key, value);
      const others = ((bo(el).get('resources') as ModdleElement[] | undefined) ?? []).filter((r) => r.$type !== type);
      const resources = value ? [...others, createModdle(ctx, type, { resourceAssignmentExpression: createResourceAssignment(ctx, value) })] : others;
      ctx.modeling.updateProperties(el, { resources });
    },
  };
}

export interface CustomResourceValue {
  name: string;
  expression: string;
}

const customResource: PropertyAccessor<CustomResourceValue[]> = {
  key: 'user.customResource',
  group: 'User assignment',
  label: 'Custom identity links',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:UserTask'),
  get: (_c, el) =>
    extensionsOfType(bo(el), 'activiti:CustomResource').map((r) => ({ name: (r.get('name') as string | undefined) ?? '', expression: resourceExpressionText(r) ?? '' })),
  set: (ctx, el, value) => {
    for (const item of value) {
      if (!item.name) throw new AccessorError('INVALID_VALUE', 'user.customResource', 'a custom resource needs a name (the identity link type)');
    }
    const items = value.map((v) => createModdle(ctx, 'activiti:CustomResource', { name: v.name, resourceAssignmentExpression: createResourceAssignment(ctx, v.expression) }));
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:CustomResource', items);
  },
};

// --- start event / form ------------------------------------------------------------------------------------------------

const initiator = stringAttr({ key: 'start.initiator', group: 'Start initiator / form', attr: 'activiti:initiator', appliesTo: ['bpmn:StartEvent'], label: 'Initiator variable' });
const formKey = stringAttr({ key: 'form.key', group: 'Form', attr: 'activiti:formKey', appliesTo: ['bpmn:StartEvent', 'bpmn:UserTask'], label: 'Form key' });

export interface FormPropertyValue {
  id: string;
  name?: string;
  type?: string;
  variable?: string;
  expression?: string;
  default?: string;
  datePattern?: string;
  required?: string;
  readable?: string;
  writable?: string;
  values?: Array<{ id?: string; name?: string }>;
}

/** Legacy form properties: parsed by Activiti but consumed by nothing; edited so imported models stay faithful. */
const formProperties: PropertyAccessor<FormPropertyValue[]> = {
  key: 'form.properties',
  group: 'Form',
  label: 'Form properties (legacy, not executed by Activiti 9)',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:StartEvent') || is(el, 'bpmn:UserTask'),
  get: (_c, el) =>
    extensionsOfType(bo(el), 'activiti:FormProperty').map((p) => {
      const value: FormPropertyValue = { id: p.get('id') as string };
      for (const k of ['name', 'type', 'variable', 'expression', 'default', 'datePattern', 'required', 'readable', 'writable'] as const) {
        const v = p.get(k) as string | undefined;
        if (v !== undefined) value[k] = v;
      }
      const values = (p.get('values') as ModdleElement[] | undefined) ?? [];
      if (values.length > 0) value.values = values.map((v) => ({ id: v.get('id') as string | undefined, name: v.get('name') as string | undefined }));
      return value;
    }),
  set: (ctx, el, value) => {
    const items = value.map((p) => {
      if (!p.id) throw new AccessorError('INVALID_VALUE', 'form.properties', 'a form property needs an id');
      const { values, ...attrs } = p;
      const created = createModdle(ctx, 'activiti:FormProperty', Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, orUndefined(v as string)])));
      if (values) created.set('values', values.map((v) => createModdle(ctx, 'activiti:Value', { id: v.id, name: v.name })));
      return created;
    });
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:FormProperty', items);
  },
};

export const userAccessors: AnyAccessor[] = [
  user('assignee', 'Assignee'),
  user('owner', 'Owner'),
  user('candidateUsers', 'Candidate users'),
  user('candidateGroups', 'Candidate groups'),
  user('dueDate', 'Due date'),
  user('priority', 'Priority'),
  user('category', 'Category'),
  user('businessCalendarName', 'Business calendar'),
  resourceRole('user.humanPerformer', 'bpmn:HumanPerformer', 'Human performer'),
  resourceRole('user.potentialOwner', 'bpmn:PotentialOwner', 'Potential owner'),
  customResource,
  initiator,
  formKey,
  formProperties,
];

export type { DiagramElement };
