import { describe, expect, it } from 'vitest';

import { RULES } from './catalog';
import { lintProject } from './project';
import { lintFixture } from './testing';

/** Every rule is proven by its own fixtures: each `bad` one reports exactly the listed element ids, each `good` one nothing. */
describe.each(RULES.filter((r) => r.target !== 'file'))('rule activiti/$id', (rule) => {
  it('has fixtures', () => {
    expect(rule.bad.length).toBeGreaterThan(0);
    expect(rule.good.length).toBeGreaterThan(0);
  });

  it.each(rule.bad.map((fixture, i) => [i, fixture] as const))('reports bad fixture %i', async (_i, fixture) => {
    const problems = await lintFixture(rule.id, fixture, rule.severity);
    expect(problems.map((p) => p.elementId ?? '').sort()).toEqual([...(fixture.ids ?? [])].sort());
    for (const problem of problems) {
      expect(problem.rule).toBe(`activiti/${rule.id}`);
      expect(problem.severity).toBe(rule.severity === 'warn' ? 'warning' : rule.severity);
      if (rule.key) expect(problem.message).toContain(`[${rule.key}]`);
    }
  });

  it.each(rule.good.map((fixture, i) => [i, fixture] as const))('accepts good fixture %i', async (_i, fixture) => {
    expect((await lintFixture(rule.id, fixture, rule.severity)).map((p) => p.message)).toEqual([]);
  });
});

describe.each(RULES.filter((r) => r.target === 'file'))('file rule activiti/$id', (rule) => {
  const run = async (files: Record<string, string> | undefined) => {
    const result = await lintProject(Object.entries(files ?? {}).map(([path, content]) => ({ path, content })));
    return result.problems.filter((p) => p.rule === `activiti/${rule.id}`);
  };

  it.each(rule.bad.map((fixture, i) => [i, fixture] as const))('reports bad fixture %i', async (_i, fixture) => {
    const problems = await run(fixture.files);
    expect(problems.map((p) => p.elementId ?? p.path).sort()).toEqual([...(fixture.ids ?? [])].sort());
  });

  it.each(rule.good.map((fixture, i) => [i, fixture] as const))('accepts good fixture %i', async (_i, fixture) => {
    expect(await run(fixture.files)).toEqual([]);
  });
});
