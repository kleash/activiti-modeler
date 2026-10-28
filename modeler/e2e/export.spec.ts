import { readFile } from 'node:fs/promises';

import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, centreOf, menu, processXml, element } from './support/app';
import { ModelerApi } from './support/modelerApi';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function load(page: Page): Promise<void> {
  const api = await ModelerApi.open(page);
  await api.importXml(
    processXml('export', [
      { id: 'start', type: 'startEvent', name: 'Begin', x: 150, y: 140 },
      { id: 'task', type: 'userTask', name: 'Review it', x: 250, y: 118 },
    ]),
  );
  await expect(element(page, 'task')).toBeVisible();
}

async function download(page: Page, action: () => Promise<void>, testInfo: import('@playwright/test').TestInfo): Promise<{ name: string; bytes: Buffer }> {
  const promise = page.waitForEvent('download');
  await action();
  const d = await promise;
  const path = testInfo.outputPath(d.suggestedFilename());
  await d.saveAs(path);
  return { name: d.suggestedFilename(), bytes: await readFile(path) };
}

test('U13 export as SVG downloads the diagram as an SVG document', async ({ page }, testInfo) => {
  await load(page);
  const file = await download(page, () => menu(page, 'File', 'Export diagram as SVG'), testInfo);
  expect(file.name).toBe('process.svg');
  const svg = file.bytes.toString('utf8');
  expect(svg).toMatch(/^<\?xml[^>]*\?>\s*<!-- created with bpmn-js|^<svg|^<\?xml/);
  expect(svg).toContain('<svg');
  expect(svg).toContain('data-element-id="task"');
  expect(svg).toContain('Review it');
  expect(svg).toContain('data-element-id="start"');
  // it is a document that parses
  const parsed = await page.evaluate((text) => new DOMParser().parseFromString(text, 'image/svg+xml').getElementsByTagName('parsererror').length, svg);
  expect(parsed).toBe(0);
});

test('U13 export as PNG downloads a PNG image of the diagram', async ({ page }, testInfo) => {
  await load(page);
  const file = await download(page, () => menu(page, 'File', 'Export diagram as PNG'), testInfo);
  expect(file.name).toBe('process.png');
  expect([...file.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = file.bytes.readUInt32BE(16);
  const height = file.bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(100);
  expect(height).toBeGreaterThan(50);
  // not an empty image: the PNG decodes in the browser and has drawn pixels
  const drawn = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque += 1;
    return opaque;
  }, file.bytes.toString('base64'));
  expect(drawn).toBeGreaterThan(500);
});

test('U13 Ctrl+Shift+E asks for the format', async ({ page }, testInfo) => {
  await load(page);
  await page.getByRole('main').or(page.locator('body')).first().click({ position: { x: 5, y: 60 } }).catch(() => undefined);
  await activePanel(page).locator('.djs-container > svg').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toContainText('Export as image');
  const file = await download(page, () => dialog.getByRole('button', { name: 'SVG' }).click(), testInfo);
  expect(file.name).toBe('process.svg');
});

test('U13 copy as image (Ctrl+Shift+C) puts the selection on the clipboard as a PNG', async ({ page }) => {
  await load(page);
  const c = await centreOf(page, 'task');
  await page.mouse.click(c.x, c.y);
  await expect(activePanel(page).locator('.djs-element.selected')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+C');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)))
    .toContain('image/png');
  const size = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]!;
    return (await item.getType('image/png')).size;
  });
  expect(size).toBeGreaterThan(200);
});

test('U13 the Edit menu offers copy as image only with a selection, and the export items need a diagram', async ({ page }) => {
  await load(page);
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy selection as image' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click((await centreOf(page, 'task')).x, (await centreOf(page, 'task')).y);
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy selection as image' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Copy selection as image' }).click();
  await expect
    .poll(() => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)))
    .toContain('image/png');

  // in the XML view there is no diagram to export
  await page.getByRole('tablist', { name: 'Show the process as' }).getByRole('tab', { name: 'XML' }).click();
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Export diagram as SVG' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Export diagram as PNG' })).toBeDisabled();
  await page.keyboard.press('Escape');
});
