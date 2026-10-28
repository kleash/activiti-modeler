// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { documentWith, createLintModeler, type LintModeler } from './test-modeler';
import { LINT_COMPLETED, LINT_FOCUS } from './index';
import type { Problem } from '../types';

let current: LintModeler | undefined;
afterEach(() => {
  current?.destroy();
  current = undefined;
});

const open = async (body: string, shapes: Array<{ id: string; x: number; y: number; w?: number; h?: number }>, extensionsJson?: string, defs = ''): Promise<LintModeler> => {
  current = await createLintModeler(documentWith(body, shapes, defs), extensionsJson);
  return current;
};

const rules = (problems: Problem[]): string[] => problems.map((p) => p.rule).sort();
const ofRule = (problems: Problem[], rule: string): Problem => {
  const found = problems.find((p) => p.rule === rule);
  if (!found) throw new Error(`no problem ${rule} in ${rules(problems).join(', ')}`);
  return found;
};

describe('lint module', () => {
  it('lints after an import, fires activiti.lint.completed and draws overlays', async () => {
    const m = await open('<serviceTask id="s" name="Broken"/>', [{ id: 's', x: 100, y: 100 }]);
    const events: Problem[][] = [];
    m.get<{ on(e: string, cb: (x: { problems: Problem[] }) => void): void }>('eventBus').on(LINT_COMPLETED, (e) => void events.push(e.problems));
    const problems = await m.lint();
    expect(rules(problems)).toContain('activiti/service-task-missing-implementation');
    expect(events.at(-1)).toBe(problems);
    expect(document.querySelectorAll('.bjsl-overlay').length).toBeGreaterThan(0);
    expect(ofRule(problems, 'activiti/service-task-missing-implementation')).toMatchObject({ elementId: 's', severity: 'error', entryId: 'impl.type', source: 'client' });
  });

  it('lints by itself on a debounce after a change', async () => {
    const m = await open('<serviceTask id="s" name="Broken"/>', [{ id: 's', x: 100, y: 100 }]);
    await m.lint();
    const modeling = m.get<{ updateProperties(el: unknown, p: Record<string, unknown>): void }>('modeling');
    const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
    const done = new Promise<Problem[]>((resolve) => m.get<{ on(e: string, cb: (x: { problems: Problem[] }) => void): void }>('eventBus').on(LINT_COMPLETED, (e) => resolve(e.problems)));
    modeling.updateProperties(registry.get('s'), { 'activiti:class': 'a.B' });
    expect(rules(await done)).not.toContain('activiti/service-task-missing-implementation');
  });

  it('selects the element and fires activiti.lint.focus', async () => {
    const m = await open('<serviceTask id="s" name="Broken"/>', [{ id: 's', x: 100, y: 100 }]);
    const focused: unknown[] = [];
    m.get<{ on(e: string, cb: (x: unknown) => void): void }>('eventBus').on(LINT_FOCUS, (e) => focused.push(e));
    m.linting.focus({ elementId: 's', entryId: 'impl.type', rule: 'activiti/service-task-missing-implementation' });
    expect(m.get<{ get(): Array<{ id: string }> }>('selection').get().map((e) => e.id)).toEqual(['s']);
    expect(focused).toMatchObject([{ elementId: 's', entryId: 'impl.type', rule: 'activiti/service-task-missing-implementation' }]);
  });

  it('merges the problems of the server and drops the ones it already knows', async () => {
    const m = await open('<serviceTask id="s" name="Broken"/><scriptTask id="t" scriptFormat="javascript"><script>1</script></scriptTask>', [{ id: 's', x: 100, y: 100 }, { id: 't', x: 300, y: 100 }]);
    m.linting.setContext({ path: 'a.bpmn20.xml' });
    m.linting.setServerProblems([
      { path: 'a.bpmn20.xml', elementId: 's', key: 'SERVICE_TASK_MISSING_IMPLEMENTATION', severity: 'error', message: 'engine', source: 'engine-validate' },
      { path: 'a.bpmn20.xml', elementId: 't', key: 'trial-deploy', severity: 'error', message: 'Deployment fails: boom', source: 'trial-deploy' },
      { path: 'other.bpmn20.xml', elementId: 't', key: 'X', severity: 'error', message: 'not this file', source: 'engine-validate' },
    ]);
    const problems = await m.lint();
    expect(problems.filter((p) => p.source === 'engine').map((p) => [p.elementId, p.key])).toEqual([['t', 'trial-deploy']]);
    expect(problems.filter((p) => p.key === 'SERVICE_TASK_MISSING_IMPLEMENTATION')).toHaveLength(1);
  });

  it('reads the live extensions store (L9, L21)', async () => {
    const m = await open('<userTask id="u" name="Review"/>', [{ id: 'u', x: 100, y: 100 }], '{"id":"x","extensions":{"p":{"properties":{},"mappings":{},"constants":{}}}}');
    expect(rules(await m.lint())).toContain('activiti/missing-mapping');
    m.get<{ setMapping(p: string, e: string, mapping: unknown): void }>('extensionsStore').setMapping('p', 'u', { mappingType: 'MAP_ALL' });
    expect(rules(await m.lint())).not.toContain('activiti/missing-mapping');
  });
});
