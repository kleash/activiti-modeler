/**
 * The N01 negative corpus (`corpus/N01-negative`): every small model there is linted as its own project (the model, its
 * extensions sidecar, and the context files its case names) and must produce exactly the problems of the hand-written
 * oracle `expected-lint.json` (`rule@elementId`, or `rule` for a file-level problem).
 */
import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { N01_MODELS, caseProject, n01Oracle, problemIds } from './n01-support';
import { lintProject } from './project';

const oracle = n01Oracle();

describe('N01 negative corpus', () => {
  it('has an oracle entry for every model and no entry without a file', () => {
    const onDisk = readdirSync(N01_MODELS).filter((n) => /\.(bpmn20\.xml|dmn)$/.test(n)).sort();
    expect(Object.keys(oracle.files).sort()).toEqual(onDisk);
  });

  for (const [file, entry] of Object.entries(oracle.files)) {
    it(`${file} produces exactly the expected problems`, async () => {
      const result = await lintProject(caseProject(file, entry.context));
      expect(problemIds(result.problems)).toEqual([...entry.expect].sort());
    });
  }
});
