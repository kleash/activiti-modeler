// @vitest-environment jsdom
/**
 * The quick fixes on the N01 models, in a real bpmn-js modeler: applying every offered fix, one after the other, leaves
 * the problems of `afterFixes` in the oracle, and the model still exports through the serializer's checks.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { N01_MODELS, caseProject, n01Oracle, problemIds } from '../n01-support';
import { lintProject } from '../project';
import { createLintModeler, type LintModeler } from './test-modeler';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let current: LintModeler | undefined;
afterEach(() => {
  current?.destroy();
  current = undefined;
});

const withFixes = Object.entries(n01Oracle().files).filter(([, entry]) => entry.afterFixes !== undefined);

describe('N01 quick fixes', () => {
  for (const [file, entry] of withFixes) {
    it(`${file}: ${entry.afterFixes!.length === 0 ? 'lint-clean' : 'only ' + entry.afterFixes!.join(', ')} after the fixes, and it exports`, async () => {
      const path = `processes/${file}`;
      const files = caseProject(file, entry.context);
      const { index } = await lintProject(files);
      const sidecar = join(N01_MODELS, file.replace(/\.bpmn20\.xml$/, '-extensions.json'));
      current = await createLintModeler(files[0]!.content, existsSync(sidecar) ? readFileSync(sidecar, 'utf8') : undefined);
      current.linting.setContext({ path, ...(index ? { project: index } : {}), text: files[0]!.content });
      let problems = await current.lint();
      expect(problemIds(problems)).toEqual([...entry.expect].sort());
      for (let round = 0; round < 60; round += 1) {
        const next = problems.find((p) => p.fix);
        if (!next) break;
        const result = current.linting.applyFix(next);
        expect(result, `${next.rule}@${next.elementId}`).toEqual({ ok: true });
        problems = await current.lint();
      }
      expect(problemIds(problems)).toEqual([...entry.afterFixes!].sort());
      await expect(current.exportXml()).resolves.toContain('<');
    });
  }
});
