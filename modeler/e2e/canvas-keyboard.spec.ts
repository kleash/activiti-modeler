import { type Page, expect } from '@playwright/test';

import { test } from './support/test';
import { activePanel, element, processXml } from './support/app';
import { ModelerApi } from './support/modelerApi';

/** U30: the append indicator on flows that end without continuing, and the keyboard-operable palette. */

const popup = (page: Page) => page.locator('.djs-popup');
const palette = (page: Page) => activePanel(page).locator('.djs-palette');
const indicator = (page: Page, id: string) => activePanel(page).locator(`.activiti-append-indicator[data-element-id="${id}"]`);
const focusCanvas = (page: Page) => activePanel(page).locator('.djs-container > svg').click({ position: { x: 5, y: 5 } });
const focusedAction = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-action') ?? null);

/** Tab from the canvas until the focus is in the palette (the lint and minimap buttons come first); returns the number of Tab presses. */
async function tabToPalette(page: Page): Promise<number> {
  await focusCanvas(page);
  for (let presses = 1; presses <= 6; presses++) {
    await page.keyboard.press('Tab');
    if (await focusedAction(page)) return presses;
  }
  throw new Error('the palette did not get the focus');
}

async function load(page: Page): Promise<ModelerApi> {
  const api = await ModelerApi.open(page);
  await api.importXml(
    processXml('indicator', [
      { id: 'start', type: 'startEvent', x: 100, y: 120 },
      { id: 'review', type: 'userTask', name: 'Review', x: 200, y: 98 },
      { id: 'finish', type: 'endEvent', x: 400, y: 120 },
    ]),
  );
  await api.connect('start', 'review', 'f1');
  await expect(element(page, 'review')).toBeVisible();
  return api;
}

test.describe('U30 append indicator', () => {
  test('U30 a flow that ends without continuing shows an append indicator; a finished flow and an end event do not', async ({ page }) => {
    await load(page);
    await expect(indicator(page, 'review')).toBeVisible();
    await expect(indicator(page, 'review')).toHaveAccessibleName('Append element after Review');
    await expect(indicator(page, 'start')).toHaveCount(0);
    await expect(indicator(page, 'finish')).toHaveCount(0);
  });

  test('U30 the indicator opens the append menu of its element, and appending removes it and gives the next element one', async ({ page }) => {
    const api = await load(page);
    await indicator(page, 'review').click();
    await expect(popup(page).locator('.djs-popup-title')).toHaveText('Append element');
    await expect(popup(page).locator('.entry[data-id="append-none-start-event"]')).toHaveCount(0);
    await popup(page).locator('.entry[data-id="append-exclusive-gateway"]').click();
    await expect(indicator(page, 'review')).toHaveCount(0);
    const gateway = (await api.elementIds()).find((id) => id.startsWith('Gateway_'))!;
    await expect(indicator(page, gateway)).toBeVisible();
    // the undo takes the gateway and with it its indicator; the task has its indicator back
    await page.keyboard.press('Control+z');
    await expect(indicator(page, gateway)).toHaveCount(0);
    await expect(indicator(page, 'review')).toBeVisible();
  });

  test('U30 the indicator is operable with the keyboard: Tab to it, Enter opens the menu, Escape closes it', async ({ page }) => {
    await load(page);
    await indicator(page, 'review').focus();
    await page.keyboard.press('Enter');
    await expect(popup(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup(page)).toBeHidden();
  });

  test('U30 a boundary event without a flow gets an indicator, and the indicator moves with the task', async ({ page }) => {
    const api = await load(page);
    await api.select('review');
    await page.keyboard.press('a');
    await popup(page).locator('.entry[data-id="append-timer-boundary"]').click();
    const boundary = (await api.elementIds()).find((id) => id.startsWith('Event_'))!;
    await expect(indicator(page, boundary)).toBeVisible();
    const before = await indicator(page, 'review').boundingBox();
    await api.select('review');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await indicator(page, 'review').boundingBox())!.y).toBeGreaterThan(before!.y);
  });
});

test.describe('U30 keyboard-operable palette', () => {
  test('U30 the palette is a toolbar of named buttons and one Tab stop right after the canvas', async ({ page }) => {
    await load(page);
    await expect(palette(page)).toHaveAttribute('role', 'toolbar');
    await expect(palette(page)).toHaveAccessibleName('Palette');
    await expect(palette(page).locator('.entry[data-action][tabindex="0"]')).toHaveCount(1);
    await expect(palette(page).locator('.entry[data-action="create.task"]')).toHaveAccessibleName(/task/i);
    const presses = await tabToPalette(page);
    expect(presses).toBeLessThanOrEqual(4);
    expect(await focusedAction(page)).toBe('hand-tool');
    // the whole palette is one stop: the next Tab leaves it, Shift+Tab comes back to the same entry
    await page.keyboard.press('Tab');
    expect(await focusedAction(page)).toBeNull();
    await page.keyboard.press('Shift+Tab');
    expect(await focusedAction(page)).toBe('hand-tool');
  });

  test('U30 arrow keys move through the palette, Home and End jump, and the focus is visible', async ({ page }) => {
    await load(page);
    await tabToPalette(page);
    const first = await focusedAction(page);
    await page.keyboard.press('ArrowDown');
    const second = await focusedAction(page);
    expect(second).not.toBe(first);
    await page.keyboard.press('End');
    const last = await focusedAction(page);
    await page.keyboard.press('ArrowDown');
    expect(await focusedAction(page)).toBe(first);
    await page.keyboard.press('Home');
    expect(await focusedAction(page)).toBe(first);
    await page.keyboard.press('End');
    expect(await focusedAction(page)).toBe(last);
    const outline = await palette(page).locator('.entry:focus-visible').first().evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('U30 Enter on the hand tool activates it; Escape goes back to the canvas', async ({ page }) => {
    await load(page);
    await tabToPalette(page);
    await page.keyboard.press('Enter');
    await expect(palette(page).locator('.entry[data-action="hand-tool"]')).toHaveClass(/highlighted-entry/);
    await expect(palette(page).locator('.entry[data-action="hand-tool"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(activePanel(page).locator('.djs-container > svg')).toBeFocused();
  });

  test('U30 Enter on a create entry puts the element in the middle of the canvas, selected, without the pointer', async ({ page }) => {
    const api = await load(page);
    const before = await api.elementIds();
    await palette(page).locator('.entry[data-action="create.task"]').focus();
    await page.keyboard.press('Enter');
    const created = (await api.elementIds()).filter((id) => !before.includes(id) && id.startsWith('Activity_'));
    expect(created).toHaveLength(1);
    await expect(element(page, created[0]!)).toBeVisible();
    await expect(activePanel(page).locator('.djs-element.selected')).toHaveAttribute('data-element-id', created[0]!);
    // the canvas has the focus again: its keys work on the new task (E edits the label)
    await page.keyboard.press('e');
    await expect(activePanel(page).locator('.djs-direct-editing-parent')).toBeVisible();
  });

  test('U30 the Decision task entry is reachable by keyboard and creates the DMN connector task', async ({ page }) => {
    const api = await load(page);
    await palette(page).locator('.entry[data-action="create.decision-task"]').focus();
    await page.keyboard.press('Space');
    expect(await api.currentXml()).toMatch(/implementation="dmn-connector\.EXECUTE_TABLE"/);
  });
});
