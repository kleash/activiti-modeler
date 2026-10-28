import type { ConnectorAction, ConnectorModel } from '@activiti-modeler/activiti-project';

import type { ModdleElement } from '../../types';

/**
 * Element templates of the modeler (feature U15, FEATURE_MATRIX §F): one per action of every connector of the project, plus
 * the built-in service task kinds. They are generated, never written by hand: the catalog (`connectors/*.json`) is the source.
 *
 * A task created from a template records the link in two attributes, `activiti:templateId` and `activiti:templateVersion`.
 * Lint rule L36 (`connector-template-outdated`) reads the second one and compares it with the `version` of the connector file.
 */
export const TEMPLATE_ID_ATTRIBUTE = 'activiti:templateId';
export const TEMPLATE_VERSION_ATTRIBUTE = 'activiti:templateVersion';
export const BUILTIN_PREFIX = 'builtin/';

export type TemplateKind = 'connector' | 'mail' | 'shell' | 'decision' | 'class' | 'expression' | 'delegateExpression';

export interface ActivitiElementTemplate {
  /** `<connector>.<ACTION>` for a connector action, `builtin/<kind>` for a built-in kind. */
  id: string;
  version: string;
  name: string;
  description?: string;
  keywords: string[];
  category: { id: string; name: string };
  /** `contents` is a data URI the chooser shows. */
  icon: { contents: string };
  kind: TemplateKind;
  /** The element types the template can be applied to. */
  appliesTo: string[];
  /** Connector templates: the action the task calls. */
  connector?: { name: string; action: ConnectorAction };
}

const svg = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;

/** Chooser icons by kind. */
export const TEMPLATE_ICONS: Record<TemplateKind, string> = {
  connector: svg('<path d="M8 3v5M16 3v5M5 8h14v3a7 7 0 0 1-14 0zM12 18v3"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 6l9 7 9-7"/>'),
  shell: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7 9l4 3-4 3M13 16h4"/>'),
  decision: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>'),
  class: svg('<path d="M9 4C6 4 7 8 5 12c2 4 1 8 4 8M15 4c3 0 2 4 4 8-2 4-1 8-4 8"/>'),
  expression: svg('<path d="M4 18c3 0 3-12 6-12M4 12h7M13 10l7 8M20 10l-7 8"/>'),
  delegateExpression: svg('<path d="M7 5H5v14h2M17 5h2v14h-2M10 9l4 6M14 9l-4 6"/>'),
};

const BUILTIN_KINDS: Array<{ kind: Exclude<TemplateKind, 'connector'>; name: string; description: string; appliesTo: string[] }> = [
  { kind: 'mail', name: 'Mail', description: 'Sends an e-mail with the engine\'s mail server (activiti:type="mail"). Fill in the mail fields.', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask', 'bpmn:SendTask'] },
  { kind: 'shell', name: 'Shell', description: 'Runs a command on the engine\'s host (activiti:type="shell"). Needs a shell-enabled host.', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'] },
  { kind: 'decision', name: 'Decision task', description: 'Evaluates a DMN decision of the project through dmn-connector.EXECUTE_TABLE.', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'] },
  { kind: 'class', name: 'Java class', description: 'Calls a JavaDelegate class (activiti:class), with field injection.', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'] },
  { kind: 'expression', name: 'Expression', description: 'Evaluates a JUEL expression (activiti:expression) and can store the result.', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'] },
  { kind: 'delegateExpression', name: 'Delegate expression', description: 'Calls the delegate bean an expression names (activiti:delegateExpression).', appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'] },
];

export const BUILTIN_VERSION = '1';

export function builtinTemplates(): ActivitiElementTemplate[] {
  return BUILTIN_KINDS.map((b) => ({
    id: `${BUILTIN_PREFIX}${b.kind}`,
    version: BUILTIN_VERSION,
    name: b.name,
    description: b.description,
    keywords: [b.kind, b.name.toLowerCase()],
    category: { id: 'builtin', name: 'Service tasks' },
    icon: { contents: TEMPLATE_ICONS[b.kind] },
    kind: b.kind,
    appliesTo: b.appliesTo,
  }));
}

/** The version a template of this connector has: its `version`, `1` when the file has none. */
export const connectorVersion = (connector: ConnectorModel): string => connector.version ?? '1';

export function connectorTemplates(connectors: readonly ConnectorModel[]): ActivitiElementTemplate[] {
  return connectors.flatMap((connector) =>
    Object.values(connector.actions).map((action): ActivitiElementTemplate => {
      const description = action.description ?? connector.description;
      return {
        id: `${connector.name}.${action.id}`,
        version: connectorVersion(connector),
        name: `${connector.name}: ${action.name || action.id}`,
        ...(description ? { description } : {}),
        keywords: [...new Set([connector.name, action.id, action.name, ...(description ?? '').split(/\W+/).filter((w) => w.length > 3)].filter(Boolean))],
        category: { id: 'connectors', name: 'Connectors' },
        icon: { contents: TEMPLATE_ICONS.connector },
        kind: 'connector',
        appliesTo: ['bpmn:Task', 'bpmn:ServiceTask'],
        connector: { name: connector.name, action },
      };
    }),
  );
}

/** Built-ins first, then one template per connector action. */
export function buildTemplates(connectors: readonly ConnectorModel[]): ActivitiElementTemplate[] {
  return [...builtinTemplates(), ...connectorTemplates(connectors)];
}

/** The icon kind of a task linked to the template `id` (what the renderer draws); undefined for an id it does not know the kind of. */
export function templateIconKind(id: string | undefined): TemplateKind | undefined {
  if (!id) return undefined;
  if (id.startsWith(BUILTIN_PREFIX)) {
    const kind = id.slice(BUILTIN_PREFIX.length);
    return BUILTIN_KINDS.some((b) => b.kind === kind) ? (kind as TemplateKind) : undefined;
  }
  return 'connector';
}

/** Reads one of the link attributes from a business object (they are extension attributes of the moddle, so they live in `$attrs`). */
export function templateAttr(bo: ModdleElement, attribute: typeof TEMPLATE_ID_ATTRIBUTE | typeof TEMPLATE_VERSION_ATTRIBUTE): string | undefined {
  const attrs = (bo.$attrs ?? {}) as Record<string, unknown>;
  const value = attrs[attribute] ?? bo.get?.(attribute);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export interface TemplateLink {
  id: string;
  version: string;
}

export function templateLinkOf(bo: ModdleElement | undefined): TemplateLink | undefined {
  if (!bo) return undefined;
  const id = templateAttr(bo, TEMPLATE_ID_ATTRIBUTE);
  if (!id) return undefined;
  return { id, version: templateAttr(bo, TEMPLATE_VERSION_ATTRIBUTE) ?? '1' };
}
