import { expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, element, idbFiles, menu, openApp, tab } from './support/app';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function createFromTemplate(page: import('@playwright/test').Page, id: string, name: string): Promise<void> {
  await menu(page, 'File', 'New file', {
    'empty-process': 'Empty process',
    'user-task-approval': 'User task approval',
    'connector-call': 'Connector call',
    'decision-task': 'Decision task',
    'dmn-decision-table': 'DMN decision table',
    'dmn-drd': 'DMN DRD',
    scenario: 'Scenario file',
    'connector-definition': 'Connector definition',
  }[id]!);
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-confirm').click();
}

test('U2 the New file dialog offers all eight templates', async ({ page }) => {
  await page.keyboard.press('Control+N');
  const dialog = page.getByTestId('templates-dialog');
  await expect(dialog).toBeVisible();
  for (const label of ['Empty process', 'User task approval', 'Connector call', 'Decision task', 'DMN decision table', 'DMN DRD', 'Scenario file', 'Connector definition']) {
    await expect(dialog.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('U2 new empty process: an executable process with a start event and its own process id', async ({ page }) => {
  await createFromTemplate(page, 'empty-process', 'blank');
  await expect(tab(page, 'blank.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'StartEvent_blank')).toBeVisible();
  const files = await idbFiles(page);
  expect(files['processes/blank.bpmn20.xml']).toContain('<bpmn:process id="blank" isExecutable="true">');
  // the first process of the project keeps another id: both can be deployed together
  expect(files['processes/process.bpmn20.xml']).toContain('id="Process_1"');
  expect(JSON.parse(files['processes/blank-extensions.json']!).extensions).toEqual({ blank: { properties: {}, mappings: {}, constants: {} } });
});

test('U2 new user task approval: a user task for a group, a gateway with a default flow, two end events', async ({ page }) => {
  await createFromTemplate(page, 'user-task-approval', 'approval');
  for (const id of ['start', 'review', 'decide', 'approved_end', 'rejected_end', 'flow_approved', 'flow_rejected']) await expect(element(page, id)).toBeVisible();
  const files = await idbFiles(page);
  const xml = files['processes/approval.bpmn20.xml']!;
  expect(xml).toContain('activiti:candidateGroups="managers"');
  expect(xml).toContain('default="flow_rejected"');
  expect(xml).toContain('${approved == true}');
  expect(xml).not.toMatch(/camunda|zeebe/i);
  const ext = JSON.parse(files['processes/approval-extensions.json']!);
  expect(ext.extensions.approval.mappings.review).toEqual({ mappingType: 'MAP_ALL' });
  expect(Object.values(ext.extensions.approval.properties)).toEqual([{ id: 'Property_approved', name: 'approved', type: 'boolean', required: false }]);
});

test('U2 new connector call: a service task with a connector action, mappings, and the connector definition', async ({ page }) => {
  await createFromTemplate(page, 'connector-call', 'mail-call');
  await expect(element(page, 'notify')).toBeVisible();
  const files = await idbFiles(page);
  expect(files['processes/mail-call.bpmn20.xml']).toContain('implementation="mailer.SEND"');
  const ext = JSON.parse(files['processes/mail-call-extensions.json']!).extensions['mail-call'];
  expect(ext.mappings.notify.inputs).toEqual({ to: { type: 'VARIABLE', value: 'recipient' }, subject: { type: 'VALUE', value: 'Hello from Activiti' } });
  expect(ext.mappings.notify.outputs).toEqual({ messageId: { type: 'VARIABLE', value: 'messageId' } });
  expect(Object.keys(JSON.parse(files['connectors/mailer.json']!).actions)).toEqual(['SEND']);
});

test('U2 new decision task: a service task on dmn-connector.EXECUTE_TABLE with the decision id as constant, plus the DMN file', async ({ page }) => {
  await createFromTemplate(page, 'decision-task', 'route');
  await expect(element(page, 'decision')).toBeVisible();
  const files = await idbFiles(page);
  expect(files['processes/route.bpmn20.xml']).toContain('implementation="dmn-connector.EXECUTE_TABLE"');
  const ext = JSON.parse(files['processes/route-extensions.json']!).extensions.route;
  expect(ext.constants.decision).toEqual({ _activiti_dmn_table_: { value: 'route_route' } });
  expect(ext.mappings.decision.outputs).toEqual({ route: { type: 'VARIABLE', value: 'route' } });
  expect(files['processes/route-rules.dmn']).toContain('<decision id="route_route"');
  expect(files['processes/route-rules.dmn']).toContain('https://www.omg.org/spec/DMN/20191111/MODEL/');
});

test('U2 new DMN decision table and DRD open in the DMN editor', async ({ page }) => {
  await createFromTemplate(page, 'dmn-decision-table', 'pricing');
  await expect(tab(page, 'pricing.dmn')).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('dmn-views')).toBeVisible();
  await expect(activePanel(page).getByTestId('dmn-view-drd')).toBeVisible();
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await createFromTemplate(page, 'dmn-drd', 'risk');
  await expect(activePanel(page).getByTestId('dmn-views')).toBeVisible();
  const files = await idbFiles(page);
  expect(files['processes/pricing.dmn']).toContain('<decision id="pricing"');
  expect(files['processes/risk.dmn']).toContain('<requiredDecision href="#risk_riskClass"');
  expect(files['processes/risk.dmn']).toContain('<dmndi:DMNDI>');
});

test('U2 new scenario file starts the process of the project; new connector definition has an action', async ({ page }) => {
  await createFromTemplate(page, 'scenario', 'first-run');
  await expect(tab(page, 'first-run.scenario.json')).toHaveClass(/active/);
  const files = await idbFiles(page);
  const scenario = JSON.parse(files['scenarios/first-run.scenario.json']!);
  expect(scenario.scenarios[0].start.process).toBe('Process_1');
  expect(scenario.scenarios[0].expect).toEqual({ state: 'COMPLETED' });
  await createFromTemplate(page, 'connector-definition', 'crm');
  expect(JSON.parse((await idbFiles(page))['connectors/crm.json']!).actions.SEND.inputs.length).toBeGreaterThan(0);
});

test('U2 a template name that exists is refused, and templates never overwrite', async ({ page }) => {
  await menu(page, 'File', 'New file', 'Empty process');
  await page.getByTestId('prompt-input').fill('process');
  await expect(page.getByTestId('prompt-help')).toContainText('processes/process.bpmn20.xml already exists');
  await expect(page.getByTestId('prompt-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('U2 every BPMN template opens without import warnings', async ({ page }) => {
  for (const [id, name] of [['user-task-approval', 'a1'], ['connector-call', 'a2'], ['decision-task', 'a3'], ['empty-process', 'a4']] as const) await createFromTemplate(page, id, name);
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('bottom-panel')).toContainText('No import or export warnings.');
  for (const name of ['a1', 'a2', 'a3', 'a4']) {
    await tab(page, `${name}.bpmn20.xml`).getByRole('tab').click();
    await expect(activePanel(page).getByTestId('bpmn-canvas')).toBeVisible();
    await expect(page.getByTestId('error-tab')).toHaveCount(0);
  }
});
