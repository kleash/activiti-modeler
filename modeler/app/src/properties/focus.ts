/**
 * Focusing a field of the panel on request of the Problems list (lint):
 *
 * ```ts
 * window.dispatchEvent(new CustomEvent('activiti.lint.focus', { detail: { elementId: 'task1', entryId: 'user.assignee' } }));
 * ```
 *
 * The app selects the element, shows the panel and its diagram, opens the groups around the entry and focuses it. The entry ids
 * are the accessor keys (`user.assignee`, `flow.condition`) and, inside lists, `<list key>[<index>].<field>`
 * (`listeners.execution[0].class`); see docs/developer-guide.md.
 */
export const LINT_FOCUS_EVENT = 'activiti.lint.focus';

export interface LintFocusDetail {
  elementId: string;
  /** The entry to focus; without one the element is only selected. */
  entryId?: string;
}

interface ModelerLike {
  get<T>(name: string): T;
}

interface Selection {
  select(element: unknown): void;
}

interface EventBus {
  fire(type: string, data?: Record<string, unknown>): unknown;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Entry ids the lint reports for a whole structured value; the panel has several entries for it. */
const ENTRY_ALIASES: Record<string, string> = {
  'timer.definition': 'timer.definition.value',
  'event.definition': 'message.ref',
};

/** The list entries of the panel: a lint entry id naming the whole list leads to its group. */
const LIST_GROUPS: Record<string, string> = {
  'definitions.messages': 'messages',
  'definitions.signals': 'signals',
  'definitions.errors': 'errors',
  'data.objects': 'dataObjects',
  'listeners.event': 'eventListeners',
  'listeners.execution': 'executionListeners',
  'listeners.task': 'taskListeners',
};

const quote = (id: string): string => id.replace(/"/g, '\\"');

/**
 * The entry a lint entry id leads to: the entry itself, the entry that stands for the structured value (`timer.definition`),
 * or the first entry below it (`listeners.execution` is the first item of the list, `mi` would be `mi.type`). Undefined when
 * the panel has none of them.
 */
export function resolveEntryId(container: ParentNode, entryId: string): string | undefined {
  const has = (id: string): boolean => container.querySelector(`[data-entry-id="${quote(id)}"]`) !== null;
  if (has(entryId)) return entryId;
  const alias = ENTRY_ALIASES[entryId];
  if (alias && has(alias)) return alias;
  const below = [...container.querySelectorAll('[data-entry-id]')]
    .map((node) => node.getAttribute('data-entry-id') ?? '')
    .find((id) => id.startsWith(`${entryId}.`) || id.startsWith(`${entryId}[`));
  return below;
}

/**
 * Selects the element and focuses the entry once the panel has drawn it (it renders a moment after the selection changes).
 * An id that names a whole list leads to the first item, or opens the group when the list is empty. Resolves with whether the
 * entry (or its group) was found.
 */
export async function focusPanelEntry(modeler: ModelerLike, detail: LintFocusDetail, container: ParentNode = document): Promise<boolean> {
  const registry = modeler.get<{ get(id: string): unknown }>('elementRegistry');
  const element = registry.get(detail.elementId);
  if (!element) return false;
  modeler.get<Selection>('selection').select(element);
  if (!detail.entryId) return true;
  const wanted = detail.entryId;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const id = resolveEntryId(container, wanted);
    if (id) {
      modeler.get<EventBus>('eventBus').fire('propertiesPanel.showEntry', { id, focus: true });
      return true;
    }
    const group = LIST_GROUPS[wanted];
    const header = group ? container.querySelector<HTMLElement>(`[data-group-id="group-${group}"] .bio-properties-panel-group-header`) : null;
    if (header) {
      if (!header.closest('.open')) header.click();
      return true;
    }
    await wait(50);
  }
  return false;
}
