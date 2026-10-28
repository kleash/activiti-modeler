import { expect, type Page } from '@playwright/test';

import { dropFiles, processXml, waitForDraft } from '../support/app';
import { RISK_DMN } from '../properties/support';
import { test } from '../support/test';
import { activePanel, columnPopup, inputHeader, inputSettled, openApp, openColumnEditor, openView, outputHeader, saveAndRead, tab } from './support';

// the connection probe of the run feature asks for a modeler server that these tests do not start
test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

const entry = (page: Page, id: string) => page.locator('#properties-panel-slot').locator(`[data-entry-id="${id}"]`).first();

/** Selects the decision task, as a click on the canvas does (the panel follows the selection). */
const selectTask = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const api = (window as unknown as { __modelerTestApi: { ready(): Promise<void>; select(id: string): void } }).__modelerTestApi;
    await api.ready();
    api.select('decide');
  });

test('DM11 the decision task follows the DMN file as it is edited in the editor: a renamed output or input shows a stale mapping hint', async ({ page }) => {
  await openApp(page);
  const bpmn = processXml('order', [
    { id: 'start', type: 'startEvent', x: 100, y: 100 },
    { id: 'decide', type: 'serviceTask', name: 'Decide', x: 200, y: 78 },
  ]).replace('<bpmn:serviceTask id="decide" name="Decide" />', '<bpmn:serviceTask id="decide" name="Decide" implementation="dmn-connector.EXECUTE_TABLE" />');
  const extensions = JSON.stringify({
    id: 'process-order',
    extensions: {
      order: {
        properties: {},
        mappings: {
          decide: {
            inputs: { age: { type: 'VARIABLE', value: 'age' }, region: { type: 'VARIABLE', value: 'region' } },
            outputs: { level: { type: 'VARIABLE', value: 'level' }, points: { type: 'VARIABLE', value: 'points' } },
          },
        },
        constants: { decide: { _activiti_dmn_table_: { value: 'riskLevel' } } },
      },
    },
  });
  await dropFiles(page, [{ name: 'order.bpmn20.xml', content: bpmn }, { name: 'order-extensions.json', content: extensions }, { name: 'risk.dmn', content: RISK_DMN }]);
  await expect(tab(page, 'order.bpmn20.xml')).toHaveClass(/active/);

  // the task as the file left it: wired to what the decision reads and returns, no hint
  await selectTask(page);
  await expect(entry(page, 'decision.info.summary')).toContainText('reads age, region and returns level, points');
  await expect(entry(page, 'decision.outputs.stale')).toHaveCount(0);
  await expect(entry(page, 'decision.inputs.stale')).toHaveCount(0);

  // in the DMN editor: the output column `level` is renamed `grade`, the input expression `region` is replaced by `country`
  await page.getByTestId('file-tree').getByRole('treeitem').filter({ hasText: 'risk.dmn' }).dblclick();
  await expect(tab(page, 'risk.dmn')).toHaveClass(/active/);
  await openView(page, 'riskLevel');
  await openColumnEditor(outputHeader(page, 0));
  await columnPopup(page).locator('[aria-label="Output name"]').fill('grade');
  await inputSettled(page);
  await openColumnEditor(inputHeader(page, 1));
  const expression = columnPopup(page).locator('[aria-label="Input expression"]');
  await expression.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('country');
  await inputSettled(page);
  await activePanel(page).locator('.tjs-table thead .index-column').first().click();
  // the edit is a working copy of the file (what the pickers and the lint read) before anything is saved
  await expect(tab(page, 'risk.dmn')).toHaveClass(/dirty/);
  await waitForDraft(page, 'processes/risk.dmn', (xml) => xml.includes('country'));

  await tab(page, 'order.bpmn20.xml').getByRole('tab').click();
  await selectTask(page);
  await expect(entry(page, 'decision.info.summary')).toContainText('reads age, country and returns grade, points');
  await expect(entry(page, 'decision.outputs.stale')).toContainText('level (stored in level)');
  await expect(entry(page, 'decision.outputs.stale')).toContainText('it returns grade, points');
  await expect(entry(page, 'decision.inputs.stale')).toContainText('region');
  await expect(entry(page, 'decision.inputs.stale')).toContainText('it reads age, country');
  // the existing buttons add what is missing; the stale rows stay visible until they are changed
  await entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.inputs').click();
  await expect(entry(page, 'decision.inputs.hint')).toHaveCount(0);

  // saved, the DMN is portable and the picker lists the new column names
  await tab(page, 'risk.dmn').getByRole('tab').click();
  const xml = await saveAndRead(page, 'risk.dmn', 'processes/risk.dmn');
  expect(xml).toContain('name="grade"');
  expect(xml).toContain('<text>country</text>');
});
