import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The canvas is ready once bpmn-js has rendered the initial diagram.
  await page.locator('.djs-container svg .djs-element').first().waitFor();
});

test('loads the app and renders the start event of the initial diagram', async ({ page }) => {
  await expect(page).toHaveTitle('Activiti Modeler');
  await expect(page.getByTestId('bpmn-canvas')).toBeVisible();

  const startEvent = page.locator('.djs-element[data-element-id="StartEvent_1"]');
  await expect(startEvent).toBeVisible();
  const box = await startEvent.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});

test('the canvas fills the editor area between the explorer, the properties panel, the tab bar and the status bar', async ({ page }) => {
  const canvas = await page.getByTestId('bpmn-canvas').boundingBox();
  const area = await page.getByTestId('editor-area').boundingBox();
  const status = await page.getByTestId('status-bar').boundingBox();
  const viewport = page.viewportSize();
  expect(canvas).not.toBeNull();
  expect(area).not.toBeNull();
  expect(status).not.toBeNull();
  expect(viewport).not.toBeNull();
  // the canvas is the editor body: the whole editor area width, and from the tab bar down to the view switch
  expect(canvas!.x).toBe(area!.x);
  expect(canvas!.width).toBe(area!.width);
  expect(canvas!.y).toBe(area!.y);
  expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(status!.y);
  // and the shell fills the window: the status bar is the last row
  expect(status!.y + status!.height).toBe(viewport!.height);
  expect(canvas!.height).toBeGreaterThan(viewport!.height / 2);
  expect(canvas!.width).toBeGreaterThan(viewport!.width / 2);
});

// bpmn.io license: the watermark must stay visible and must not be covered by other UI.
test('the bpmn.io watermark is visible and not overlapped', async ({ page }) => {
  const watermark = page.locator('.bjs-powered-by');
  await expect(watermark).toBeVisible();

  const box = await watermark.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  const topElementIsWatermark = await watermark.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top !== null && (top === el || el.contains(top));
  });
  expect(topElementIsWatermark).toBe(true);

  const opacity = await watermark.evaluate((el) => {
    let value = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      value *= Number(getComputedStyle(node).opacity);
    }
    return value;
  });
  expect(opacity).toBe(1);
});
