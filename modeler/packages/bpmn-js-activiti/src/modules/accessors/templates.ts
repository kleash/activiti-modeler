import type { ConnectorAction, DeclareHints, MappingValue, ProcessVariablesMapping } from '@activiti-modeler/activiti-project';

import type { DiagramElement } from '../../types';
import {
  buildTemplates, templateLinkOf, TEMPLATE_ID_ATTRIBUTE, TEMPLATE_VERSION_ATTRIBUTE, type ActivitiElementTemplate, type TemplateKind,
} from '../templates/templates';
import { bo, processIdFor } from './helpers';
import { AccessorError, type AccessorContext, type AnyAccessor, type PropertyAccessor } from './types';

/** Elements a template can be applied to: an abstract task (it becomes a service task), a service task, and a send task (mail only). */
const templatable = (el: DiagramElement): boolean => !el.labelTarget && ['bpmn:Task', 'bpmn:ServiceTask', 'bpmn:SendTask'].includes(el.type);

export type TemplateState = 'current' | 'outdated' | 'unknown';

/** What the panel shows in its template header. */
export interface TemplateInfo {
  id: string;
  /** The version recorded on the task. */
  version: string;
  /** The template, when the project still defines it. */
  name?: string;
  kind?: TemplateKind;
  /** The version of the template now. */
  latestVersion?: string;
  /** `unknown`: the connector or its action is no longer in the project. */
  state: TemplateState;
}

const ALL_IMPLEMENTATION_ATTRS = ['activiti:class', 'activiti:expression', 'activiti:delegateExpression', 'implementation', 'activiti:type', 'activiti:resultVariableName'];

export function templateInfoOf(ctx: AccessorContext, el: DiagramElement): TemplateInfo | undefined {
  const link = templateLinkOf(bo(el));
  if (!link) return undefined;
  const template = buildTemplates(ctx.catalog.connectors).find((t) => t.id === link.id);
  if (!template) return { id: link.id, version: link.version, state: 'unknown' };
  return { id: link.id, version: link.version, name: template.name, kind: template.kind, latestVersion: template.version, state: template.version === link.version ? 'current' : 'outdated' };
}

/** The mapping rows a connector action calls for, added to what the task already maps (an existing row is never changed). */
export function mergeActionMapping(current: ProcessVariablesMapping | undefined, action: ConnectorAction): { mapping: ProcessVariablesMapping; hints: DeclareHints } {
  const mapping: ProcessVariablesMapping = structuredClone(current ?? {});
  const hints: DeclareHints = { sourceTypes: {} };
  const inputs: Record<string, MappingValue> = { ...(mapping.inputs ?? {}) };
  for (const input of action.inputs) if (!(input.name in inputs)) inputs[input.name] = { type: 'VARIABLE', value: input.name };
  const outputs: Record<string, MappingValue> = { ...(mapping.outputs ?? {}) };
  for (const output of action.outputs) {
    if (!(output.name in outputs)) outputs[output.name] = { type: 'VARIABLE', value: output.name };
    if (output.type) hints.sourceTypes![output.name] = output.type;
  }
  if (Object.keys(inputs).length > 0) mapping.inputs = inputs;
  if (Object.keys(outputs).length > 0) mapping.outputs = outputs;
  return { mapping, hints };
}

const NOT_APPLICABLE = (id: string, el: DiagramElement): AccessorError => new AccessorError('NOT_APPLICABLE', 'template.apply', `the template ${id} cannot be applied to ${el.id} (${el.type})`);

/** Applies `template` to the element in the current step; returns the element (an abstract task is replaced by a service task of the same id). */
function apply(ctx: AccessorContext, element: DiagramElement, template: ActivitiElementTemplate, mode: 'apply' | 'update'): DiagramElement {
  if (!template.appliesTo.includes(element.type)) throw NOT_APPLICABLE(template.id, element);
  let el = element;
  if (el.type === 'bpmn:Task') {
    const id = el.id;
    el = ctx.bpmnReplace.replaceElement(el, { type: 'bpmn:ServiceTask' });
    if (el.id !== id) throw new AccessorError('REPLACE_FAILED', 'template.apply', `replacing ${id} by a service task changed its id to ${el.id}`);
  }
  const link = { [TEMPLATE_ID_ATTRIBUTE]: template.id, [TEMPLATE_VERSION_ATTRIBUTE]: template.version };

  if (template.kind === 'connector') {
    const connector = template.connector!;
    const implementation = `${connector.name}.${connector.action.id}`;
    const properties: Record<string, unknown> = { ...link };
    if (mode === 'apply') {
      for (const attr of ALL_IMPLEMENTATION_ATTRS) properties[attr] = undefined;
      properties['implementation'] = implementation;
      if (!bo(el).get('name')) properties['name'] = connector.action.name || connector.action.id;
    }
    ctx.modeling.updateProperties(el, properties);
    const processId = processIdFor('template.apply', el);
    const { mapping, hints } = mergeActionMapping(ctx.store.getProcess(processId)?.mappings[el.id], connector.action);
    ctx.store.setMapping(processId, el.id, mapping, { declare: true, hints });
    return el;
  }

  // a built-in kind: the implementation type does the work (it also clears what the previous type left behind)
  if (mode === 'apply') ctx.run(el, 'impl.type', template.kind);
  ctx.modeling.updateProperties(el, link);
  return el;
}

const findTemplate = (ctx: AccessorContext, id: string): ActivitiElementTemplate => {
  const template = buildTemplates(ctx.catalog.connectors).find((t) => t.id === id);
  if (!template) throw new AccessorError('UNKNOWN_TEMPLATE', 'template.apply', `there is no template "${id}": its connector or action is not in the project's connectors/ folder`);
  return template;
};

const templateId: PropertyAccessor<{ id: string }> = {
  key: 'template.apply',
  group: 'Template',
  label: 'Apply a template',
  writes: 'xml',
  appliesTo: templatable,
  get: (_c, el) => ({ id: templateLinkOf(bo(el))?.id ?? '' }),
  set: (ctx, el, value) => {
    if (!value || typeof value.id !== 'string' || value.id === '') throw new AccessorError('INVALID_VALUE', 'template.apply', 'give the id of the template: <connector>.<ACTION> or builtin/<kind>');
    apply(ctx, el, findTemplate(ctx, value.id), 'apply');
  },
};

const templateUnlink: PropertyAccessor<boolean> = {
  key: 'template.unlink',
  group: 'Template',
  label: 'Unlink the template',
  writes: 'xml',
  appliesTo: templatable,
  get: () => false,
  set: (ctx, el, value) => {
    if (value !== true || !templateLinkOf(bo(el))) return;
    ctx.modeling.updateProperties(el, { [TEMPLATE_ID_ATTRIBUTE]: undefined, [TEMPLATE_VERSION_ATTRIBUTE]: undefined });
  },
};

const templateUpdate: PropertyAccessor<boolean> = {
  key: 'template.update',
  group: 'Template',
  label: 'Update to the latest version of the template',
  writes: 'xml',
  appliesTo: (el) => templatable(el) && templateLinkOf(bo(el)) !== undefined,
  get: (ctx, el) => templateInfoOf(ctx, el)?.state === 'outdated',
  set: (ctx, el, value) => {
    if (value !== true) return;
    const link = templateLinkOf(bo(el))!;
    const template = buildTemplates(ctx.catalog.connectors).find((t) => t.id === link.id);
    if (!template) throw new AccessorError('TEMPLATE_GONE', 'template.update', `the template ${link.id} is no longer defined: its connector or action was removed from the project`);
    apply(ctx, el, template, 'update');
  },
};

const templateInfo: PropertyAccessor<TemplateInfo | undefined> = {
  key: 'template.info',
  group: 'Template',
  label: 'Template of the task',
  writes: 'xml',
  appliesTo: templatable,
  get: (ctx, el) => templateInfoOf(ctx, el),
  set: (ctx, el, value) => {
    if (JSON.stringify(value) !== JSON.stringify(templateInfoOf(ctx, el))) throw new AccessorError('READ_ONLY', 'template.info', 'the template link is changed with template.apply, template.update and template.unlink');
  },
};

export const templateAccessors: AnyAccessor[] = [templateId, templateUnlink, templateUpdate, templateInfo];
