/**
 * The editor plug-in point of the tab system: an editor is registered per kind of file, and a tab opens the registered editor
 * with the highest priority for its path. The dmn-js editor is registered for `*.dmn` with a higher priority than
 * the raw XML editor registered here, without touching the shell.
 */
import type { EditorDescriptor } from './types';

const editors = new Map<string, EditorDescriptor>();

export function registerEditor(descriptor: EditorDescriptor): void {
  editors.set(descriptor.id, descriptor);
}

export function unregisterEditor(id: string): void {
  editors.delete(id);
}

export function getEditor(id: string): EditorDescriptor | undefined {
  return editors.get(id);
}

/** The editor to open `path` with. */
export function editorFor(path: string): EditorDescriptor | undefined {
  let best: { descriptor: EditorDescriptor; priority: number } | undefined;
  for (const descriptor of editors.values()) {
    const priority = descriptor.accepts(path);
    if (priority !== false && (!best || priority > best.priority)) best = { descriptor, priority };
  }
  return best?.descriptor;
}

export function registeredEditors(): EditorDescriptor[] {
  return [...editors.values()];
}
