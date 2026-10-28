/**
 * N01 negative corpus (`corpus/N01-negative`): every hand-written model is dropped into the modeler like a user would import it,
 * and the Problems panel must list exactly the problems of the oracle `expected-lint.json`. Models with quick fixes are then fixed
 * through the panel: what remains is again the oracle's (`afterFixes`), and the result exports through the real serializer.
 */
import { expect } from '@playwright/test';

import { openApp } from './support/app';
import { dropCase, dropExported, exportZip, fixRows, n01Oracle, openProblems, problemIds } from './support/lint';
import { test } from './support/test';

const oracle = n01Oracle();

for (const [file, entry] of Object.entries(oracle)) {
  test(`U11 N01 ${file} shows exactly the expected problems`, async ({ page }) => {
    await openApp(page);
    const path = await dropCase(page, file, entry);
    await openProblems(page);
    await expect.poll(() => problemIds(page, path), { message: `the problems of ${file}` }).toEqual([...entry.expect].sort());
    // the oracle names the quick fixes: a model without `afterFixes` offers none
    const fixes = await fixRows(page, path).count();
    if (entry.afterFixes === undefined) expect(fixes, 'quick fixes offered').toBe(0);
    else expect(fixes, 'quick fixes offered').toBeGreaterThan(0);
  });
}

for (const [file, entry] of Object.entries(oracle)) {
  if (entry.afterFixes === undefined) continue;
  test(`U11 N01 ${file}: the quick fixes leave ${entry.afterFixes.length === 0 ? 'a lint-clean model' : 'only the expected problems'} and the model exports`, async ({ page, browser }, testInfo) => {
    // a Camunda file has a fix per attribute
    test.setTimeout(120_000);
    await openApp(page);
    const path = await dropCase(page, file, entry);
    await openProblems(page);
    await expect.poll(() => problemIds(page, path)).toEqual([...entry.expect].sort());
    for (let round = 0; round < 40; round += 1) {
      const fix = fixRows(page, path).first();
      if ((await fix.count()) === 0) break;
      const before = await problemIds(page, path);
      await fix.getByTestId('problem-fix').click();
      await expect.poll(async () => (await problemIds(page, path)).join('|'), { message: 'the lint after a fix' }).not.toBe(before.join('|'));
    }
    await expect.poll(() => problemIds(page, path)).toEqual([...entry.afterFixes!].sort());
    expect(await fixRows(page, path).count(), 'a fix that is still offered').toBe(0);

    // the export checks the serializer's guarantees; what it writes lints the same when it is imported again
    const exported = await exportZip(page, testInfo);
    expect(Object.keys(exported)).toContain(path);
    // nothing of Camunda or Zeebe is written, whatever the file started as (ADR 0001)
    for (const [name, content] of Object.entries(exported)) expect(content, name).not.toMatch(/camunda\.org|zeebe\.io|\b(?:camunda|zeebe):[A-Za-z]/);
    const again = await (await browser.newContext()).newPage();
    await openApp(again);
    await dropExported(again, exported);
    await openProblems(again);
    await expect.poll(() => problemIds(again, path), { message: 'the exported model, imported again' }).toEqual([...entry.afterFixes!].sort());
  });
}
