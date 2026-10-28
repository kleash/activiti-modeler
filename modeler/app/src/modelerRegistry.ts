import type { ExportableModeler, ImportableModeler } from '@activiti-modeler/bpmn-js-activiti';

/** The modeler instance of the mounted editor, for code outside React (the test API). */
export type ActiveModeler = ExportableModeler & ImportableModeler;

let active: ActiveModeler | undefined;
let waiting: Array<(modeler: ActiveModeler) => void> = [];
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: the panel slot of the shell follows the modeler of the visible tab. */
export function subscribeActiveModeler(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getActiveModeler = (): ActiveModeler | undefined => active;

export function setActiveModeler(modeler: ActiveModeler | undefined): void {
  const changed = active !== modeler;
  active = modeler;
  if (changed) for (const listener of [...listeners]) listener();
  if (modeler) {
    for (const resolve of waiting) resolve(modeler);
    waiting = [];
  }
}

/** Resolves with the modeler as soon as an editor is mounted. */
export function whenModelerReady(): Promise<ActiveModeler> {
  if (active) return Promise.resolve(active);
  return new Promise((resolve) => waiting.push(resolve));
}
