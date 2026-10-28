import { expect, test, type Page } from '@playwright/test';

import { activePanel, element, menu } from './support/app';
import { entry, openScene, panel, RISK_DMN } from './properties/support';
import type { ModelerApi } from './support/modelerApi';

/** U14: the variable outline (@bpmn-io/variable-resolver with the Activiti adapter), the highlight of writers and readers, and the JUEL autocomplete. */

async function scene(api: ModelerApi): Promise<void> {
  await api.addDmn('risk', RISK_DMN);
  await api.createShape({ type: 'startEvent', id: 'start' });
  await api.setProperty('start', 'start.initiator', 'starter');
  await api.appendShape('start', { type: 'serviceTask', id: 'decide', name: 'Decide risk', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
  await api.setProperty('decide', 'decision.table', 'riskLevel');
  await api.setExtensions({
    elementId: 'decide',
    inputs: { age: { type: 'VARIABLE', value: 'applicantAge' }, region: { type: 'VALUE', value: 'EU' } },
    outputs: { risk: { type: 'VARIABLE', value: 'level', declareType: 'string' }, score: { type: 'VARIABLE', value: 'points', declareType: 'bigdecimal' } },
    properties: [{ name: 'applicantAge', type: 'integer' }],
  });
  await api.appendShape('decide', { type: 'scriptTask', id: 'price', name: 'Price', attrs: { scriptFormat: 'juel' } });
  await api.setProperty('price', 'script.resultVariable', 'premium');
  await api.setProperty('price', 'script.text', '${score * 10}');
  await api.appendShape('price', { type: 'userTask', id: 'approve', name: 'Approve' });
  await api.setProperty('approve', 'user.assignee', '${manager}');
  await api.appendShape('approve', { type: 'callActivity', id: 'ship', name: 'Ship' });
  await api.setProperty('ship', 'call.out', [{ source: 'label', target: 'shippingLabel' }]);
  await api.setProperty('ship', 'call.in', [{ source: 'premium', target: 'sum' }]);
}

const variablesTab = (page: Page) => page.getByTestId('variables-tab');
const row = (page: Page, name: string) => page.getByTestId('variables-panel').locator(`[data-testid="variable-row"][data-name="${name}"]`).first();

async function openVariables(page: Page): Promise<void> {
  await menu(page, 'View', 'Variables');
  await expect(page.getByTestId('variables-panel')).toBeVisible();
}

test.describe('U14 variable outline', () => {
  test('U14 View > Variables lists the variables of the process: declared, DMN outputs, results, call parameters, the initiator', async ({ page }) => {
    await openScene(page, scene, 'start');
    await openVariables(page);
    await expect(variablesTab(page)).toHaveAttribute('aria-selected', 'true');

    // the declared variable, typed, read by the mapping of the decision task
    await expect(row(page, 'applicantAge')).toContainText('integer');
    await expect(row(page, 'applicantAge').getByTestId('variable-reader')).toHaveText('Decide risk');
    // the outputs of the DMN decision reach the process through the output mapping and are typed by the decision table
    await expect(row(page, 'risk')).toContainText('string');
    // written by the decision task and declared by the process (the output mapping declares its targets)
    const decisionWriter = row(page, 'risk').getByTestId('variable-writer').filter({ hasText: 'Decide risk' });
    await expect(decisionWriter).toHaveAttribute('title', /output "level" of decision Risk level/);
    await expect(row(page, 'score')).toContainText('bigdecimal');
    await expect(row(page, 'score').getByTestId('variable-reader')).toHaveText('Price');
    // a script result, read by the call activity; the initiator; a call activity output; a name nobody writes
    await expect(row(page, 'premium').getByTestId('variable-writer')).toHaveText('Price');
    await expect(row(page, 'premium').getByTestId('variable-reader')).toHaveText('Ship');
    await expect(row(page, 'starter').getByTestId('variable-writer')).toHaveAttribute('data-element', 'start');
    await expect(row(page, 'shippingLabel').getByTestId('variable-writer')).toHaveText('Ship');
    await expect(row(page, 'manager')).toContainText('?');
    await expect(row(page, 'manager').getByTestId('variable-writer')).toHaveCount(0);
    // the task-local input of the mapping
    await expect(page.getByTestId('variables-panel').locator('[data-testid="variable-row"][data-name="age"][data-scope="decide"]')).toContainText('local to Decide risk');
  });

  test('U14 choosing a variable marks its writers and readers on the canvas; choosing it again, or another one, takes the marks away', async ({ page }) => {
    await openScene(page, scene, 'start');
    await openVariables(page);
    await row(page, 'score').click();
    await expect(element(page, 'decide')).toHaveClass(/activiti-var-writer/);
    await expect(element(page, 'price')).toHaveClass(/activiti-var-reader/);
    await expect(element(page, 'approve')).not.toHaveClass(/activiti-var-(writer|reader)/);
    // the mark is a thick coloured outline
    const stroke = await element(page, 'decide').locator('.djs-visual > :first-child').first().evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe('rgb(27, 138, 60)');

    await row(page, 'premium').click();
    await expect(element(page, 'decide')).not.toHaveClass(/activiti-var-writer/);
    await expect(element(page, 'price')).toHaveClass(/activiti-var-writer/);
    await expect(element(page, 'ship')).toHaveClass(/activiti-var-reader/);

    await row(page, 'premium').click();
    await expect(element(page, 'price')).not.toHaveClass(/activiti-var-writer/);
    await expect(element(page, 'ship')).not.toHaveClass(/activiti-var-reader/);
  });

  test('U14 the marks go away with the panel, and the rows work from the keyboard', async ({ page }) => {
    await openScene(page, scene, 'start');
    await openVariables(page);
    await row(page, 'score').focus();
    await page.keyboard.press('Enter');
    await expect(element(page, 'decide')).toHaveClass(/activiti-var-writer/);
    await page.getByTestId('warnings-tab').click();
    await expect(element(page, 'decide')).not.toHaveClass(/activiti-var-writer/);
  });

  test('U14 a writer or reader chip selects that element and shows its properties', async ({ page }) => {
    await openScene(page, scene, 'start');
    await openVariables(page);
    await row(page, 'premium').getByTestId('variable-reader').click();
    await expect(activePanel(page).locator('.djs-element.selected')).toHaveAttribute('data-element-id', 'ship');
    await expect(entry(page, 'call.calledElement')).toBeVisible();
  });

  test('U14 the outline follows the model: renaming a result variable and declaring a variable update it at once', async ({ page }) => {
    const api = await openScene(page, scene, 'start');
    await openVariables(page);
    await expect(row(page, 'premium')).toBeVisible();
    await api.setProperty('price', 'script.resultVariable', 'surcharge');
    await expect(row(page, 'surcharge').getByTestId('variable-writer')).toHaveText('Price');
    await expect(row(page, 'premium')).toContainText('premium');
    await expect(row(page, 'premium').getByTestId('variable-writer')).toHaveCount(0);
    await api.setExtensions({ properties: [{ name: 'brandNew', type: 'string' }] });
    await expect(row(page, 'brandNew')).toContainText('string');
    await api.undo();
    await expect(row(page, 'brandNew')).toHaveCount(0);
  });

  test('U14 the filter finds a variable by name and "only the selected element" shows what that element reads or writes', async ({ page }) => {
    const api = await openScene(page, scene, 'start');
    await openVariables(page);
    await page.getByTestId('variables-filter').fill('ship');
    await expect(page.getByTestId('variable-row')).toHaveCount(1);
    await page.getByTestId('variables-filter').fill('');
    await page.getByTestId('variables-selected-only').check();
    await api.select('price');
    await expect.poll(async () => (await page.getByTestId('variable-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-name')))).sort()).toEqual(['premium', 'score']);
  });

  test('U14 keeps the JUEL autocomplete: the fields still complete the variables of the diagram, including the outputs of a DMN decision', async ({ page }) => {
    await openScene(page, scene, 'approve');
    const editor = entry(page, 'user.assignee').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('${pre');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('premium');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('${ris');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('risk');
  });

  test('U14 with no process variable at all the panel says so', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'startEvent', id: 'start' })));
    await openVariables(page);
    await expect(page.getByTestId('variables-empty')).toBeVisible();
    // and a DMN tab has no variables to show
    await expect(panel(page)).toBeVisible();
  });
});
