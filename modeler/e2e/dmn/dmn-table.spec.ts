import { expect } from '@playwright/test';

import { test } from '../support/test';
import {
  activePanel, addInputRight, addOutputRight, addRuleAtEnd, attrs, cellEditor, columnPopup, hitPolicyText, inputHeader, inputSettled, leaveCell, newDmn, openApp, openColumnEditor, openView, outputHeader, ruleCells, ruleIds, ruleMenu,
  saveAndRead, selectHitPolicy, typeInto,
} from './support';

// the connection probe of the run feature asks for a modeler server that these tests do not start
test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('DM2 a decision table is edited in the table: cells, annotations, inputs, outputs with allowed values, rules, copy and paste', async ({ page }) => {
  await newDmn(page, 'dmn-decision-table', 'pricing');
  await openView(page, 'pricing');
  expect(await ruleIds(page)).toEqual(['pricing_small', 'pricing_large']);

  // cells: an output entry and an annotation of the first rule
  await typeInto(page, cellEditor(page, 'pricing_small', 'pricing_output1'), '"cheap"');
  await leaveCell(page);
  await activePanel(page).locator('td.annotation[data-row-id="pricing_small"] .content-editable').click();
  await page.keyboard.type('under the bulk limit');
  await leaveCell(page);

  // a second input column with a label, an expression and a type
  await addInputRight(page, 0);
  await openColumnEditor(inputHeader(page, 1));
  await columnPopup(page).locator('[aria-label="Input label"]').click();
  await page.keyboard.type('Region');
  await columnPopup(page).locator('[aria-label="Input expression"]').click();
  await page.keyboard.type('region');
  await inputSettled(page);
  await page.keyboard.press('Escape');
  await leaveCell(page);
  await expect(inputHeader(page, 1).locator('.input-label')).toHaveText('Region');

  // a second output column with a name and allowed values
  await addOutputRight(page, 0);
  await openColumnEditor(outputHeader(page, 1));
  await columnPopup(page).locator('[aria-label="Output name"]').fill('shipping');
  await columnPopup(page).locator('.allowed-values-edit input').fill('"post","express"');
  await page.keyboard.press('Enter');
  await inputSettled(page);
  await leaveCell(page);
  await expect(outputHeader(page, 1).locator('.output-name')).toHaveText('shipping');

  // a rule at the end of the table, its cells typed
  await addRuleAtEnd(page);
  const ids = await ruleIds(page);
  expect(ids).toHaveLength(3);
  const third = ids[2]!;
  const columns = await activePanel(page).locator('th.input-cell, th.output-cell').evaluateAll((els) => els.map((e) => e.getAttribute('data-col-id')!));
  await typeInto(page, cellEditor(page, third, columns[0]!), '> 5000');
  await typeInto(page, cellEditor(page, third, columns[1]!), '"EU"');
  await typeInto(page, cellEditor(page, third, columns[2]!), '"premium"');
  await typeInto(page, cellEditor(page, third, columns[3]!), '"express"');
  await leaveCell(page);

  // copy the first rule and paste it below the second one; remove the third
  await ruleMenu(page, 0, 'copy-rule');
  await ruleMenu(page, 1, 'paste-rule-below');
  await expect(activePanel(page).locator('td.rule-index')).toHaveCount(4);
  await ruleMenu(page, 3, 'remove-rule');
  await expect(activePanel(page).locator('td.rule-index')).toHaveCount(3);

  const xml = await saveAndRead(page, 'pricing.dmn', 'processes/pricing.dmn');
  expect(attrs(xml, 'input', 'label')).toEqual(['Amount', 'Region']);
  expect(xml).toMatch(/<inputExpression id="[^"]+" typeRef="string">\s*<text>region<\/text>/);
  expect(attrs(xml, 'output', 'name')).toEqual(['route', 'shipping']);
  expect(xml).toMatch(/<outputValues id="[^"]+">\s*<text>"post","express"<\/text>/);
  expect(xml).toMatch(/<description>under the bulk limit<\/description>/);
  expect(xml).toContain('<text>"cheap"</text>');
  // three rules: the two of the template, and the pasted copy of the first one (a new id) below the second
  const rules = attrs(xml, 'rule', 'id');
  expect(rules).toHaveLength(3);
  expect(rules.slice(0, 2)).toEqual(['pricing_small', 'pricing_large']);
  expect(rules[2]).not.toBe('pricing_small');
  // the empty entries of the new column are written as "any" (portable DMN)
  expect(xml).not.toMatch(/<inputEntry id="[^"]+">\s*<text><\/text>/);
  expect(xml).not.toMatch(/<inputEntry id="[^"]+">\s*<text \/>/);
});

test('DM3 every hit policy and every COLLECT aggregator can be chosen, and the choice is saved', async ({ page }) => {
  await newDmn(page, 'dmn-decision-table', 'policies');
  await openView(page, 'policies');
  const policies: Array<[string, string, string | undefined]> = [
    ['Unique', 'UNIQUE', undefined],
    ['First', 'FIRST', undefined],
    ['Priority', 'PRIORITY', undefined],
    ['Any', 'ANY', undefined],
    ['Collect', 'COLLECT', undefined],
    ['Collect (Sum)', 'COLLECT', 'SUM'],
    ['Collect (Min)', 'COLLECT', 'MIN'],
    ['Collect (Max)', 'COLLECT', 'MAX'],
    ['Collect (Count)', 'COLLECT', 'COUNT'],
    ['Rule order', 'RULE ORDER', undefined],
    ['Output order', 'OUTPUT ORDER', undefined],
  ];
  for (const [label, policy, aggregation] of policies) {
    await selectHitPolicy(page, label);
    await expect.poll(() => hitPolicyText(page)).toBe(label);
    const xml = await saveAndRead(page, 'policies.dmn', 'processes/policies.dmn');
    // UNIQUE is the default of DMN: it is written by omission
    const written = policy === 'UNIQUE' ? '(?: hitPolicy="UNIQUE")?' : ` hitPolicy="${policy}"`;
    expect(xml, label).toMatch(new RegExp(`<decisionTable id="[^"]+"${written}${aggregation ? ` aggregation="${aggregation}"` : '(?! aggregation)'}`));
  }
  void ruleCells;
});
