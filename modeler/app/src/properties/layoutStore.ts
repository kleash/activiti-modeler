/** Which groups of the properties panel are open, kept in this browser (a per-viewer convenience; the panel works without it). */

export const PANEL_LAYOUT_KEY = 'activiti-modeler.properties-layout.v1';

export interface PanelLayout {
  groups?: Record<string, { open?: boolean }>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | undefined {
  try {
    const s = window.localStorage;
    s.getItem('__probe__');
    return s;
  } catch {
    return undefined;
  }
}

/** Keeps only the open flags of groups; anything else in the stored text is dropped. */
export function sanitizePanelLayout(raw: unknown): PanelLayout {
  const groups: Record<string, { open?: boolean }> = {};
  const source = (typeof raw === 'object' && raw !== null ? (raw as { groups?: unknown }).groups : undefined) as Record<string, unknown> | undefined;
  for (const [id, value] of Object.entries(source ?? {})) {
    const open = typeof value === 'object' && value !== null ? (value as { open?: unknown }).open : undefined;
    if (typeof open === 'boolean') groups[id] = { open };
  }
  return { groups };
}

export function loadPanelLayout(store: StorageLike | undefined = storage()): PanelLayout {
  try {
    const text = store?.getItem(PANEL_LAYOUT_KEY);
    return text ? sanitizePanelLayout(JSON.parse(text)) : { groups: {} };
  } catch {
    return { groups: {} };
  }
}

export function savePanelLayout(layout: unknown, store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(PANEL_LAYOUT_KEY, JSON.stringify(sanitizePanelLayout(layout)));
  } catch {
    // a full or blocked store only loses the open/closed state
  }
}
