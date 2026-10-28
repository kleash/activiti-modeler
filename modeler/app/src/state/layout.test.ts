import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT, LAYOUT_KEY, loadLayout, sanitizeLayout, saveLayout, type StorageLike } from './layout';

const memory = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
};

describe('layout persistence', () => {
  it('round-trips the layout', () => {
    const storage = memory();
    const layout = { ...DEFAULT_LAYOUT, bottomOpen: true, minimapOpen: true, explorerWidth: 300, propertiesOpen: false };
    saveLayout(layout, storage);
    expect(loadLayout(storage)).toEqual(layout);
  });

  it('falls back to the default for missing, corrupt or wrongly typed data', () => {
    expect(loadLayout(memory())).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(memory({ [LAYOUT_KEY]: '{not json' }))).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ bottomOpen: 'yes', explorerWidth: 'wide' })).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps sizes so a stored panel can never be unusable or cover the window', () => {
    const layout = sanitizeLayout({ explorerWidth: 5, propertiesWidth: 99999, bottomHeight: -3 });
    expect(layout.explorerWidth).toBe(160);
    expect(layout.propertiesWidth).toBe(640);
    expect(layout.bottomHeight).toBe(100);
  });

  it('works when the storage is blocked or throws', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(loadLayout(throwing)).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout(DEFAULT_LAYOUT, throwing)).not.toThrow();
    expect(loadLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });
});
