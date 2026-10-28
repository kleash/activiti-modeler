/**
 * Where each value (and each property name) of a JSON text is, by JSON pointer. A forgiving scanner: it stops at the first syntax
 * error and reports what it found up to there. Used to put the schema problems of a scenario file on the right line.
 */
export interface Located {
  from: number;
  to: number;
}

export interface PointerMap {
  values: Map<string, Located>;
  keys: Map<string, Located>;
}

export function locatePointers(text: string): PointerMap {
  const values = new Map<string, Located>();
  const keys = new Map<string, Located>();
  let i = 0;
  const skip = (): void => {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
  };
  const string = (): string => {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      return text.slice(start + 1, i - 1);
    }
  };
  const value = (pointer: string): boolean => {
    skip();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i += 1;
      skip();
      while (i < text.length && text[i] !== '}') {
        skip();
        if (text[i] !== '"') return false;
        const keyStart = i;
        const key = string();
        const childPointer = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        keys.set(childPointer, { from: keyStart, to: i });
        skip();
        if (text[i] !== ':') return false;
        i += 1;
        if (!value(childPointer)) return false;
        skip();
        if (text[i] === ',') i += 1;
        skip();
      }
      i += 1;
    } else if (c === '[') {
      i += 1;
      skip();
      let index = 0;
      while (i < text.length && text[i] !== ']') {
        if (!value(`${pointer}/${index}`)) return false;
        index += 1;
        skip();
        if (text[i] === ',') i += 1;
        skip();
      }
      i += 1;
    } else if (c === '"') {
      string();
    } else {
      const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!match) return false;
      i += match[0].length;
    }
    values.set(pointer, { from: start, to: i });
    return true;
  };
  value('');
  return { values, keys };
}

/** The range to mark for a pointer: the property name for a key problem, else the value, else the nearest parent that is known. */
export function rangeFor(map: PointerMap, pointer: string, key?: boolean): Located {
  if (key) {
    const hit = map.keys.get(pointer);
    if (hit) return hit;
  }
  for (let p = pointer; ; p = p.slice(0, p.lastIndexOf('/'))) {
    const hit = map.values.get(p) ?? (p === pointer ? map.keys.get(p) : undefined);
    if (hit) return hit.to - hit.from > 160 ? { from: hit.from, to: Math.min(hit.to, hit.from + 1) } : hit;
    if (p === '') return { from: 0, to: 1 };
  }
}
