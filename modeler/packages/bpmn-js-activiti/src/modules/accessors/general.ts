import { VARIABLE_TYPES, type ProcessVariableDefinition } from '@activiti-modeler/activiti-project';

import { type DiagramElement, type ModdleElement, is } from '../../types';
import { assertNcName, assertString, bo, createModdle, definitionsOf, extensionsOfType, formalExpression, orUndefined, processIdFor, replaceExtensions, stringAttr } from './helpers';
import { AccessorError, type AnyAccessor, type PropertyAccessor } from './types';

const hasName = (element: DiagramElement): boolean => bo(element).$descriptor.propertiesByName['name'] !== undefined && !is(element, 'bpmn:Definitions');

const generalName: PropertyAccessor<string | undefined> = {
  key: 'general.name',
  group: 'General',
  label: 'Name',
  writes: 'xml',
  appliesTo: hasName,
  get: (_c, el) => bo(el).get('name') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('general.name', value);
    ctx.modeling.updateProperties(el, { name: orUndefined(value) });
  },
};

const generalId: PropertyAccessor<string> = {
  key: 'general.id',
  group: 'General',
  label: 'ID',
  writes: 'xml',
  appliesTo: (el) => bo(el).$descriptor.propertiesByName['id'] !== undefined && !el.labelTarget,
  get: (_c, el) => bo(el).id as string,
  set: (ctx, el, value) => {
    assertString('general.id', value);
    assertNcName('general.id', value);
    if (value === bo(el).id) return;
    if (ctx.moddle.ids.assigned(value)) throw new AccessorError('DUPLICATE_ID', 'general.id', `id "${value}" is already used`);
    // renames the extensions keys through the ExtensionsBehavior, in the same undo step
    ctx.modeling.updateProperties(el, { id: value });
  },
};

const executable: PropertyAccessor<boolean> = {
  key: 'general.executable',
  group: 'General',
  label: 'Executable',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:Process'),
  get: (_c, el) => bo(el).get('isExecutable') === true,
  set: (_c, _el, value) => {
    // Activiti skips processes that are not executable, so the modeler keeps the flag true (ADR 0003)
    if (value !== true) throw new AccessorError('READ_ONLY', 'general.executable', 'isExecutable is forced to true: Activiti skips processes that are not executable');
  },
};

const targetNamespace: PropertyAccessor<string | undefined> = {
  key: 'general.targetNamespace',
  group: 'General',
  label: 'Target namespace',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:Process') || is(el, 'bpmn:Collaboration'),
  get: (_c, el) => definitionsOf(el).get('targetNamespace') as string | undefined,
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('general.targetNamespace', value);
    if ((value ?? '').length > 255) throw new AccessorError('TOO_LONG', 'general.targetNamespace', 'targetNamespace is limited to 255 characters');
    ctx.modeling.updateModdleProperties(el, definitionsOf(el), { targetNamespace: value || undefined });
  },
};

const documentation: PropertyAccessor<string | undefined> = {
  key: 'documentation.text',
  group: 'Documentation',
  label: 'Documentation',
  writes: 'xml',
  appliesTo: (el) => bo(el).$descriptor.propertiesByName['documentation'] !== undefined && !el.labelTarget,
  get: (_c, el) => {
    const docs = (bo(el).get('documentation') as ModdleElement[] | undefined) ?? [];
    return docs[0]?.get('text') as string | undefined;
  },
  set: (ctx, el, value) => {
    if (value !== undefined) assertString('documentation.text', value);
    if (is(el, 'bpmn:Process') && (value ?? '').length > 2000) throw new AccessorError('TOO_LONG', 'documentation.text', 'process documentation is limited to 2000 characters (it becomes the description)');
    const docs = (bo(el).get('documentation') as ModdleElement[] | undefined) ?? [];
    if (!value) {
      if (docs.length > 0) ctx.modeling.updateProperties(el, { documentation: [] });
      return;
    }
    if (docs[0]) ctx.modeling.updateModdleProperties(el, docs[0], { text: value });
    else ctx.modeling.updateProperties(el, { documentation: [createModdle(ctx, 'bpmn:Documentation', { text: value })] });
  },
};

// --- candidate starters --------------------------------------------------------------------------------------------

const starterUsers = stringAttr({ key: 'starters.users', group: 'Candidate starters', attr: 'activiti:candidateStarterUsers', appliesTo: ['bpmn:Process'], label: 'Candidate starter users' });
const starterGroups = stringAttr({ key: 'starters.groups', group: 'Candidate starters', attr: 'activiti:candidateStarterGroups', appliesTo: ['bpmn:Process'], label: 'Candidate starter groups' });

/** `user(a), group(b)` text of a resourceAssignmentExpression. */
export function resourceExpressionText(resource: ModdleElement | undefined): string | undefined {
  const assignment = resource?.get('resourceAssignmentExpression') as ModdleElement | undefined;
  const expression = assignment?.get('formalExpression') as ModdleElement | undefined;
  return expression?.get('body') as string | undefined;
}

export function createResourceAssignment(ctx: Parameters<typeof formalExpression>[0], text: string): ModdleElement {
  return createModdle(ctx, 'bpmn:ResourceAssignmentExpression', { formalExpression: formalExpression(ctx, text) });
}

const potentialStarter: PropertyAccessor<string | undefined> = {
  key: 'starters.potential',
  group: 'Candidate starters',
  label: 'Potential starter expression',
  writes: 'xml',
  appliesTo: (el) => is(el, 'bpmn:Process'),
  get: (_c, el) => resourceExpressionText(extensionsOfType(bo(el), 'activiti:PotentialStarter')[0]),
  set: (ctx, el, value) => {
    const items = value ? [createModdle(ctx, 'activiti:PotentialStarter', { resourceAssignmentExpression: createResourceAssignment(ctx, value) })] : [];
    replaceExtensions(ctx, el, bo(el), (v) => v.$type === 'activiti:PotentialStarter', items);
  },
};

// --- process variables (extensions JSON) ---------------------------------------------------------------------------

export type VariableInput = Partial<ProcessVariableDefinition> & { name: string; type: string };

const DEFAULT_CHECKS: Record<string, (value: unknown) => boolean> = {
  boolean: (v) => typeof v === 'boolean' || isExpression(v),
  string: (v) => typeof v === 'string',
  integer: (v) => (typeof v === 'number' && Number.isInteger(v)) || isExpression(v),
  bigdecimal: (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) || isExpression(v),
  // the engine's DateFormatterProvider parses ISO dates and date-times (finding C15.1); an expression is resolved at start
  date: (v) => (typeof v === 'string' && ISO_DATE.test(v)) || isExpression(v),
  datetime: (v) => (typeof v === 'string' && ISO_DATE.test(v)) || isExpression(v),
  array: (v) => Array.isArray(v) || isExpression(v),
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isExpression = (v: unknown): boolean => typeof v === 'string' && /\$\{[^}]*\}/.test(v);

/** Throws for a definition the engine would reject or silently mishandle (unknown type + default -> NullPointerException, R1 §0.3-21). */
export function validateVariable(key: string, variable: VariableInput): void {
  if (!variable.name || typeof variable.name !== 'string') throw new AccessorError('INVALID_VARIABLE', key, 'a process variable needs a name');
  if (!VARIABLE_TYPES.includes(variable.type as never)) {
    throw new AccessorError('INVALID_VARIABLE_TYPE', key, `variable "${variable.name}": type "${variable.type}" is not one of ${VARIABLE_TYPES.join(', ')}`);
  }
  if (variable.value !== undefined && variable.value !== null && variable.value !== '') {
    const check = DEFAULT_CHECKS[variable.type];
    if (check && !check(variable.value)) {
      throw new AccessorError('INVALID_VARIABLE_DEFAULT', key, `variable "${variable.name}": default ${JSON.stringify(variable.value)} does not fit type ${variable.type}`);
    }
  }
}

const variablesList: PropertyAccessor<ProcessVariableDefinition[]> = {
  key: 'variables.list',
  group: 'Process variables',
  label: 'Process variables',
  writes: 'ext',
  appliesTo: (el) => !el.labelTarget && !!el.businessObject && (is(el, 'bpmn:Process') || is(el, 'bpmn:Participant')),
  get: (ctx, el) => Object.values(ctx.store.getProcess(processIdFor('variables.list', el))?.properties ?? {}).map((p) => structuredClone(p)),
  set: (ctx, el, value) => {
    const processId = processIdFor('variables.list', el);
    const names = new Set<string>();
    for (const variable of value) {
      validateVariable('variables.list', variable);
      if (names.has(variable.name)) throw new AccessorError('DUPLICATE_VARIABLE', 'variables.list', `variable "${variable.name}" is declared twice`);
      names.add(variable.name);
    }
    const previous = ctx.store.getProcess(processId)?.properties ?? {};
    const byName = new Map(Object.values(previous).map((p) => [p.name, p]));
    ctx.store.update('set process variables', (file, mctx) => {
      const ext = (file.extensions[processId] ??= { properties: {}, mappings: {}, constants: {} });
      const next: Record<string, ProcessVariableDefinition> = {};
      for (const variable of value) {
        // keep the id and unknown fields of a variable that stays
        const existing = byName.get(variable.name);
        const id = variable.id ?? existing?.id ?? mctx.newId();
        next[id] = { required: false, ...existing, ...variable, id } as ProcessVariableDefinition;
      }
      ext.properties = next;
    });
  },
};

export interface VariableUse {
  /** The element whose mapping or constants use the variable. */
  elementId: string;
  /** `output`: the variable is the target of an output mapping (the engine drops the output when it is not declared); `input`: a VARIABLE input reads it. */
  as: 'output' | 'input';
}

/** Read only: where each declared variable is used by a mapping of the process, by variable name. */
const variablesUsage: PropertyAccessor<Record<string, VariableUse[]>> = {
  key: 'variables.usage',
  group: 'Process variables',
  label: 'Use of the process variables in mappings',
  writes: 'ext',
  appliesTo: (el) => !el.labelTarget && !!el.businessObject && (is(el, 'bpmn:Process') || is(el, 'bpmn:Participant')),
  get: (ctx, el) => {
    const usage: Record<string, VariableUse[]> = {};
    const ext = ctx.store.getProcess(processIdFor('variables.usage', el));
    for (const [elementId, mapping] of Object.entries(ext?.mappings ?? {})) {
      for (const target of Object.keys(mapping.outputs ?? {})) (usage[target] ??= []).push({ elementId, as: 'output' });
      for (const input of Object.values(mapping.inputs ?? {})) {
        if (String(input.type).toUpperCase() === 'VARIABLE' && typeof input.value === 'string') (usage[input.value] ??= []).push({ elementId, as: 'input' });
      }
    }
    return usage;
  },
  set: (ctx, el, value) => {
    if (JSON.stringify(value) !== JSON.stringify(variablesUsage.get(ctx, el))) throw new AccessorError('READ_ONLY', 'variables.usage', 'the use of a variable is derived from the mappings; change the mappings instead');
  },
};

export const generalAccessors: AnyAccessor[] = [generalName, generalId, executable, targetNamespace, documentation, starterUsers, starterGroups, potentialStarter, variablesList, variablesUsage];
