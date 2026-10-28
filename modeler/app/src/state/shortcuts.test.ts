import { describe, expect, it } from 'vitest';

import { findAppShortcut, formatCombo, type KeyEventLike, matchCombo, parseCombo, SHORTCUTS, shortcutLabel } from './shortcuts';

const ev = (init: Partial<KeyEventLike> & { key: string }): KeyEventLike => ({ code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init });

describe('matchCombo', () => {
  it('uses Ctrl on Linux and Windows and Cmd on a Mac', () => {
    expect(matchCombo(ev({ key: 's', ctrlKey: true }), 'Mod+S', false)).toBe(true);
    expect(matchCombo(ev({ key: 's', metaKey: true }), 'Mod+S', false)).toBe(false);
    expect(matchCombo(ev({ key: 's', metaKey: true }), 'Mod+S', true)).toBe(true);
    expect(matchCombo(ev({ key: 's', ctrlKey: true }), 'Mod+S', true)).toBe(false);
  });

  it('requires exactly the listed modifiers', () => {
    expect(matchCombo(ev({ key: 'S', ctrlKey: true, shiftKey: true }), 'Mod+S', false)).toBe(false);
    expect(matchCombo(ev({ key: 'S', ctrlKey: true, shiftKey: true }), 'Mod+Shift+S', false)).toBe(true);
    expect(matchCombo(ev({ key: 's', ctrlKey: true, altKey: true }), 'Mod+Alt+S', false)).toBe(true);
    expect(matchCombo(ev({ key: 's' }), 'Mod+S', false)).toBe(false);
  });

  it('falls back to the physical key when the layout types another character', () => {
    // Cyrillic layout: Ctrl+physical S types "ы"
    expect(matchCombo(ev({ key: 'ы', code: 'KeyS', ctrlKey: true }), 'Mod+S', false)).toBe(true);
    // Option+S on a Mac types "ß"
    expect(matchCombo(ev({ key: 'ß', code: 'KeyS', metaKey: true, altKey: true }), 'Mod+Alt+S', true)).toBe(true);
    // a Latin layout whose physical S key types another letter (Dvorak: "o") must not trigger Save
    expect(matchCombo(ev({ key: 'o', code: 'KeyS', ctrlKey: true }), 'Mod+S', false)).toBe(false);
  });

  it('matches digits, zoom keys, tab and named keys', () => {
    expect(matchCombo(ev({ key: '1', ctrlKey: true }), 'Mod+1', false)).toBe(true);
    expect(matchCombo(ev({ key: '&', code: 'Digit1', ctrlKey: true }), 'Mod+1', false)).toBe(true);
    expect(matchCombo(ev({ key: '=', ctrlKey: true }), 'Mod+=', false)).toBe(true);
    expect(matchCombo(ev({ key: '+', ctrlKey: true, shiftKey: true }), 'Mod+=', false)).toBe(true);
    expect(matchCombo(ev({ key: '-', ctrlKey: true }), 'Mod+-', false)).toBe(true);
    expect(matchCombo(ev({ key: 'Tab', ctrlKey: true }), 'Ctrl+Tab', true)).toBe(true);
    expect(matchCombo(ev({ key: 'Tab', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Tab', false)).toBe(true);
    expect(matchCombo(ev({ key: 'Tab', ctrlKey: true, shiftKey: true }), 'Ctrl+Tab', false)).toBe(false);
  });
});

describe('the shortcut table', () => {
  it('has the file shortcuts of the Camunda Modeler table (R3 §1.3)', () => {
    const keys = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys;
    expect(keys('save')).toEqual(['Mod+S']);
    expect(keys('saveAs')).toEqual(['Mod+Shift+S']);
    expect(keys('saveAll')).toEqual(['Mod+Alt+S']);
    expect(keys('closeTab')).toEqual(['Mod+W']);
    expect(keys('reopenClosed')).toEqual(['Mod+Shift+T']);
    expect(keys('nextTab')).toEqual(['Ctrl+Tab']);
    expect(keys('prevTab')).toEqual(['Ctrl+Shift+Tab']);
    expect(keys('toggleProperties')).toEqual(['Mod+P']);
    expect(keys('toggleBottom')).toEqual(['Mod+B']);
    expect(keys('moveToOrigin')).toEqual(['Mod+Shift+O']);
    expect(keys('redo')).toEqual(['Mod+Y', 'Mod+Shift+Z']);
  });

  it('has no two app shortcuts on the same key', () => {
    const seen = new Map<string, string>();
    for (const def of SHORTCUTS.filter((s) => s.scope === 'app')) {
      for (const key of def.keys) {
        expect(seen.get(key), `${key} used by ${seen.get(key)} and ${def.id}`).toBeUndefined();
        seen.set(key, def.id);
      }
    }
  });

  it('finds the app shortcut of an event', () => {
    expect(findAppShortcut(ev({ key: 'T', ctrlKey: true, shiftKey: true }), false)?.id).toBe('reopenClosed');
    expect(findAppShortcut(ev({ key: 'z', ctrlKey: true }), false)).toBeUndefined();
  });

  it('formats for the platform', () => {
    expect(formatCombo('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatCombo('Mod+Shift+S', true)).toBe('⇧⌘S');
    expect(formatCombo('Ctrl+Tab', true)).toBe('⌃Tab');
    expect(shortcutLabel('save', false)).toBe('Ctrl+S');
    expect(parseCombo('Mod+=')).toMatchObject({ mod: true, key: '=' });
  });
});
