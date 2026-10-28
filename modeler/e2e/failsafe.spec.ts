import { expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, dropFiles, editorText, element, idbFiles, openApp, processXml, setEditorText, tab } from './support/app';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const treeItem = (page: import('@playwright/test').Page, name: string) => page.getByRole('treeitem', { name, exact: true });

test('U25 a BPMN file that cannot be opened gets the fail-safe error tab, and can be fixed as text', async ({ page }) => {
  await dropFiles(page, [{ name: 'broken.bpmn20.xml', content: 'this is not a BPMN file at all' }]);
  await expect(tab(page, 'broken.bpmn20.xml')).toHaveClass(/active/);
  const error = page.getByTestId('error-tab');
  await expect(error).toBeVisible();
  await expect(error).toContainText('broken.bpmn20.xml could not be opened');
  await expect(error).toContainText('The file is unchanged');
  await expect(error.locator('.error-detail')).not.toBeEmpty();
  await expect(tab(page, 'broken.bpmn20.xml').getByRole('img', { name: 'could not be opened' })).toBeVisible();
  // nothing was lost: the file is in the project as it came
  expect((await idbFiles(page))['processes/broken.bpmn20.xml']).toBe('this is not a BPMN file at all');
  // the other tabs are unaffected
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expect(element(page, 'StartEvent_1')).toBeVisible();
  await tab(page, 'broken.bpmn20.xml').getByRole('tab').click();

  // the way out: open it as text, fix it, open it in the diagram editor again
  await page.getByRole('button', { name: 'Open processes/broken.bpmn20.xml as text' }).click();
  await expect(error).toHaveCount(0);
  expect(await editorText(page, 'text-editor')).toBe('this is not a BPMN file at all');
  await expect(page.getByRole('note')).toContainText('This file is open as text');
  await setEditorText(page, 'text-editor', processXml('fixed', [{ id: 'begin', type: 'startEvent', x: 200, y: 120 }]));
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'broken.bpmn20.xml')).not.toHaveClass(/dirty/);
  await page.getByRole('button', { name: /Open it in the diagram editor/ }).click();
  await expect(element(page, 'begin')).toBeVisible();
  await expect(page.getByTestId('error-tab')).toHaveCount(0);
});

test('U25 an extensions file that is not valid JSON fails the process tab, with a way to fix the JSON', async ({ page }) => {
  await dropFiles(page, [
    { name: 'order.bpmn20.xml', content: processXml('order', [{ id: 'begin', type: 'startEvent', x: 200, y: 120 }]) },
    { name: 'order-extensions.json', content: '{ "id": "x", "extensions": {,} }' },
  ]);
  const error = page.getByTestId('error-tab');
  await expect(error).toBeVisible();
  await expect(error).toContainText('order.bpmn20.xml could not be opened');
  await expect(error).toContainText('processes/order-extensions.json cannot be read');
  await error.getByRole('button', { name: 'Open processes/order-extensions.json as text' }).click();
  await expect(tab(page, 'order-extensions.json')).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('text-editor').locator('.cm-lintRange-error').first()).toBeVisible();
  await setEditorText(page, 'text-editor', '{ "id": "order", "extensions": { "order": { "properties": {}, "mappings": {}, "constants": {} } } }');
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'order-extensions.json')).not.toHaveClass(/dirty/);
  // reopen the process: close the failed tab, open the file again
  await tab(page, 'order.bpmn20.xml').getByRole('button', { name: 'Close order.bpmn20.xml' }).click();
  await treeItem(page, 'order.bpmn20.xml').dblclick();
  await expect(element(page, 'begin')).toBeVisible();
});

test('U25 the import warnings panel lists what the import found, per file', async ({ page }) => {
  // a diagram element for a process element that does not exist, and an extensions file with a field the runtime does not know
  const xml = processXml('warned', [{ id: 'begin', type: 'startEvent', x: 200, y: 120 }]).replace(
    '</bpmndi:BPMNPlane>',
    '  <bpmndi:BPMNShape id="ghost_di" bpmnElement="ghost"><dc:Bounds x="400" y="100" width="100" height="80" /></bpmndi:BPMNShape>\n    </bpmndi:BPMNPlane>',
  );
  await dropFiles(page, [
    { name: 'warned.bpmn20.xml', content: xml },
    { name: 'warned-extensions.json', content: JSON.stringify({ id: 'warned', name: 'APA style', type: 'PROCESS', extensions: { warned: { properties: {}, mappings: {}, constants: {} } } }) },
  ]);
  await expect(tab(page, 'warned.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'begin')).toBeVisible();
  // the diagram opened: warnings, not an error tab
  await expect(page.getByTestId('error-tab')).toHaveCount(0);
  await page.keyboard.press('Control+B');
  const panel = page.getByTestId('bottom-panel');
  await expect(panel.getByTestId('warnings-tab')).toContainText('Import warnings (');
  await expect(panel.getByRole('heading', { name: 'processes/warned.bpmn20.xml' })).toBeVisible();
  const items = panel.getByTestId('warning-list').locator('li');
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  const text = await panel.getByTestId('warning-list').innerText();
  expect(text).toMatch(/ghost/);
  expect(text).toMatch(/\$\.name/);
  expect(text).toMatch(/\$\.type/);
  // a file without warnings has none
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expect(panel).toContainText('Import warnings (');
});
