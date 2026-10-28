import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RULES } from './catalog';
import { CORE_PAGE_NAMES, corePage, indexPage, rulePage } from './docs';
import { ENGINE_PROBLEM_KEYS } from './engine-keys';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/user-guide/lint-rules');
const UPDATE = process.env['UPDATE_LINT_DOCS'] === '1';

const expected = new Map<string, string>([
  ['index.md', indexPage()],
  ...RULES.map((r) => [`${r.id}.md`, rulePage(r)] as [string, string]),
  ...CORE_PAGE_NAMES.map((n) => [`bpmnlint-${n}.md`, corePage(n)] as [string, string]),
]);

describe('rule pages (docs/user-guide/lint-rules)', () => {
  if (UPDATE) {
    it('writes the pages', () => {
      mkdirSync(DIR, { recursive: true });
      for (const [name, content] of expected) writeFileSync(join(DIR, name), content);
      // drop pages of rules that no longer exist
      for (const name of existsSync(DIR) ? readdirSync(DIR) : []) if (name.endsWith('.md') && !expected.has(name)) throw new Error(`stale page ${name}: delete it`);
    });
    return;
  }

  it('has a page for every rule and no stale one', () => {
    expect(existsSync(DIR)).toBe(true);
    expect(readdirSync(DIR).filter((n) => n.endsWith('.md')).sort()).toEqual([...expected.keys()].sort());
  });

  it.each([...expected.keys()])('%s is up to date (run `npm run docs:generate -w @activiti-modeler/bpmnlint-plugin-activiti`)', (name) => {
    expect(readFileSync(join(DIR, name), 'utf8')).toBe(expected.get(name));
  });

  it('every engine problem key has a rule', () => {
    const missing = ENGINE_PROBLEM_KEYS.filter((k) => !RULES.some((r) => r.key === k));
    expect(missing).toEqual([]);
    expect(new Set(RULES.filter((r) => r.key).map((r) => r.key)).size).toBe(ENGINE_PROBLEM_KEYS.length);
  });
});
