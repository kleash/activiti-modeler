import { expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, activeTabTitle, editorText, idbFiles, menu, openApp, tab } from './support/app';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const treeItem = (page: import('@playwright/test').Page, name: string) => page.getByRole('treeitem', { name, exact: true });

test('U1 explorer shows the project files and opens each in its own tab', async ({ page }) => {
  await expect(page.getByTestId('project-name')).toHaveText('my-project');
  await expect(treeItem(page, 'processes')).toBeVisible();
  await expect(treeItem(page, 'process.bpmn20.xml')).toBeVisible();
  await expect(treeItem(page, 'process-extensions.json')).toBeVisible();
  await expect(treeItem(page, 'project.json')).toBeVisible();
  // the project opened with its process in a tab
  await expect(tab(page, 'process.bpmn20.xml')).toBeVisible();

  await treeItem(page, 'project.json').dblclick();
  await expect(tab(page, 'project.json')).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('text-editor')).toBeVisible();
  expect(await editorText(page, 'text-editor')).toContain('"name": "my-project"');

  // opening a file again shows its tab, it does not open a second one
  await treeItem(page, 'process.bpmn20.xml').dblclick();
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/active/);
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(activePanel(page).getByTestId('bpmn-canvas')).toBeVisible();

  // the extensions file belongs to its process: it opens the process in the JSON view
  await treeItem(page, 'process-extensions.json').dblclick();
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/active/);
  await expect(page.getByTestId('json-view')).toBeVisible();

  // folders collapse
  await treeItem(page, 'processes').click();
  await expect(treeItem(page, 'process.bpmn20.xml')).toBeHidden();
});

test('U1 a tab shows a dirty marker, closing it asks to save, discard or cancel', async ({ page }) => {
  await treeItem(page, 'project.json').dblclick();
  const projectTab = tab(page, 'project.json');
  await expect(projectTab).not.toHaveClass(/dirty/);

  await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await expect(projectTab).toHaveClass(/dirty/);
  await expect(projectTab.getByRole('img', { name: 'unsaved changes' })).toBeVisible();
  await expect(page.getByTestId('file-tree').getByRole('img', { name: 'unsaved changes' })).toBeVisible();
  await expect(page.getByTestId('status-saved')).toContainText('1 file(s) with unsaved changes');

  // cancel keeps the tab
  await page.keyboard.press('Control+W');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toContainText('Save the changes to project.json before closing?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(projectTab).toBeVisible();

  // discard closes it and drops the change
  await page.keyboard.press('Control+W');
  await page.getByTestId('choice-dialog').getByRole('button', { name: "Don't save" }).click();
  await expect(projectTab).toBeHidden();
  const before = (await idbFiles(page))['project.json']!;
  expect(before.endsWith('}\n')).toBe(true);
  await treeItem(page, 'project.json').dblclick();
  await expect(projectTab).not.toHaveClass(/dirty/);

  // save writes the file, then closes
  await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\n');
  await expect(projectTab).toHaveClass(/dirty/);
  await page.keyboard.press('Control+W');
  await page.getByTestId('choice-dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(projectTab).toBeHidden();
  expect((await idbFiles(page))['project.json']).toBe(`${before}\n\n`);
});

test('U1 Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+Shift+T reopens the last closed one', async ({ page }) => {
  await treeItem(page, 'project.json').dblclick();
  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByTestId('template-scenario').click();
  await page.getByTestId('prompt-input').fill('smoke');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'smoke.scenario.json')).toHaveClass(/active/);
  await expect(page.locator('.tab')).toHaveCount(3);

  await page.keyboard.press('Control+Tab');
  expect(await activeTabTitle(page)).toBe('process.bpmn20.xml');
  await page.keyboard.press('Control+Shift+Tab');
  expect(await activeTabTitle(page)).toBe('smoke.scenario.json');
  await page.keyboard.press('Control+Shift+Tab');
  expect(await activeTabTitle(page)).toBe('project.json');

  // close the active tab, then bring it back with the shortcut
  await page.keyboard.press('Control+W');
  await expect(tab(page, 'project.json')).toBeHidden();
  await page.keyboard.press('Control+Shift+T');
  await expect(tab(page, 'project.json')).toHaveClass(/active/);
  // the file menu offers the same
  await page.keyboard.press('Control+W');
  await menu(page, 'File', 'Reopen last closed tab');
  await expect(tab(page, 'project.json')).toBeVisible();
});

async function placeTask(page: import('@playwright/test').Page, at: { x: number; y: number }): Promise<void> {
  await activePanel(page).locator('.djs-palette [data-action="create.task"]').click();
  const canvas = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + at.x, canvas.y + at.y, { steps: 4 });
  await page.mouse.click(canvas.x + at.x, canvas.y + at.y);
  await page.keyboard.press('Escape');
}

test('U1 every tab keeps its own diagram and its own undo history while another tab is shown', async ({ page }) => {
  const tasks = () => activePanel(page).locator('.djs-element.djs-shape[data-element-id^="Activity_"]');
  await placeTask(page, { x: 400, y: 250 });
  await expect(tasks()).toHaveCount(1);

  await menu(page, 'File', 'New file', 'Empty process');
  await page.getByTestId('prompt-input').fill('other');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'other.bpmn20.xml')).toHaveClass(/active/);
  await expect(tasks()).toHaveCount(0);
  await placeTask(page, { x: 300, y: 200 });
  await placeTask(page, { x: 500, y: 200 });
  await expect(tasks()).toHaveCount(2);

  // back to the first: its task is there, and undo undoes its own last step, not the other tab's
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expect(tasks()).toHaveCount(1);
  await page.keyboard.press('Control+Z');
  await expect(tasks()).toHaveCount(0);
  await tab(page, 'other.bpmn20.xml').getByRole('tab').click();
  await expect(tasks()).toHaveCount(2);
  await page.keyboard.press('Control+Z');
  await expect(tasks()).toHaveCount(1);
  // the diagrams of hidden tabs are not visible (one canvas at a time)
  await expect(page.locator('.editor-panel:not(.active) .djs-container svg .djs-element').first()).toBeHidden();
});
