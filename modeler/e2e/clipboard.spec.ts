import { expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, centreOf, element, menu, pasteAt, processXml, tab } from './support/app';
import { ModelerApi } from './support/modelerApi';

const viewButton = (page: import('@playwright/test').Page, name: string) => page.getByRole('tablist', { name: 'Show the process as' }).getByRole('tab', { name });

async function copyFromFirstTab(page: import('@playwright/test').Page): Promise<void> {
  const api = await ModelerApi.open(page);
  await api.importXml(
    processXml('source', [
      { id: 'a', type: 'task', name: 'Plain task', x: 200, y: 100 },
      { id: 'u', type: 'userTask', name: 'Review it', x: 420, y: 100 },
    ]),
  );
  await expect(element(page, 'u')).toBeVisible();
  // a user task has MAP_ALL in the extensions (ADR 0006): put one on the imported task too
  await api.setExtensions({ elementId: 'u', mapping: { mappingType: 'MAP_ALL' } });
  const c = await centreOf(page, 'u');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Control+C');
}

async function pasteIntoNewTab(page: import('@playwright/test').Page): Promise<void> {
  await menu(page, 'File', 'New file', 'Empty process');
  await page.getByTestId('prompt-input').fill('target');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'target.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'StartEvent_target')).toBeVisible();
  const box = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  await pasteAt(page, { x: box.x + box.width - 250, y: box.y + box.height - 200 });
}

test.describe('with clipboard access', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('U6 pasting in another tab takes the mappings of the copied element along (system clipboard)', async ({ page }) => {
    await copyFromFirstTab(page);
    await pasteIntoNewTab(page);
    const pasted = activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Review it' });
    await expect(pasted).toHaveCount(1);
    const id = (await pasted.getAttribute('data-element-id'))!;
    await viewButton(page, 'Extensions JSON').click();
    const text = await activePanel(page).getByTestId('json-editor').locator('.cm-content').evaluate((el) => Array.from(el.querySelectorAll('.cm-line')).map((l) => l.textContent).join('\n'));
    const mappings = JSON.parse(text).extensions.target.mappings;
    expect(mappings[id]).toEqual({ mappingType: 'MAP_ALL' });
    // the source tab keeps its own entry under its own id
    await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
    await viewButton(page, 'Extensions JSON').click();
    const source = await activePanel(page).getByTestId('json-editor').locator('.cm-content').evaluate((el) => Array.from(el.querySelectorAll('.cm-line')).map((l) => l.textContent).join('\n'));
    expect(Object.keys(JSON.parse(source).extensions.source.mappings)).toEqual(['u']);
  });
});

test.describe('without clipboard access', () => {
  test.use({ permissions: [], allowedErrors: [/native-copy-paste|clipboard|Clipboard|copy-as-image/i] });

  test('U6 copy and paste between tabs still works: the page keeps its own clipboard, and says so', async ({ page }) => {
    await copyFromFirstTab(page);
    // the refused write switches the system clipboard off for this page
    await expect(page.getByTestId('toasts')).toContainText('System clipboard not available');
    await pasteIntoNewTab(page);
    await expect(activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Review it' })).toHaveCount(1);
    await expect(tab(page, 'target.bpmn20.xml')).toHaveClass(/dirty/);
  });

  test('U13 copy as image says why it failed instead of failing silently', async ({ page }) => {
    await copyFromFirstTab(page);
    await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
    const c = await centreOf(page, 'a');
    await page.mouse.click(c.x, c.y);
    await menu(page, 'Edit', 'Copy selection as image');
    await expect(page.getByTestId('toasts')).toContainText('Could not run "copyAsImage"');
  });
});
