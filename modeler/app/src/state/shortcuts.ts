/**
 * The keyboard shortcut table (docs/user-guide/modeler-basics.md, "Keyboard shortcuts") and the matcher the shell uses.
 * `Mod` is Cmd on macOS and Ctrl elsewhere. Letters match the typed character first and fall back to the physical key
 * (`event.code`) when the layout types something else (non-Latin layouts, Option on macOS).
 */

export type ShortcutGroup = 'File' | 'Edit' | 'Tools' | 'View' | 'Navigation';

export interface ShortcutDef {
  /** The command id (see actions.ts) for shortcuts handled by the shell; the bpmn-js action name for `canvas` ones. */
  id: string;
  group: ShortcutGroup;
  label: string;
  /** Alternatives, e.g. `['Mod+Y', 'Mod+Shift+Z']`. */
  keys: string[];
  /** `app`: handled by the shell everywhere. `canvas`: handled by bpmn-js while the canvas has the focus. */
  scope: 'app' | 'canvas';
  /** Still works while a text field or code editor has the focus. */
  inInputs?: boolean;
  /** Browsers keep these for themselves in a normal tab; they work in an installed app window. */
  browserReserved?: boolean;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'newFile', group: 'File', label: 'New file', keys: ['Mod+N'], scope: 'app', inInputs: true, browserReserved: true },
  { id: 'openProject', group: 'File', label: 'Open project', keys: ['Mod+O'], scope: 'app', inInputs: true },
  { id: 'save', group: 'File', label: 'Save', keys: ['Mod+S'], scope: 'app', inInputs: true },
  { id: 'saveAs', group: 'File', label: 'Save as', keys: ['Mod+Shift+S'], scope: 'app', inInputs: true },
  { id: 'saveAll', group: 'File', label: 'Save all', keys: ['Mod+Alt+S'], scope: 'app', inInputs: true },
  { id: 'closeTab', group: 'File', label: 'Close tab', keys: ['Mod+W'], scope: 'app', inInputs: true, browserReserved: true },
  { id: 'reopenClosed', group: 'File', label: 'Reopen last closed tab', keys: ['Mod+Shift+T'], scope: 'app', inInputs: true, browserReserved: true },
  { id: 'openSettings', group: 'File', label: 'Settings', keys: ['Mod+,'], scope: 'app', inInputs: true },
  { id: 'exportImage', group: 'File', label: 'Export as image', keys: ['Mod+Shift+E'], scope: 'app' },
  { id: 'nextTab', group: 'Navigation', label: 'Next tab', keys: ['Ctrl+Tab'], scope: 'app', inInputs: true, browserReserved: true },
  { id: 'prevTab', group: 'Navigation', label: 'Previous tab', keys: ['Ctrl+Shift+Tab'], scope: 'app', inInputs: true, browserReserved: true },

  { id: 'undo', group: 'Edit', label: 'Undo', keys: ['Mod+Z'], scope: 'canvas' },
  { id: 'redo', group: 'Edit', label: 'Redo', keys: ['Mod+Y', 'Mod+Shift+Z'], scope: 'canvas' },
  { id: 'cut', group: 'Edit', label: 'Cut', keys: ['Mod+X'], scope: 'canvas' },
  { id: 'copy', group: 'Edit', label: 'Copy', keys: ['Mod+C'], scope: 'canvas' },
  { id: 'paste', group: 'Edit', label: 'Paste', keys: ['Mod+V'], scope: 'canvas' },
  { id: 'duplicate', group: 'Edit', label: 'Duplicate', keys: ['Mod+D'], scope: 'canvas' },
  { id: 'copyAsImage', group: 'Edit', label: 'Copy selection as image', keys: ['Mod+Shift+C'], scope: 'canvas' },
  { id: 'selectAll', group: 'Edit', label: 'Select all', keys: ['Mod+A'], scope: 'canvas' },
  { id: 'removeSelection', group: 'Edit', label: 'Delete selection', keys: ['Delete', 'Backspace'], scope: 'canvas' },
  { id: 'find', group: 'Edit', label: 'Find element', keys: ['Mod+F'], scope: 'canvas' },

  { id: 'handTool', group: 'Tools', label: 'Hand tool', keys: ['H'], scope: 'canvas' },
  { id: 'lassoTool', group: 'Tools', label: 'Lasso tool', keys: ['L'], scope: 'canvas' },
  { id: 'spaceTool', group: 'Tools', label: 'Space tool', keys: ['S'], scope: 'canvas' },
  { id: 'globalConnectTool', group: 'Tools', label: 'Global connect tool', keys: ['C'], scope: 'canvas' },
  { id: 'directEditing', group: 'Tools', label: 'Edit label', keys: ['E'], scope: 'canvas' },
  { id: 'replaceElement', group: 'Tools', label: 'Replace element', keys: ['R'], scope: 'canvas' },
  { id: 'createElement', group: 'Tools', label: 'Create element (menu)', keys: ['N'], scope: 'canvas' },
  { id: 'appendElement', group: 'Tools', label: 'Append element (menu)', keys: ['A'], scope: 'canvas' },

  { id: 'zoomIn', group: 'View', label: 'Zoom in', keys: ['Mod+='], scope: 'app' },
  { id: 'zoomOut', group: 'View', label: 'Zoom out', keys: ['Mod+-'], scope: 'app' },
  { id: 'zoomActual', group: 'View', label: 'Actual size', keys: ['Mod+0'], scope: 'app' },
  { id: 'zoomFit', group: 'View', label: 'Fit diagram', keys: ['Mod+1'], scope: 'app' },
  { id: 'toggleProperties', group: 'View', label: 'Toggle properties panel', keys: ['Mod+P'], scope: 'app', inInputs: true },
  { id: 'resetProperties', group: 'View', label: 'Reset properties panel', keys: ['Mod+Alt+P'], scope: 'app', inInputs: true },
  { id: 'toggleBottom', group: 'View', label: 'Toggle bottom panel', keys: ['Mod+B'], scope: 'app', inInputs: true },
  { id: 'moveToOrigin', group: 'View', label: 'Move diagram to origin', keys: ['Mod+Shift+O'], scope: 'app' },

  { id: 'moveSelection', group: 'Navigation', label: 'Move selection (Shift: faster)', keys: ['Arrows'], scope: 'canvas' },
  { id: 'moveCanvas', group: 'Navigation', label: 'Move canvas (Shift: faster)', keys: ['Mod+Arrows'], scope: 'canvas' },
  { id: 'handToolHold', group: 'Navigation', label: 'Hold to pan', keys: ['Space'], scope: 'canvas' },
];

export interface ParsedCombo {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+');
  // a trailing "+" key ("Mod++") ends with an empty part
  const key = combo.endsWith('++') ? '+' : parts[parts.length - 1]!;
  const modifiers = new Set(combo.endsWith('++') ? parts.slice(0, -2) : parts.slice(0, -1));
  return { mod: modifiers.has('Mod'), ctrl: modifiers.has('Ctrl'), shift: modifiers.has('Shift'), alt: modifiers.has('Alt'), key };
}

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const ASCII_ALNUM = /^[A-Za-z0-9]$/;
const NAMED_KEYS: Record<string, string[]> = {
  '=': ['=', '+'],
  '-': ['-', '_', 'Subtract'],
  Tab: ['Tab'],
  Space: [' ', 'Space'],
};

function keyMatches(event: KeyEventLike, token: string): boolean {
  if (token.length === 1 && ASCII_ALNUM.test(token)) {
    if (event.key.length === 1 && ASCII_ALNUM.test(event.key)) return event.key.toLowerCase() === token.toLowerCase();
    // the layout typed something else (non-Latin, or Option on macOS): use the physical key
    return event.code === (/\d/.test(token) ? `Digit${token}` : `Key${token.toUpperCase()}`) || event.code === `Numpad${token}`;
  }
  const names = NAMED_KEYS[token];
  if (names) return names.includes(event.key) || event.code === token || (token === '=' && event.code === 'Equal') || (token === '-' && (event.code === 'Minus' || event.code === 'NumpadSubtract'));
  return event.key === token || event.code === token;
}

export function matchCombo(event: KeyEventLike, combo: string, isMac: boolean): boolean {
  const c = parseCombo(combo);
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherPressed = isMac ? event.ctrlKey : event.metaKey;
  if (c.mod) {
    if (!modPressed || otherPressed) return false;
  } else if (c.ctrl) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (event.ctrlKey || event.metaKey) {
    return false;
  }
  // "=" (zoom in) is typed with Shift on some layouts, which is not a deliberate modifier
  const shiftOk = c.shift === event.shiftKey || (c.key === '=' && event.key === '+');
  if (!shiftOk || c.alt !== event.altKey) return false;
  return keyMatches(event, c.key);
}

/** The app-scope shortcut that `event` triggers, if any. */
export function findAppShortcut(event: KeyEventLike, isMac: boolean): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.scope === 'app' && s.keys.some((k) => matchCombo(event, k, isMac)));
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };

/** `Mod+Shift+S` as shown to the user: `Ctrl+Shift+S`, or `⌘⇧S` on a Mac. */
export function formatCombo(combo: string, isMac: boolean): string {
  const c = parseCombo(combo);
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  if (isMac) return `${c.ctrl ? MAC_SYMBOLS['Ctrl'] : ''}${c.alt ? MAC_SYMBOLS['Alt'] : ''}${c.shift ? MAC_SYMBOLS['Shift'] : ''}${c.mod ? MAC_SYMBOLS['Mod'] : ''}${key}`;
  return [c.mod || c.ctrl ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

export function isMacPlatform(nav: { platform?: string; userAgent?: string } = typeof navigator === 'undefined' ? {} : navigator): boolean {
  return /Mac|iPhone|iPad/.test(nav.platform ?? nav.userAgent ?? '');
}

/** First shortcut of a command, formatted for the platform, for menus. */
export function shortcutLabel(id: string, isMac: boolean): string | undefined {
  const def = SHORTCUTS.find((s) => s.id === id);
  return def?.keys[0] ? formatCombo(def.keys[0], isMac) : undefined;
}
