import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, element, menu, openApp } from './support/app';

const stored = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(() => {
    const text = localStorage.getItem('activiti-modeler.layout.v1');
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  });

const minimap = (page: Page) => activePanel(page).locator('.djs-minimap');
const gridPattern = (page: Page) => activePanel(page).locator('.layer-djs-grid rect');

test.describe('U8 minimap and grid', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('U8 the minimap toggles from the View menu and from its own button, and the choice is remembered', async ({ page }) => {
    await expect(minimap(page)).not.toHaveClass(/open/);
    await menu(page, 'View', 'Minimap');
    await expect(minimap(page)).toHaveClass(/open/);
    await expect(minimap(page).locator('.map')).toBeVisible();
    expect((await stored(page))?.['minimapOpen']).toBe(true);

    await page.reload();
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    await expect(minimap(page)).toHaveClass(/open/);
    // the minimap shows the diagram: its map contains the start event
    await expect(minimap(page).locator('.map svg')).toBeVisible();

    // its own button closes it; the layout follows
    await minimap(page).locator('.toggle').click();
    await expect(minimap(page)).not.toHaveClass(/open/);
    await expect.poll(async () => (await stored(page))?.['minimapOpen']).toBe(false);
    await page.reload();
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    await expect(minimap(page)).not.toHaveClass(/open/);
  });

  test('U8 the minimap navigates: a click on the map moves the viewport', async ({ page }) => {
    await menu(page, 'View', 'Minimap');
    const viewport = activePanel(page).locator('.djs-container svg .viewport').first();
    const before = await viewport.getAttribute('transform');
    const map = (await minimap(page).locator('.map').boundingBox())!;
    await page.mouse.click(map.x + map.width - 8, map.y + map.height - 8);
    await expect.poll(async () => viewport.getAttribute('transform')).not.toBe(before);
  });

  test('U8 the grid is on by default, toggles from the View menu and the choice is remembered', async ({ page }) => {
    await expect(gridPattern(page)).toHaveCount(1);
    await menu(page, 'View', 'Grid');
    await expect(gridPattern(page)).toHaveCount(0);
    await expect.poll(async () => (await stored(page))?.['gridVisible']).toBe(false);
    await page.reload();
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    await expect(gridPattern(page)).toHaveCount(0);
    await menu(page, 'View', 'Grid');
    await expect(gridPattern(page)).toHaveCount(1);
  });
});

test.describe('U28 panels and layout', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('U28 Ctrl+B toggles the bottom panel and Ctrl+P the properties panel; the layout is saved', async ({ page }) => {
    await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
    await expect(page.getByTestId('properties-panel')).toBeVisible();

    await page.keyboard.press('Control+B');
    await expect(page.getByTestId('bottom-panel')).toBeVisible();
    await page.keyboard.press('Control+P');
    await expect(page.getByTestId('properties-panel')).toHaveCount(0);
    await expect.poll(async () => await stored(page)).toMatchObject({ bottomOpen: true, propertiesOpen: false });

    await page.reload();
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    await expect(page.getByTestId('bottom-panel')).toBeVisible();
    await expect(page.getByTestId('properties-panel')).toHaveCount(0);
    // the menu shows the state and toggles too
    await menu(page, 'View', 'Properties panel');
    await expect(page.getByTestId('properties-panel')).toBeVisible();
    await menu(page, 'View', 'Bottom panel');
    await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
  });

  test('U28 Ctrl+Alt+P resets the properties panel to its default width and shows it', async ({ page }) => {
    const panel = page.getByTestId('properties-panel');
    const separator = page.getByTestId('resize-properties');
    const box = (await separator.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 98, box.y + 200, { steps: 5 });
    await page.mouse.up();
    expect((await panel.boundingBox())!.width).toBeCloseTo(420, -1);
    await page.keyboard.press('Control+P');
    await page.keyboard.press('Control+Alt+P');
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.width).toBeCloseTo(320, -1);
  });

  test('U28 the panels are resizable with the pointer and the keyboard, within limits, and the sizes are saved', async ({ page }) => {
    const explorer = page.getByTestId('explorer');
    const width = async () => Math.round((await explorer.boundingBox())!.width);
    expect(await width()).toBe(250);

    const separator = page.getByTestId('resize-explorer');
    const box = (await separator.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 82, box.y + 100, { steps: 5 });
    await page.mouse.up();
    expect(await width()).toBe(330);
    await expect.poll(async () => (await stored(page))?.['explorerWidth']).toBe(330);

    // keyboard: arrows move the separator by 16 px
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    expect(await width()).toBe(346);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await width()).toBe(314);

    // limits
    const now = (await separator.boundingBox())!;
    await page.mouse.move(now.x + 2, now.y + 100);
    await page.mouse.down();
    await page.mouse.move(now.x + 900, now.y + 100, { steps: 5 });
    await page.mouse.up();
    // the stored size is limited to 520 px, and a panel never takes more than a third of the window
    await expect.poll(async () => (await stored(page))?.['explorerWidth']).toBe(520);
    const limited = await width();
    expect(limited).toBeLessThanOrEqual(520);
    expect(limited).toBeLessThanOrEqual(Math.ceil(1280 * 0.34));
    expect(limited).toBeGreaterThan(400);

    // the bottom panel: drag up to make it taller
    await page.keyboard.press('Control+B');
    const bottom = page.getByTestId('bottom-panel');
    const h = (await bottom.boundingBox())!.height;
    const sep = (await page.getByTestId('resize-bottom').boundingBox())!;
    await page.mouse.move(sep.x + 100, sep.y + 2);
    await page.mouse.down();
    await page.mouse.move(sep.x + 100, sep.y - 78, { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await bottom.boundingBox())!.height)).toBe(Math.round(h) + 80);

    await page.reload();
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    expect(await width()).toBe(limited);
    expect(Math.round((await page.getByTestId('bottom-panel').boundingBox())!.height)).toBe(Math.round(h) + 80);
  });

  test('U28 the explorer can be hidden from the View menu', async ({ page }) => {
    await menu(page, 'View', 'Project explorer');
    await expect(page.getByTestId('explorer')).toHaveCount(0);
    await expect(element(page, 'StartEvent_1')).toBeVisible();
    await menu(page, 'View', 'Project explorer');
    await expect(page.getByTestId('explorer')).toBeVisible();
  });

  test('U28 the properties slot holds the properties panel and the bottom slot the Problems panel', async ({ page }) => {
    await expect(page.locator('#properties-panel-slot').locator('[data-group-id="group-general"]')).toBeVisible();
    await page.keyboard.press('Control+B');
    await page.getByRole('tab', { name: 'Problems' }).click();
    await expect(page.getByTestId('problems-panel')).toBeVisible();
    await expect(page.getByTestId('status-problems')).toContainText('0 errors');
    await expect(page.getByTestId('status-server')).toContainText('not connected');
    await expect(page.getByTestId('status-target')).toHaveText('Activiti 9.0.0');
  });
});

test.describe('layout storage that cannot be used', () => {
  test('U28 a corrupt saved layout falls back to the default', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('activiti-modeler.layout.v1', '{"explorerWidth": "wide", "bottomOpen": 3, oops'));
    await openApp(page);
    expect(Math.round((await page.getByTestId('explorer').boundingBox())!.width)).toBe(250);
    await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
  });

  test('U28 blocked localStorage does not break the app, the layout then only lasts for the session', async ({ page }) => {
    await page.addInitScript(() => {
      const fail = (): never => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: fail });
    });
    await openApp(page);
    await page.keyboard.press('Control+B');
    await expect(page.getByTestId('bottom-panel')).toBeVisible();
  });
});
