import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

import { dropFiles, idbFiles } from '../support/app';
import { N01_DIR, openProblems, problemIds } from '../support/lint';
import { test } from '../support/test';
import { activePanel, attrs, leaveCell, openApp, openView, saveAndRead, tab, cellEditor, typeInto } from './support';

// the connection probe of the run feature asks for a modeler server that these tests do not start
test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

/** The bottom panel with the import warnings of the open tabs. */
async function openWarnings(page: Page): Promise<void> {
  if (!(await page.getByTestId('warnings-tab').isVisible())) await page.keyboard.press('Control+B');
  await page.getByTestId('warnings-tab').click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** What dmn-js 18 or another tool writes before the portable form: Camunda's namespace and attributes, `integer`, no variables, no input data, an empty entry, a rule without an id. */
const RAW_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_risk" name="risk" namespace="http://camunda.org/schema/1.0/dmn" modeler:executionPlatform="Camunda Platform">
  <decision id="Decision_risk" name="Risk level">
    <decisionTable id="DecisionTable_1">
      <input id="Input_1" label="Age">
        <inputExpression id="InputExpression_1" typeRef="integer"><text>age</text></inputExpression>
      </input>
      <output id="Output_1" label="Level" typeRef="string" />
      <rule id="Rule_young">
        <inputEntry id="UnaryTests_1"><text>&lt; 21</text></inputEntry>
        <outputEntry id="LiteralExpression_1"><text>"HIGH"</text></outputEntry>
      </rule>
      <rule id="Rule_other">
        <inputEntry id="UnaryTests_2"><text></text></inputEntry>
        <outputEntry id="LiteralExpression_2"><text>"LOW"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>
`;

test('DM8 saving writes portable DMN: DMN 1.3, a variable per decision, FEEL type names, input data for what the table reads, "-" for an empty entry, named outputs', async ({ page }) => {
  await dropFiles(page, [{ name: 'risk.dmn', content: RAW_DMN }]);
  await page.getByTestId('file-tree').getByRole('treeitem').filter({ hasText: 'risk.dmn' }).dblclick();
  await expect(tab(page, 'risk.dmn')).toHaveClass(/active/);
  await openView(page, 'Decision_risk');
  // the file is as it was dropped until it is edited and saved
  expect((await idbFiles(page))['processes/risk.dmn']).toBe(RAW_DMN);

  // an edit in the table: the output of the first rule
  await typeInto(page, cellEditor(page, 'Rule_young', 'Output_1'), '"VERY HIGH"');
  await leaveCell(page);
  const xml = await saveAndRead(page, 'risk.dmn', 'processes/risk.dmn');

  expect(xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
  // nothing of the other tool is written (ADR 0001)
  expect(xml).not.toMatch(/camunda|modeler:/);
  expect(xml).toContain('namespace="http://activiti.org/schema/1.0/dmn/Definitions_risk"');
  // a variable named like the decision
  expect(xml).toMatch(/<decision id="Decision_risk" name="Risk level">\s*<variable id="[^"]+" name="Risk level"/);
  // FEEL type names
  expect(xml).not.toContain('integer');
  expect(attrs(xml, 'inputExpression', 'typeRef')).toEqual(['number']);
  // the input the table reads is declared and connected
  expect(xml).toMatch(/<inputData id="InputData_age" name="age">\s*<variable id="[^"]+" name="age" typeRef="number" \/>/);
  expect(xml).toMatch(/<requiredInput href="#InputData_age" \/>/);
  // "-" for the empty entry; the column that had a label but no name has a name (the decision's variable)
  expect(xml).toMatch(/<rule id="Rule_other">\s*<inputEntry id="[^"]+">\s*<text>-<\/text>/);
  expect(attrs(xml, 'output', 'name')).toEqual(['Risk level']);
  expect(xml).toContain('<text>"VERY HIGH"</text>');
  // the normalizer's report is in the warnings of the tab
  await openWarnings(page);
  await expect(page.getByTestId('warning-list')).toContainText('Normalized on save');
  // and a second save changes nothing: the saved file is its own normal form
  await page.keyboard.press('Control+S');
  expect((await idbFiles(page))['processes/risk.dmn']).toBe(xml);
});

test('DM9 a DMN 1.1 file opens migrated with @bpmn-io/dmn-migrate: the tab is marked as changed, the file stays as it was until it is saved, and the save writes DMN 1.3', async ({ page }) => {
  const legacy = readFileSync(join(N01_DIR, 'models/legacy-discount.dmn'), 'utf8');
  await dropFiles(page, [{ name: 'legacy-discount.dmn', content: legacy }]);
  // the explorer marks a file with problems: the item is found by its text
  await page.getByTestId('file-tree').getByRole('treeitem').filter({ hasText: 'legacy-discount.dmn' }).dblclick();
  await expect(tab(page, 'legacy-discount.dmn')).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('dmn-views')).toBeVisible();
  await openView(page, 'discount');
  // migrated, not saved: the tab is dirty, the stored file is the old one, and the import warnings say what happened
  await expect(tab(page, 'legacy-discount.dmn')).toHaveClass(/dirty/);
  expect((await idbFiles(page))['processes/legacy-discount.dmn']).toBe(legacy);
  await openWarnings(page);
  await expect(page.getByTestId('warning-list')).toContainText('Migrated from DMN 1.1 to DMN 1.3');
  // the lint reads the file as it is stored: it still says what is wrong with it
  await openProblems(page);
  await expect.poll(() => problemIds(page, 'processes/legacy-discount.dmn')).toEqual(['activiti/dmn-legacy-version', 'activiti/dmn-output-without-name@output1']);

  const xml = await saveAndRead(page, 'legacy-discount.dmn', 'processes/legacy-discount.dmn');
  expect(xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
  expect(xml).not.toContain('20151101');
  expect(xml).not.toContain('integer');
  expect(xml).toMatch(/<decision id="discount" name="Discount">/);
  expect(attrs(xml, 'output', 'name')).toEqual(['Discount']);
  expect(xml).toMatch(/<inputData id="InputData_customer" name="customer">/);
  // the migrated, saved file has neither problem any more
  await expect.poll(() => problemIds(page, 'processes/legacy-discount.dmn')).toEqual([]);
});

test('DM9 a DMN 1.2 file opens migrated too, and the save writes portable DMN 1.3: no Camunda namespace or attribute, FEEL types, input data, "-" in empty entries', async ({ page }) => {
  // the DMN 1.2 source of corpus/C17-dmn-migrated, whose migrated form the engine evaluates there
  const legacy = readFileSync(join(N01_DIR, '..', 'C17-dmn-migrated', 'legacy', 'shipping-fee.dmn'), 'utf8');
  await dropFiles(page, [{ name: 'shipping-fee.dmn', content: legacy }]);
  await page.getByTestId('file-tree').getByRole('treeitem').filter({ hasText: 'shipping-fee.dmn' }).dblclick();
  await expect(tab(page, 'shipping-fee.dmn')).toHaveClass(/active/);
  await openView(page, 'shippingFee');
  await expect(tab(page, 'shipping-fee.dmn')).toHaveClass(/dirty/);
  expect((await idbFiles(page))['processes/shipping-fee.dmn']).toBe(legacy);
  await openWarnings(page);
  await expect(page.getByTestId('warning-list')).toContainText('Migrated from DMN 1.2 to DMN 1.3');
  await openProblems(page);
  await expect.poll(() => problemIds(page, 'processes/shipping-fee.dmn')).toEqual(['activiti/dmn-legacy-version']);

  const xml = await saveAndRead(page, 'shipping-fee.dmn', 'processes/shipping-fee.dmn');
  expect(xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
  expect(xml).toContain('xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"');
  expect(xml).not.toContain('http://www.omg.org/spec/DMN/20180521/MODEL/');
  expect(xml).not.toContain('20180521/DMNDI');
  expect(xml).not.toMatch(/camunda/);
  expect(xml).toContain('namespace="http://activiti.org/schema/1.0/dmn/shippingFees"');
  expect(attrs(xml, 'inputExpression', 'typeRef')).toEqual(['number', 'boolean']);
  expect(attrs(xml, 'output', 'typeRef')).toEqual(['number']);
  expect(xml).toMatch(/<inputData id="InputData_weight" name="weight">/);
  expect(xml).toMatch(/<inputData id="InputData_express" name="express">/);
  expect(xml).toMatch(/<rule id="Rule_express">\s*<inputEntry id="UnaryTests_1">\s*<text>-<\/text>/);
  // the decision and rule ids are kept: the decision task and the matched rules refer to them
  expect(xml).toMatch(/<decision id="shippingFee" name="Shipping fee">/);
  expect(attrs(xml, 'rule', 'id')).toEqual(['Rule_express', 'Rule_light', 'Rule_heavy']);
  await expect.poll(() => problemIds(page, 'processes/shipping-fee.dmn')).toEqual([]);
});
