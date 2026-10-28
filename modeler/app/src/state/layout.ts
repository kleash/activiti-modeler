/** Panel layout of the shell, kept in localStorage (feature U28 and the resizable panels of U19). */

export interface LayoutState {
  explorerOpen: boolean;
  explorerWidth: number;
  propertiesOpen: boolean;
  propertiesWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;
  minimapOpen: boolean;
  gridVisible: boolean;
}

export const LAYOUT_KEY = 'activiti-modeler.layout.v1';

export const LAYOUT_LIMITS = {
  explorerWidth: { min: 160, max: 520 },
  propertiesWidth: { min: 200, max: 640 },
  bottomHeight: { min: 100, max: 600 },
} as const;

export const DEFAULT_LAYOUT: LayoutState = {
  explorerOpen: true,
  explorerWidth: 250,
  propertiesOpen: true,
  propertiesWidth: 320,
  bottomOpen: false,
  bottomHeight: 220,
  minimapOpen: false,
  gridVisible: true,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, or undefined when the browser blocks it (private windows, cleared site data, previews). */
export function safeLocalStorage(): StorageLike | undefined {
  try {
    const storage = window.localStorage;
    storage.getItem('__probe__');
    return storage;
  } catch {
    return undefined;
  }
}

export const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Makes any parsed JSON into a valid layout: wrong types fall back to the default, sizes are clamped. */
export function sanitizeLayout(raw: unknown): LayoutState {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof LayoutState): boolean => (typeof source[key] === 'boolean' ? (source[key] as boolean) : (DEFAULT_LAYOUT[key] as boolean));
  const size = (key: keyof typeof LAYOUT_LIMITS): number => clampNumber(source[key], LAYOUT_LIMITS[key].min, LAYOUT_LIMITS[key].max, DEFAULT_LAYOUT[key]);
  return {
    explorerOpen: bool('explorerOpen'),
    explorerWidth: size('explorerWidth'),
    propertiesOpen: bool('propertiesOpen'),
    propertiesWidth: size('propertiesWidth'),
    bottomOpen: bool('bottomOpen'),
    bottomHeight: size('bottomHeight'),
    minimapOpen: bool('minimapOpen'),
    gridVisible: bool('gridVisible'),
  };
}

export function loadLayout(storage: StorageLike | undefined = safeLocalStorage()): LayoutState {
  try {
    const text = storage?.getItem(LAYOUT_KEY);
    return sanitizeLayout(text ? JSON.parse(text) : undefined);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(layout: LayoutState, storage: StorageLike | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // a full or blocked storage only costs the persistence
  }
}
