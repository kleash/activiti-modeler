import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, idbDrafts, idbFiles, menu, minCoordinates, openApp, processXml, tab } from './support/app';
import { ModelerApi } from './support/modelerApi';

const treeItem = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });

async function placeTask(page: Page, at: { x: number; y: number }): Promise<void> {
  await activePanel(page).locator('.djs-palette [data-action="create.task"]').click();
  const canvas = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + at.x, canvas.y + at.y, { steps: 4 });
  await page.mouse.click(canvas.x + at.x, canvas.y + at.y);
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('U27 save writes the process and its extensions file, and clears the dirty marker', async ({ page }) => {
  await placeTask(page, { x: 450, y: 260 });
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);
  const before = await idbFiles(page);
  expect(before['processes/process.bpmn20.xml']).not.toContain('bpmn:task');

  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  await expect(page.getByTestId('status-saved')).toHaveText('All changes saved');
  const after = await idbFiles(page);
  expect(after['processes/process.bpmn20.xml']).toContain('<bpmn:task id="Activity_');
  expect(after['processes/process.bpmn20.xml']).toContain('isExecutable="true"');
  expect(JSON.parse(after['processes/process-extensions.json']!).extensions).toHaveProperty('Process_1');
  expect(await idbDrafts(page)).toEqual({});
});

test('U27 save as writes a new process file and extensions file and leaves the original as it was saved', async ({ page }) => {
  // a second process in the project, to try a name that is taken
  await menu(page, 'File', 'New file', 'Empty process');
  await page.getByTestId('prompt-input').fill('taken');
  await page.getByTestId('prompt-confirm').click();
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await placeTask(page, { x: 450, y: 260 });
  const original = (await idbFiles(page))['processes/process.bpmn20.xml']!;

  await page.keyboard.press('Control+Shift+S');
  const dialog = page.getByTestId('dialog');
  await expect(dialog).toContainText('Save as');
  // the suggestion is a free name next to the original
  await expect(page.getByTestId('prompt-input')).toHaveValue('processes/process-copy.bpmn20.xml');

  // an existing file, another file type and a bad path are refused
  await page.getByTestId('prompt-input').fill('processes/taken.bpmn20.xml');
  await expect(page.getByTestId('prompt-help')).toContainText('already exists');
  await page.getByTestId('prompt-input').fill('processes/order.json');
  await expect(page.getByTestId('prompt-help')).toContainText('same type');
  await page.getByTestId('prompt-input').fill('../order.bpmn20.xml');
  await expect(page.getByTestId('prompt-confirm')).toBeDisabled();

  await page.getByTestId('prompt-input').fill('processes/order.bpmn20.xml');
  await page.getByTestId('prompt-confirm').click();

  // the tab now edits the new file
  await expect(tab(page, 'order.bpmn20.xml')).toHaveClass(/active/);
  await expect(tab(page, 'process.bpmn20.xml')).toHaveCount(0);
  await expect(tab(page, 'order.bpmn20.xml')).not.toHaveClass(/dirty/);
  await expect(tab(page, 'taken.bpmn20.xml')).toBeVisible();
  const files = await idbFiles(page);
  expect(Object.keys(files).sort()).toEqual([
    'processes/order-extensions.json',
    'processes/order.bpmn20.xml',
    'processes/process-extensions.json',
    'processes/process.bpmn20.xml',
    'processes/taken-extensions.json',
    'processes/taken.bpmn20.xml',
    'project.json',
  ]);
  expect(files['processes/order.bpmn20.xml']).toContain('<bpmn:task id="Activity_');
  expect(JSON.parse(files['processes/order-extensions.json']!).id).toBe('process-order');
  // the original was not touched, and keeps no draft
  expect(files['processes/process.bpmn20.xml']).toBe(original);
  expect(await idbDrafts(page)).toEqual({});
  await expect(treeItem(page, 'order.bpmn20.xml')).toBeVisible();
  // both files declare the same process id: the user is told
  await expect(page.getByTestId('toasts')).toContainText('The process id is also used by processes/process.bpmn20.xml');

  // later saves go to the new file
  await placeTask(page, { x: 600, y: 120 });
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'order.bpmn20.xml')).not.toHaveClass(/dirty/);
  expect(((await idbFiles(page))['processes/order.bpmn20.xml']!.match(/<bpmn:task /g) ?? []).length).toBe(2);
  expect((await idbFiles(page))['processes/process.bpmn20.xml']).toBe(original);
});

test('U27 save as works for text files too', async ({ page }) => {
  await treeItem(page, 'project.json').dblclick();
  await page.keyboard.press('Control+Shift+S');
  await page.getByTestId('prompt-input').fill('project-backup.json');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'project-backup.json')).toHaveClass(/active/);
  const files = await idbFiles(page);
  expect(files['project-backup.json']).toBe(files['project.json']);
});

test('U27 save all saves every tab with unsaved changes', async ({ page }) => {
  // tab 1: a diagram change; tab 2: a text change; tab 3: a new file from a template stays clean
  await placeTask(page, { x: 450, y: 260 });
  await treeItem(page, 'project.json').dblclick();
  await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n');
  await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);
  await expect(page.getByTestId('status-saved')).toContainText('unsaved');

  await page.keyboard.press('Control+Alt+S');
  await expect(tab(page, 'project.json')).not.toHaveClass(/dirty/);
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  await expect(page.getByTestId('status-saved')).toHaveText('All changes saved');
  const files = await idbFiles(page);
  expect(files['project.json']!.endsWith('}\n\n\n')).toBe(true);
  expect(files['processes/process.bpmn20.xml']).toContain('<bpmn:task id="Activity_');
  expect(await idbDrafts(page)).toEqual({});

  // and from the menu
  await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
  await page.keyboard.type('x');
  await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
  await menu(page, 'File', 'Save all');
  await expect(tab(page, 'project.json')).not.toHaveClass(/dirty/);
});

test('U27 / U31 saving moves the diagram to the origin without moving it on the canvas', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.importXml(
    processXml('far', [
      { id: 'start', type: 'startEvent', x: 500, y: 300 },
      { id: 'task', type: 'task', x: 640, y: 278 },
    ]),
  );
  const box = (await page.locator('.editor-panel.active .djs-element[data-element-id="task"] .djs-visual').boundingBox())!;
  await placeTask(page, { x: 200, y: 400 });
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  const xml = (await idbFiles(page))['processes/process.bpmn20.xml']!;
  expect(minCoordinates(xml)).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(minCoordinates(xml).x).toBe(0);
  expect(minCoordinates(xml).y).toBe(0);
  // the canvas shows the diagram where it was
  const after = (await page.locator('.editor-panel.active .djs-element[data-element-id="task"] .djs-visual').boundingBox())!;
  expect(Math.abs(after.x - box.x)).toBeLessThan(1);
  expect(Math.abs(after.y - box.y)).toBeLessThan(1);
});
