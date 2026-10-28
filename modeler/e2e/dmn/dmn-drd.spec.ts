import { expect } from '@playwright/test';

import { test } from '../support/test';
import { activePanel, attrs, menu, canvasOf, connect, drdConnectionIds, drdElement, drdShapeIds, newDmn, openApp, padEntry, placeShape, renameShape, saveAndRead, selectById, selectShape, swallowClick, viewChip, tab } from './support';

// the connection probe of the run feature asks for a modeler server that these tests do not start
test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('DM1 the DRD is edited with the palette and the context pad: decision, input data, business knowledge model, knowledge source, requirements and an annotation', async ({ page }) => {
  await newDmn(page, 'dmn-drd', 'credit');
  const before = new Set(await drdShapeIds(page));
  // the template has two decisions and two input data elements; new elements of every kind of the DRD, right of the template and
  // around the new decision, so that no requirement drawn below crosses another shape (a free spot depends on the fonts)
  const inputData = await placeShape(page, 'create.input-data', { x: 880, y: 160 });
  const bkm = await placeShape(page, 'create.business-knowledge-model', { x: 700, y: 640 });
  const source = await placeShape(page, 'create.knowledge-source', { x: 880, y: 650 });
  const decision = await placeShape(page, 'create.decision', { x: 880, y: 420 });
  expect(before.has(inputData) || before.has(bkm) || before.has(source) || before.has(decision)).toBe(false);

  await renameShape(page, inputData, 'income');
  await renameShape(page, decision, 'maxLoan');
  await renameShape(page, bkm, 'discountRate');
  await renameShape(page, source, 'Credit policy');

  // an information requirement (input data to decision), a knowledge requirement (business knowledge model to decision) and an
  // authority requirement (knowledge source to decision)
  const information = await connect(page, inputData, decision);
  const knowledge = await connect(page, bkm, decision);
  const authority = await connect(page, source, decision);
  expect(information).toMatch(/^InformationRequirement_/);
  expect(knowledge).toMatch(/^KnowledgeRequirement_/);
  expect(authority).toMatch(/^AuthorityRequirement_/);

  // a wrong connection is refused by the rules: a business knowledge model and an input data element are not connected in either direction
  const connectionsBefore = (await drdConnectionIds(page)).length;
  await selectShape(page, bkm);
  await padEntry(page, 'connect').click();
  const target = (await drdElement(page, inputData).locator('.djs-hit').first().boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await expect(drdElement(page, inputData)).toHaveClass(/connect-not-ok/);
  await page.keyboard.press('Escape');
  expect((await drdConnectionIds(page)).length).toBe(connectionsBefore);

  // delete and undo the knowledge requirement
  await selectById(page, 'processes/credit.dmn', knowledge);
  await page.keyboard.press('Delete');
  await expect(drdElement(page, knowledge)).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(drdElement(page, knowledge)).toHaveCount(1);

  // an annotation appended to the decision from its context pad, with its association
  await selectShape(page, decision);
  const shapesBeforeAnnotation = (await drdShapeIds(page)).length;
  await padEntry(page, 'append.text-annotation').click();
  await expect.poll(async () => (await drdShapeIds(page)).length).toBe(shapesBeforeAnnotation + 1);
  expect((await drdConnectionIds(page)).some((id) => id.startsWith('Association_'))).toBe(true);
  // the new annotation is in text editing: its text is typed, then the click on the canvas ends the editing
  await expect(activePanel(page).locator('.djs-direct-editing-parent')).toBeVisible();
  await page.keyboard.type('Max loan is four times the income');
  await swallowClick(page);
  await expect(activePanel(page).locator('.djs-direct-editing-parent')).toHaveCount(0);

  const xml = await saveAndRead(page, 'credit.dmn', 'processes/credit.dmn');
  expect(attrs(xml, 'inputData', 'name')).toEqual(expect.arrayContaining(['income', 'score', 'amount']));
  expect(xml).toMatch(/<businessKnowledgeModel id="BusinessKnowledgeModel_\w+" name="discountRate">/);
  expect(xml).toMatch(/<knowledgeSource id="KnowledgeSource_\w+" name="Credit policy"/);
  expect(xml).toMatch(/<decision id="Decision_\w+" name="maxLoan">/);
  expect(xml).toMatch(/<requiredInput href="#InputData_\w+" \/>/);
  expect(xml).toMatch(new RegExp(`<knowledgeRequirement id="${knowledge}">\\s*<requiredKnowledge href="#${bkm}" />`));
  expect(xml).toMatch(new RegExp(`<authorityRequirement id="${authority}">\\s*<requiredAuthority href="#${source}" />`));
  expect(xml).toMatch(/<textAnnotation id="TextAnnotation_\w+">\s*<text>Max loan is four times the income<\/text>/);
  expect(xml).toMatch(/<association id="Association_\w+">\s*<sourceRef href="#\w+" \/>\s*<targetRef href="#\w+" \/>/);
  // the diagram carries a shape for every element
  expect(attrs(xml, 'dmndi:DMNShape', 'dmnElementRef')).toEqual(expect.arrayContaining([inputData, bkm, source, decision]));
  // the portable form: variables named like their elements
  expect(xml).toContain('<variable id="');
  expect(xml).not.toMatch(/<variable [^>]*name=""/);
  await expect(viewChip(page, 'drd')).toHaveAttribute('aria-selected', 'true');
  await expect(canvasOf(page)).toBeVisible();
  await expect(tab(page, 'credit.dmn')).not.toHaveClass(/dirty/);
});

test('U7 search in the DRD: Ctrl+F lists the elements whose name or id match, Enter selects the first one, the Edit menu offers it too', async ({ page }) => {
  await newDmn(page, 'dmn-drd', 'search');
  const canvas = activePanel(page).getByTestId('dmn-canvas');
  await page.evaluate(() => (window as unknown as { __dmnEditors: Map<string, { getActiveViewer(): { get(name: string): { focus(): void } } }> }).__dmnEditors.get('processes/search.dmn')!.getActiveViewer().get('canvas').focus());
  await page.keyboard.press('Control+F');
  const search = canvas.locator('.djs-search-container');
  await expect(search).toBeVisible();
  await page.keyboard.type('risk');
  // matches by name (the decision) and by id (its requirements); the name matches come first
  const results = search.locator('.djs-search-result');
  await expect(results.first()).toHaveAttribute('data-result-id', 'search_riskClass');
  expect(await results.count()).toBeGreaterThan(1);
  await page.keyboard.press('Enter');
  await expect(drdElement(page, 'search_riskClass')).toHaveClass(/\bselected\b/);
  await expect(search).toBeHidden();
  // a name that nothing has
  await page.evaluate(() => (window as unknown as { __dmnEditors: Map<string, { getActiveViewer(): { get(name: string): { focus(): void } } }> }).__dmnEditors.get('processes/search.dmn')!.getActiveViewer().get('canvas').focus());
  await page.keyboard.press('Control+F');
  await page.keyboard.type('zzzz');
  await expect(search.locator('.djs-search-result')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // the Edit menu: Find element is enabled for a DMN tab and opens the same search
  await menu(page, 'Edit', 'Find element');
  await expect(search).toBeVisible();
});
