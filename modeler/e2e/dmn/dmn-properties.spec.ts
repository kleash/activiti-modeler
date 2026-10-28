import { expect, type Page } from '@playwright/test';

import { waitForSession } from '../support/app';
import { test } from '../support/test';
import { drdElement, idbFiles, newDmn, openApp, openView, padEntry, placeShape, saveAndRead, selectShape, tab, drdShapeIds, viewChip } from './support';

/** The properties panel of the DRD (dmn-js-properties-panel): id, name and documentation of the decision model elements. */

test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

const panel = (page: Page) => page.locator('#properties-panel-slot');
const entry = (page: Page, id: string) => panel(page).locator(`[data-entry-id="${id}"]`);

async function openDrd(page: Page): Promise<{ title: string; path: string; decision: string; inputData: string }> {
  await openApp(page);
  await newDmn(page, 'dmn-drd', 'credit');
  const xml = (await idbFiles(page))['processes/credit.dmn'] ?? (await saveAndRead(page, 'credit.dmn', 'processes/credit.dmn'));
  const decision = /<decision\b[^>]*?\bid="([^"]+)"/.exec(xml)![1]!;
  const inputData = /<inputData\b[^>]*?\bid="([^"]+)"/.exec(xml)![1]!;
  await expect.poll(async () => (await drdShapeIds(page)).includes(decision)).toBe(true);
  return { title: 'credit.dmn', path: 'processes/credit.dmn', decision, inputData };
}

test('DM properties selecting a decision in the DRD shows its general and documentation groups; input data shows its own', async ({ page }) => {
  const { decision, inputData } = await openDrd(page);
  await selectShape(page, decision);
  await expect(panel(page).locator('.bio-properties-panel-group-header', { hasText: 'General' })).toBeVisible();
  await expect(panel(page).locator('.bio-properties-panel-group-header', { hasText: 'Documentation' })).toBeVisible();
  await expect(entry(page, 'name').locator('textarea')).toHaveValue(decision);
  await expect(entry(page, 'id').locator('input')).toHaveValue(decision);
  await selectShape(page, inputData);
  await expect(entry(page, 'id').locator('input')).toHaveValue(inputData);
  await expect(panel(page)).toContainText('Input Data');
});

test('DM properties the name and the id are edited in the panel: the DRD label follows, one undo step each, the file has them after Save', async ({ page }) => {
  const { title, path, decision } = await openDrd(page);
  await selectShape(page, decision);
  await entry(page, 'name').locator('textarea').fill('Credit limit');
  await page.keyboard.press('Tab');
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="' + decision + '"]')).toContainText('Credit limit');
  await entry(page, 'id').locator('input').fill('creditLimit');
  await page.keyboard.press('Tab');
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="creditLimit"]')).toBeVisible();
  const xml = await saveAndRead(page, title, path);
  expect(xml).toMatch(/<decision id="creditLimit" name="Credit limit"/);
  // undo restores the id, then the name
  await page.locator('.editor-panel.active .djs-container > svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="' + decision + '"]')).toBeVisible();
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="' + decision + '"]')).toContainText(decision);
});

test('DM properties an id that is taken or not valid is refused with a message and the model keeps its id', async ({ page }) => {
  const { decision, inputData } = await openDrd(page);
  await selectShape(page, decision);
  await entry(page, 'id').locator('input').fill(inputData);
  await expect(entry(page, 'id')).toContainText(/already|unique|used/i);
  await entry(page, 'id').locator('input').fill('has space');
  await expect(entry(page, 'id')).toContainText(/space/i);
  await page.keyboard.press('Tab');
  await selectShape(page, inputData);
  await selectShape(page, decision);
  await expect(entry(page, 'id').locator('input')).toHaveValue(decision);
});

test('DM properties a decision with a new id keeps its view: the chip has the new id and is the selected view once it is opened', async ({ page }) => {
  const { decision } = await openDrd(page);
  await selectShape(page, decision);
  await entry(page, 'id').locator('input').fill('creditLimit');
  await page.keyboard.press('Tab');
  await expect(viewChip(page, decision)).toHaveCount(0);
  await openView(page, 'creditLimit');
  await expect(viewChip(page, 'drd')).toHaveAttribute('aria-selected', 'false');
});

test('DM properties the id of a deleted element can be given to a new one', async ({ page }) => {
  const { title, path, inputData } = await openDrd(page);
  await selectShape(page, inputData);
  await padEntry(page, 'delete').click();
  await expect(drdElement(page, inputData)).toHaveCount(0);
  const created = await placeShape(page, 'create.input-data');
  await selectShape(page, created);
  await entry(page, 'id').locator('input').fill(inputData);
  await page.keyboard.press('Tab');
  await expect(drdElement(page, inputData)).toHaveCount(1);
  await expect(entry(page, 'id')).not.toContainText(/already|unique|used/i);
  expect(await saveAndRead(page, title, path)).toMatch(new RegExp(`<inputData id="${inputData}"`));
});

test('DM properties documentation is written as the description of the element and survives a reload', async ({ page }) => {
  const { title, path, decision } = await openDrd(page);
  await selectShape(page, decision);
  await entry(page, 'description').locator('textarea').fill('Limit by income.\nSecond line.');
  await page.keyboard.press('Tab');
  const xml = await saveAndRead(page, title, path);
  expect(xml).toMatch(new RegExp(`<decision id="${decision}"[^>]*>\\s*<description>Limit by income\\.\\nSecond line\\.</description>`));
  await waitForSession(page, path);
  await page.reload();
  await expect(tab(page, title)).toBeVisible();
  await selectShape(page, decision);
  await expect(entry(page, 'description').locator('textarea')).toHaveValue('Limit by income.\nSecond line.');
});

test('DM properties only what Activiti reads is offered: no question, no allowed answers, no Camunda or Zeebe group; the saved file has no foreign namespace', async ({ page }) => {
  const { title, path, decision } = await openDrd(page);
  await selectShape(page, decision);
  await expect(entry(page, 'description')).toBeVisible();
  await expect(entry(page, 'question')).toHaveCount(0);
  await expect(entry(page, 'allowedAnswers')).toHaveCount(0);
  const headers = await panel(page).locator('.bio-properties-panel-group-header-title').allInnerTexts();
  expect(headers.join('|')).not.toMatch(/camunda|zeebe|history|version/i);
  await entry(page, 'description').locator('textarea').fill('x');
  await page.keyboard.press('Tab');
  const xml = await saveAndRead(page, title, path);
  expect(xml).not.toMatch(/camunda|zeebe/i);
});

test('DM properties the panel belongs to the DRD: a decision table view says so, and the DRD brings the panel back', async ({ page }) => {
  const { decision } = await openDrd(page);
  await selectShape(page, decision);
  await expect(entry(page, 'name')).toBeVisible();
  await openView(page, decision);
  await expect(panel(page)).toBeHidden();
  await expect(page.getByTestId('properties-panel')).toContainText('Properties are shown while the DRD is open');
  await openView(page, 'drd');
  await selectShape(page, decision);
  await expect(entry(page, 'name')).toBeVisible();
});
