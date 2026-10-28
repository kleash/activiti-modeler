import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { availableLocales, currentLocale, format, registerCatalog, setLocale, subscribeLocale, t, translateText } from './index';
import { en } from './en';

/** U29: the i18n hooks. Every text of the shell goes through `t()`; there is one English catalog. */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

afterEach(() => {
  setLocale('en');
  registerCatalog('xx', {});
});

describe('U29 t()', () => {
  it('returns the English text of a key and fills in the parameters', () => {
    expect(t('dialog.cancel')).toBe('Cancel');
    expect(t('camunda.converted', { converted: 5, dropped: 1, approximated: 2 })).toBe('Converted from Camunda 7: 5 translated, 1 dropped, 2 with differences. Save to keep the result.');
    expect(t('status.unsaved', { count: 3 })).toBe('3 file(s) with unsaved changes');
  });

  it('leaves a placeholder without a parameter as it is, and shows an unknown key as itself', () => {
    expect(format('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
    expect(t('no.such.key' as never)).toBe('no.such.key');
  });

  it('uses the catalog of the chosen locale and falls back to English for a key it lacks', () => {
    registerCatalog('xx', { 'dialog.cancel': 'Abbrechen' });
    expect(availableLocales()).toEqual(expect.arrayContaining(['en', 'xx']));
    setLocale('xx');
    expect(currentLocale()).toBe('xx');
    expect(t('dialog.cancel')).toBe('Abbrechen');
    expect(t('dialog.ok')).toBe('OK');
  });

  it('refuses a locale without a catalog and tells the listeners when the locale changes', () => {
    expect(() => setLocale('yy')).toThrow('no catalog registered for the locale "yy"');
    let calls = 0;
    const stop = subscribeLocale(() => void (calls += 1));
    registerCatalog('xx', { 'dialog.ok': 'Gut' });
    setLocale('xx');
    stop();
    setLocale('en');
    expect(calls).toBe(1);
  });

  it('translates free text by itself as the key (the strings of bpmn-js)', () => {
    registerCatalog('xx', { 'Create task': 'Aufgabe anlegen' } as never);
    setLocale('xx');
    expect(translateText('Create task')).toBe('Aufgabe anlegen');
    expect(translateText('Append {name}', { name: 'x' })).toBe('Append x');
  });
});

describe('U29 the English catalog and the code agree', () => {
  const files = sources(SRC).filter((path) => !path.endsWith(join('i18n', 'en.ts')));
  const text = files.map((path) => readFileSync(path, 'utf8')).join('\n');

  it('every key the code asks for is in the catalog', () => {
    const used = new Set<string>();
    for (const call of text.matchAll(/\bt\(\s*([^)]*?)(?:,\s*\{|\))/g)) {
      for (const literal of call[1]!.matchAll(/'([a-z][A-Za-z]*(?:\.[A-Za-z0-9]+)+)'/g)) used.add(literal[1]!);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((key) => !(key in en))).toEqual([]);
  });

  it('every key of the catalog is used somewhere (no dead texts)', () => {
    expect(Object.keys(en).filter((key) => !text.includes(`'${key}'`))).toEqual([]);
  });

  it('keys are area.name, and every placeholder is a plain word', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(key, key).toMatch(/^[a-z][A-Za-z]*(\.[A-Za-z0-9]+)+$/);
      for (const placeholder of value.matchAll(/\{([^}]*)\}/g)) expect(placeholder[1], key).toMatch(/^\w+$/);
    }
  });

  it('the menus and the dialogs of the shell have no English text left in the code', () => {
    const menu = readFileSync(join(SRC, 'components', 'MenuBar.tsx'), 'utf8');
    expect(menu.match(/label: '[^']+'/g) ?? []).toEqual([]);
  });

  it('the run workbench has no English text left in the code', () => {
    const run = join(SRC, 'run');
    const examples = ['PT25H', '{"name": "value"}']; // format examples of placeholders, not text
    const left = readdirSync(run)
      .filter((name) => name.endsWith('.tsx'))
      .flatMap((name) => {
        const code = readFileSync(join(run, name), 'utf8');
        // JSX text: words after the > of a tag (not of =>, ->, a comparison or <code>)
        const texts = [...code.matchAll(/(?:^[ \t]*|(?<![=\s-])(?<!<code))>\s*([A-Za-z][^<>{}]*)/gm)].map((m) => m[1]!);
        // the attributes people read, as a string or a template literal
        const attributes = [...code.matchAll(/(?<![\w-])(?:aria-label|title|placeholder|label)=(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])(.*?)\3\s*\})/g)].map((m) => (m[1] ?? m[2] ?? m[4]!).replace(/\$\{[^}]*\}/g, ''));
        return [...texts, ...attributes].map((s) => s.trim()).filter((s) => /[A-Za-z]{2}/.test(s) && !examples.includes(s)).map((s) => `${name}: ${s}`);
      });
    expect(left).toEqual([]);
  });
});
