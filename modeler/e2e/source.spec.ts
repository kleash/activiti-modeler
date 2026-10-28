import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, editorText, element, idbFiles, menu, openApp, setEditorText, tab } from './support/app';

const viewButton = (page: Page, name: string) => page.getByRole('tablist', { name: 'Show the process as' }).getByRole('tab', { name });

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

test('U10 the XML view shows the process, and an edit applied back changes the canvas', async ({ page }) => {
  await viewButton(page, 'XML').click();
  await expect(page.getByTestId('xml-view')).toBeVisible();
  await expect(page.getByTestId('xml-status')).toHaveText('In sync with the diagram');
  const xml = await editorText(page, 'xml-editor');
  expect(xml).toContain('<bpmn:process id="Process_1" isExecutable="true">');

  const edited = xml.replace('<bpmn:definitions ', '<bpmn:definitions xmlns:activiti="http://activiti.org/bpmn" ').replace(
    '<bpmn:startEvent id="StartEvent_1" />',
    '<bpmn:startEvent id="StartEvent_1" />\n    <bpmn:userTask id="Task_FromXml" name="From the XML" activiti:assignee="kermit" />',
  ).replace(
    '</bpmndi:BPMNPlane>',
    '  <bpmndi:BPMNShape id="Task_FromXml_di" bpmnElement="Task_FromXml"><dc:Bounds x="300" y="137" width="100" height="80" /></bpmndi:BPMNShape>\n    </bpmndi:BPMNPlane>',
  );
  expect(edited).not.toBe(xml);
  await setEditorText(page, 'xml-editor', edited);
  await expect(page.getByTestId('xml-status')).toHaveText('Unapplied changes');
  await expect(page.getByTestId('xml-apply')).toBeEnabled();
  // nothing changed on the canvas yet, and the tab is not dirty
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);

  await page.getByTestId('xml-apply').click();
  await expect(page.getByTestId('xml-status')).toHaveText('Applied to the diagram');
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);

  await viewButton(page, 'Diagram').click();
  await expect(element(page, 'Task_FromXml')).toBeVisible();
  await expect(element(page, 'Task_FromXml')).toContainText('From the XML');

  // it is part of the model: save, and the file has the task with its Activiti attribute
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  expect((await idbFiles(page))['processes/process.bpmn20.xml']).toMatch(/<bpmn:userTask id="Task_FromXml" name="From the XML" activiti:assignee="kermit"/);
});

test('U10 leaving the XML view applies pending edits; the source follows later diagram changes', async ({ page }) => {
  await placeTask(page, { x: 400, y: 250 });
  await viewButton(page, 'XML').click();
  expect(await editorText(page, 'xml-editor')).toContain('<bpmn:task id="Activity_');
  await viewButton(page, 'Diagram').click();
  await expect(element(page, 'StartEvent_1')).toBeVisible();
  await viewButton(page, 'XML').click();
  const xml = await editorText(page, 'xml-editor');
  await setEditorText(page, 'xml-editor', xml.replace('name="" ', '').replace('<bpmn:startEvent id="StartEvent_1" />', '<bpmn:startEvent id="StartEvent_1" name="Begin" />'));
  // switching to the diagram applies the edit
  await viewButton(page, 'Diagram').click();
  await expect(element(page, 'StartEvent_1')).toBeVisible();
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="StartEvent_1_label"], .editor-panel.active .djs-element[data-element-id="StartEvent_1"]').first()).toBeVisible();
  await viewButton(page, 'XML').click();
  expect(await editorText(page, 'xml-editor')).toContain('name="Begin"');
});

test('U10 XML that does not parse is marked with its position and never reaches the canvas', async ({ page }) => {
  await viewButton(page, 'XML').click();
  const xml = await editorText(page, 'xml-editor');
  const broken = xml.replace('<bpmn:startEvent id="StartEvent_1" />', '<bpmn:startEvent id="StartEvent_1" name=Begin />');
  await setEditorText(page, 'xml-editor', broken);
  await page.getByTestId('xml-apply').click();
  await expect(page.getByTestId('xml-status')).toContainText('The XML does not parse');
  await expect(page.getByTestId('xml-status')).toContainText('not well-formed');
  // a marker on the line of the error (the start event is on line 5 of the template XML)
  const marker = page.getByTestId('xml-editor').locator('.cm-lintRange-error');
  await expect(marker.first()).toBeVisible();
  await expect(page.getByTestId('xml-editor').locator('.cm-lint-marker-error').first()).toBeVisible();
  const markedLine = await page.getByTestId('xml-editor').locator('.cm-line', { has: page.locator('.cm-lintRange-error') }).first().innerText();
  expect(markedLine).toContain('StartEvent_1');

  // leaving the view with the error is refused, saving is refused with the reason
  await viewButton(page, 'Diagram').click();
  await expect(page.getByTestId('xml-view')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('alert-dialog')).toContainText('The XML source has errors');
  await page.getByTestId('alert-dialog').getByRole('button', { name: 'OK' }).click();
  expect((await idbFiles(page))['processes/process.bpmn20.xml']).not.toContain('name=Begin');

  // revert, and the canvas still has the diagram
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(page.getByTestId('xml-status')).toHaveText('Reverted to the diagram');
  await viewButton(page, 'Diagram').click();
  await expect(element(page, 'StartEvent_1')).toBeVisible();
});

test('U10 XML that parses but breaks a serializer guarantee applies, and saving is refused with the reason', async ({ page }) => {
  await viewButton(page, 'XML').click();
  const xml = await editorText(page, 'xml-editor');
  const foreign = xml
    .replace('<bpmn:definitions ', '<bpmn:definitions xmlns:camunda="http://camunda.org/schema/1.0/bpmn" ')
    .replace('<bpmn:startEvent id="StartEvent_1" />', '<bpmn:startEvent id="StartEvent_1" camunda:asyncBefore="true" />');
  expect(foreign).not.toBe(xml);
  await setEditorText(page, 'xml-editor', foreign);
  await page.getByTestId('xml-apply').click();
  await expect(page.getByTestId('xml-status')).toHaveText('Applied to the diagram');
  await page.keyboard.press('Control+S');
  const dialog = page.getByTestId('alert-dialog');
  await expect(dialog).toContainText('Cannot save process.bpmn20.xml');
  await expect(dialog).toContainText('FOREIGN_ATTRIBUTE');
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect((await idbFiles(page))['processes/process.bpmn20.xml']).not.toContain('camunda');
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);
});

test('U10 the extensions JSON view shows the store, and follows changes made on the diagram', async ({ page }) => {
  await viewButton(page, 'Extensions JSON').click();
  expect(JSON.parse(await editorText(page, 'json-editor')).extensions.Process_1).toEqual({ properties: {}, mappings: {}, constants: {} });
  await viewButton(page, 'Diagram').click();

  // a task replaced by a user task gets MAP_ALL (ADR 0006): the entry appears in the JSON, keyed by the element id
  await placeTask(page, { x: 400, y: 250 });
  const taskId = (await activePanel(page).locator('.djs-element.djs-shape[data-element-id^="Activity_"]').first().getAttribute('data-element-id'))!;
  const box = (await element(page, taskId).locator('.djs-visual').first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await activePanel(page).locator('.djs-context-pad [data-action="replace"]').click();
  await page.locator('.djs-popup').getByText('User task', { exact: true }).click();
  await expect(element(page, taskId).locator('.djs-visual')).toBeVisible();

  await viewButton(page, 'Extensions JSON').click();
  const doc = JSON.parse(await editorText(page, 'json-editor'));
  expect(doc.extensions.Process_1.mappings[taskId]).toEqual({ mappingType: 'MAP_ALL' });

  // and an element deleted on the diagram takes its entry with it, while the JSON view is open
  await menu(page, 'Edit', 'Undo');
  await expect.poll(async () => JSON.parse(await editorText(page, 'json-editor')).extensions.Process_1.mappings).toEqual({});
  await menu(page, 'Edit', 'Redo');
  await expect.poll(async () => Object.keys(JSON.parse(await editorText(page, 'json-editor')).extensions.Process_1.mappings)).toEqual([taskId]);
});

test('U10 valid edits of the extensions JSON go into the store as one undoable step', async ({ page }) => {
  await viewButton(page, 'Extensions JSON').click();
  const doc = JSON.parse(await editorText(page, 'json-editor'));
  doc.extensions.Process_1.properties = { Property_amount: { id: 'Property_amount', name: 'amount', type: 'integer', required: false } };
  await setEditorText(page, 'json-editor', JSON.stringify(doc, null, 2));
  await expect(page.getByTestId('json-status')).toHaveText('Applied to the extensions store');
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);

  // the edit is a command on the diagram's undo stack: Edit > Undo takes it back, and the JSON view follows
  await menu(page, 'Edit', 'Undo');
  await expect.poll(async () => JSON.parse(await editorText(page, 'json-editor')).extensions.Process_1.properties).toEqual({});
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  await menu(page, 'Edit', 'Redo');
  await expect.poll(async () => Object.keys(JSON.parse(await editorText(page, 'json-editor')).extensions.Process_1.properties)).toEqual(['Property_amount']);

  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  expect(JSON.parse((await idbFiles(page))['processes/process-extensions.json']!).extensions.Process_1.properties.Property_amount.name).toBe('amount');
});

test('U10 invalid extensions JSON is marked, not applied, and blocks saving until it is fixed', async ({ page }) => {
  await viewButton(page, 'Extensions JSON').click();
  const good = await editorText(page, 'json-editor');
  await setEditorText(page, 'json-editor', good.replace('"constants": {}', '"constants": {,}'));
  await expect(page.getByTestId('json-status')).toHaveText('Not applied: fix the errors first');
  await expect(page.getByTestId('json-editor').locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);

  // leaving and saving are refused while the JSON is invalid
  await viewButton(page, 'Diagram').click();
  await expect(page.getByTestId('json-view')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('alert-dialog')).toContainText('The extensions JSON has errors');
  await page.getByTestId('alert-dialog').getByRole('button', { name: 'OK' }).click();

  // fixing it applies again, and unknown fields are warned about without blocking
  await setEditorText(page, 'json-editor', good.replace('"id": "process-process"', '"id": "process-process",\n  "name": "APA style"'));
  await expect(page.getByTestId('json-status')).toHaveText('Applied to the extensions store');
  await expect(page.getByTestId('json-editor').locator('.cm-lintRange-warning').first()).toBeVisible();
  await viewButton(page, 'Diagram').click();
  await expect(element(page, 'StartEvent_1')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  // the runtime does not know "name": it is dropped on save, and the panel says so
  expect(JSON.parse((await idbFiles(page))['processes/process-extensions.json']!)).not.toHaveProperty('name');
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('bottom-panel')).toContainText('which Activiti 9.0.0 does not know');
});
