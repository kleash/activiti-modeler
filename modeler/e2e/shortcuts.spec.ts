import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, canvasScale, centreOf, element, menu, openApp, processXml, shapeBox, tab } from './support/app';
import { ModelerApi } from './support/modelerApi';

const toolHighlighted = (page: Page, tool: string) => activePanel(page).locator(`.djs-palette .entry[data-action="${tool}"].highlighted-entry`);
const focusCanvas = (page: Page) => activePanel(page).locator('.djs-container > svg').click({ position: { x: 5, y: 5 } });

async function load(page: Page): Promise<void> {
  const api = await ModelerApi.open(page);
  await api.importXml(
    processXml('keys', [
      { id: 'a', type: 'task', name: 'Alpha', x: 200, y: 100 },
      { id: 'b', type: 'task', name: 'Beta', x: 420, y: 100 },
    ]),
  );
  await expect(element(page, 'a')).toBeVisible();
  await focusCanvas(page);
}

test('U12 the Help menu opens the keyboard shortcuts of every group, with the keys of this platform', async ({ page }) => {
  await openApp(page);
  await menu(page, 'Help', 'Keyboard shortcuts');
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible();
  for (const group of ['File', 'Edit', 'Tools', 'View', 'Navigation']) await expect(dialog.getByRole('heading', { name: group })).toBeVisible();
  const row = (label: string) => dialog.getByRole('row').filter({ has: page.getByRole('cell', { name: label, exact: true }) });
  await expect(row('Save')).toContainText('Ctrl+S');
  await expect(row('Save as')).toContainText('Ctrl+Shift+S');
  await expect(row('Save all')).toContainText('Ctrl+Alt+S');
  await expect(row('Reopen last closed tab')).toContainText('Ctrl+Shift+T');
  await expect(row('Next tab')).toContainText('Ctrl+Tab');
  await expect(row('Redo')).toContainText('Ctrl+Y');
  await expect(row('Redo')).toContainText('Ctrl+Shift+Z');
  await expect(row('Toggle bottom panel')).toContainText('Ctrl+B');
  await expect(row('Toggle properties panel')).toContainText('Ctrl+P');
  await expect(row('Move diagram to origin')).toContainText('Ctrl+Shift+O');
  await expect(row('Copy selection as image')).toContainText('Ctrl+Shift+C');
  await expect(row('Hand tool')).toContainText('H');
  await expect(row('Find element')).toContainText('Ctrl+F');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('U12 the shell shortcuts open dialogs and toggle panels', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('templates-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+O');
  await expect(page.getByTestId('projects-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('projects-dialog')).toBeHidden();
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('bottom-panel')).toBeVisible();
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
  await page.keyboard.press('Control+P');
  await expect(page.getByTestId('properties-panel')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('choice-dialog')).toContainText('Export as image');
  await page.keyboard.press('Escape');
  // no shortcut fires while a dialog is open
  await page.keyboard.press('Control+N');
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('U12 tool keys work while the diagram has the focus: H, L, S, C', async ({ page }) => {
  await load(page);
  for (const [key, tool] of [['h', 'hand-tool'], ['l', 'lasso-tool'], ['s', 'space-tool'], ['c', 'global-connect-tool']] as const) {
    await page.keyboard.press(key);
    await expect(toolHighlighted(page, tool), `${key} activates ${tool}`).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toolHighlighted(page, tool)).toHaveCount(0);
  }
  // single keys are for the diagram only: with the focus in the explorer they do nothing
  await page.getByRole('treeitem', { name: 'project.json', exact: true }).focus();
  await page.keyboard.press('h');
  await expect(toolHighlighted(page, 'hand-tool')).toHaveCount(0);
});

test('U12 E opens the label editor and R the replace menu of the selected element', async ({ page }) => {
  await load(page);
  const a = await centreOf(page, 'a');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.press('e');
  await expect(activePanel(page).locator('.djs-direct-editing-content')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activePanel(page).locator('.djs-direct-editing-content')).toBeHidden();
  const b = await centreOf(page, 'b');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('r');
  await expect(page.locator('.djs-popup')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('U12 arrow keys move the selection (Shift: faster) and Ctrl+arrows move the canvas', async ({ page }) => {
  await load(page);
  const a = await centreOf(page, 'a');
  await page.mouse.click(a.x, a.y);
  const before = await shapeBox(page, 'a');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const small = await shapeBox(page, 'a');
  expect(small.x - before.x).toBeGreaterThan(0);
  expect(small.y - before.y).toBeGreaterThan(0);
  await page.keyboard.press('Shift+ArrowRight');
  const big = await shapeBox(page, 'a');
  expect(big.x - small.x).toBeGreaterThan(small.x - before.x);

  const viewport = activePanel(page).locator('.djs-container svg .viewport').first();
  const t0 = await viewport.getAttribute('transform');
  await page.keyboard.press('Control+ArrowLeft');
  expect(await viewport.getAttribute('transform')).not.toBe(t0);
  // Delete removes the selection and Ctrl+Z brings it back
  await page.keyboard.press('Delete');
  await expect(element(page, 'a')).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(element(page, 'a')).toBeVisible();
  await page.keyboard.press('Control+A');
  await expect(activePanel(page).locator('.djs-element.selected')).toHaveCount(2);
});

test('U12 zoom keys: Ctrl+= and Ctrl+- zoom, Ctrl+0 is actual size, Ctrl+1 fits the diagram', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Control+0');
  expect(await canvasScale(page)).toBeCloseTo(1, 5);
  await page.keyboard.press('Control+=');
  const zoomedIn = await canvasScale(page);
  expect(zoomedIn).toBeGreaterThan(1);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  expect(await canvasScale(page)).toBeLessThan(1);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  const far = await canvasScale(page);
  expect(far).toBeGreaterThan(zoomedIn);
  // fit brings the whole (small) diagram back to its natural size
  await page.keyboard.press('Control+1');
  expect(await canvasScale(page)).toBeLessThan(far);
  expect(await canvasScale(page)).toBeLessThanOrEqual(1);
});

test('U12 shortcuts also work on a keyboard layout that types other characters (event.code fallback)', async ({ page }) => {
  await openApp(page);
  await page.getByRole('treeitem', { name: 'project.json', exact: true }).dblclick();
  const editor = activePanel(page).getByTestId('text-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n');
  await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
  // Cyrillic layout: Ctrl + the physical S key types "ы"
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect(tab(page, 'project.json')).not.toHaveClass(/dirty/);

  // the diagram's own tool keys have the fallback too: "р" is the physical H key
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await focusCanvas(page);
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'р', code: 'KeyH', bubbles: true, cancelable: true }));
  });
  await expect(toolHighlighted(page, 'hand-tool')).toBeVisible();
  await page.keyboard.press('Escape');

  // a Latin layout whose physical S key types another letter does not save (Dvorak "o")
  await tab(page, 'project.json').getByRole('tab').click();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n');
  await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
  // the typed Latin letter wins: Ctrl+"o" is Open. The key goes to the page itself: inside the editor, CodeMirror takes Ctrl+O first
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('projects-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('projects-dialog')).toBeHidden();
  await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
});
