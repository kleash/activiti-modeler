import { ListGroup } from '@bpmn-io/properties-panel';

import type { Definition } from '../builders';
import { helpTooltip } from '../help';

export interface ListItemSpec {
  /** Entry id of the item (`definitions.messages[0]`); the ids of its entries continue it. */
  id: string;
  label: string;
  entries: Definition[];
  remove?: () => void;
  /** The entry that gets the focus when the item has just been added. */
  autoFocusEntry?: string;
}

/** A group whose content is a list of collapsible items with add and remove (the list groups of the panel). */
export function listGroup(spec: { id: string; label: string; items: ListItemSpec[]; add?: () => void }): Definition {
  return {
    id: spec.id,
    label: spec.label,
    component: ListGroup,
    items: spec.items.map((item) => ({ ...item, autoFocusEntry: item.autoFocusEntry ?? item.entries[0]?.id })),
    add: spec.add,
    tooltip: helpTooltip(spec.id),
    shouldSort: undefined,
  };
}

/** `message`, `message2`, ... : a name that is not taken yet. */
export function uniqueName(base: string, taken: readonly (string | undefined)[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/** Moves the item at `index` by `delta` places (the list is returned as a copy). */
export function moved<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = list.slice();
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item as T);
  return next;
}
