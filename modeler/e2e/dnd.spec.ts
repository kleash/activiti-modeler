import { expect } from '@playwright/test';
import { test } from './support/test';
import { strToU8, zipSync } from 'fflate';

import { dropFiles, element, idbFiles, idbProjects, openApp, processXml, tab } from './support/app';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const treeItem = (page: import('@playwright/test').Page, name: string) => page.getByRole('treeitem', { name, exact: true });

test('U26 the page shows a drop target while files are dragged over it', async ({ page }) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'a.json'));
    document.querySelector('.shell')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await expect(page.getByTestId('drop-overlay')).toContainText('Drop files or a project zip to import');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'a.json'));
    document.querySelector('.shell')!.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
});

test('U26 dropped BPMN, extensions, DMN, scenario and connector files go to the folder of their kind and open', async ({ page }) => {
  const bpmn = processXml('dropped', [{ id: 'begin', type: 'startEvent', name: 'Dropped', x: 200, y: 120 }]);
  const ext = JSON.stringify({ id: 'process-dropped', extensions: { dropped: { properties: {}, mappings: {}, constants: {} } } }, null, 2);
  await dropFiles(page, [
    { name: 'dropped.bpmn', content: bpmn },
    { name: 'dropped-extensions.json', content: ext },
    { name: 'rules.dmn', content: '<definitions/>' },
    { name: 'smoke.scenario.json', content: '{"name":"smoke"}' },
    { name: 'crm.json', content: '{"name":"crm"}' },
  ]);
  // the process opens in a tab: a `.bpmn` file is stored with the name Activiti's auto-deployment expects
  await expect(tab(page, 'dropped.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'begin')).toBeVisible();
  await expect(page.getByTestId('toasts')).toContainText('Imported 5 file(s)');
  const files = await idbFiles(page);
  expect(files['processes/dropped.bpmn20.xml']).toBe(bpmn);
  expect(files['processes/dropped-extensions.json']).toBe(ext);
  expect(files['processes/rules.dmn']).toBe('<definitions/>');
  expect(files['scenarios/smoke.scenario.json']).toBe('{"name":"smoke"}');
  expect(files['connectors/crm.json']).toBe('{"name":"crm"}');
  for (const name of ['dropped.bpmn20.xml', 'dropped-extensions.json', 'rules.dmn', 'smoke.scenario.json', 'crm.json']) await expect(treeItem(page, name)).toBeVisible();
});

test('U26 dropping a file whose name exists keeps both: the process and its extensions get the next free name together', async ({ page }) => {
  const bpmn = processXml('twice', [{ id: 'begin', type: 'startEvent', x: 200, y: 120 }]);
  const ext = '{"id":"twice","extensions":{"twice":{"properties":{},"mappings":{},"constants":{}}}}';
  await dropFiles(page, [{ name: 'twice.bpmn20.xml', content: bpmn }, { name: 'twice-extensions.json', content: ext }]);
  await expect(tab(page, 'twice.bpmn20.xml')).toBeVisible();
  await dropFiles(page, [{ name: 'twice.bpmn20.xml', content: bpmn.replace('Definitions_twice', 'Definitions_twice2') }, { name: 'twice-extensions.json', content: ext }]);
  await expect(tab(page, 'twice-2.bpmn20.xml')).toHaveClass(/active/);
  const files = await idbFiles(page);
  expect(Object.keys(files).filter((p) => p.includes('twice')).sort()).toEqual(['processes/twice-2-extensions.json', 'processes/twice-2.bpmn20.xml', 'processes/twice-extensions.json', 'processes/twice.bpmn20.xml']);
  expect(files['processes/twice.bpmn20.xml']).toBe(bpmn);
});

test('U26 a dropped project zip becomes a new project and replaces the open one after asking about unsaved changes', async ({ page }) => {
  const project = {
    'project.json': '{\n  "name": "from-zip",\n  "version": "2.0.0"\n}\n',
    'processes/zipped.bpmn20.xml': processXml('zipped', [{ id: 'first', type: 'startEvent', x: 120, y: 100 }]),
    'processes/zipped-extensions.json': '{"id":"process-zipped","extensions":{"zipped":{"properties":{},"mappings":{},"constants":{}}}}\n',
    'connectors/mailer.json': '{"name":"mailer"}\n',
  };
  // zipped like "compress folder" does it: inside a wrapper folder
  const zip = zipSync(Object.fromEntries(Object.entries(project).map(([path, content]) => [`from-zip/${path}`, strToU8(content)])));

  // unsaved work in the open project: the import asks first
  await page.getByRole('treeitem', { name: 'project.json', exact: true }).dblclick();
  await page.locator('.editor-panel.active').getByTestId('text-editor').locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n');
  await dropFiles(page, [{ name: 'export.zip', content: Buffer.from(zip), type: 'application/zip' }]);
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toContainText('have unsaved changes');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await idbProjects(page)).toEqual(['my-project']);

  await dropFiles(page, [{ name: 'export.zip', content: Buffer.from(zip), type: 'application/zip' }]);
  await page.getByTestId('choice-dialog').getByRole('button', { name: "Don't save" }).click();
  await expect(page.getByTestId('project-name')).toHaveText('from-zip');
  await expect(page.getByTestId('toasts')).toContainText('Imported 4 file(s) as project "from-zip"');
  await expect(page.getByTestId('toasts')).toContainText('Removed the folder "from-zip" that wrapped the project');
  expect(await idbFiles(page)).toEqual(project);
  expect(await idbProjects(page)).toEqual(['from-zip', 'my-project']);
  // the first process of the project opened
  await expect(tab(page, 'zipped.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'first')).toBeVisible();
  // the old project is as it was saved
  expect(Object.keys(await idbFiles(page, 'my-project')).sort()).toEqual(['processes/process-extensions.json', 'processes/process.bpmn20.xml', 'project.json']);
  expect((await idbFiles(page, 'my-project'))['project.json']!.endsWith('}\n')).toBe(true);
});

test('U26 files that are not part of a project are skipped with a message, a zip without project files is refused', async ({ page }) => {
  await dropFiles(page, [{ name: 'logo.png', content: Buffer.from([137, 80, 78, 71]), type: 'image/png' }]);
  await expect(page.getByTestId('toasts')).toContainText('Skipped 1 file(s) that are not project files');
  await expect(treeItem(page, 'logo.png')).toHaveCount(0);

  const empty = zipSync({ 'logo.png': new Uint8Array([137, 80, 78, 71]) });
  await dropFiles(page, [{ name: 'images.zip', content: Buffer.from(empty), type: 'application/zip' }]);
  await expect(page.getByTestId('alert-dialog')).toContainText('Nothing to import');
  await page.getByTestId('alert-dialog').getByRole('button', { name: 'OK' }).click();
  expect(await idbProjects(page)).toEqual(['my-project']);

  await dropFiles(page, [{ name: 'broken.zip', content: 'not a zip', type: 'application/zip' }]);
  await expect(page.getByTestId('alert-dialog')).toContainText('Cannot import the zip');
  await expect(page.getByTestId('alert-dialog')).toContainText('Not a readable zip');
  await page.getByTestId('alert-dialog').getByRole('button', { name: 'OK' }).click();
});
