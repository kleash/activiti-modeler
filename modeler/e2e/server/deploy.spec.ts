import { expectWatermarkVisible } from '../support/watermark';
import { apiClient, deployProject, expect, openProject, runMenu, test } from './support';

/**
 * R2: deploy the project (BPMN, extensions, DMN) to the real server: the open editors are saved, the lint gate blocks on errors and asks
 * about warnings, the engine's problems reach the Problems panel mapped to elements, and the result shows definitions, decisions and
 * resource names.
 */

const workbench = (page: import('@playwright/test').Page) => page.getByTestId('workbench');

test('R2 deploys a project with decisions: definitions, decisions and resource names', async ({ page }) => {
  await openProject(page, 'C16-dmn-hit-policies');
  await deployProject(page);

  const definitions = page.getByTestId('deploy-definitions');
  for (const key of ['hitPolicies', 'mapAllOutputs', 'noMatchRouting']) await expect(definitions).toContainText(key);
  await expect(definitions).toContainText('processes/hitPolicies.bpmn20.xml');

  const decisions = page.getByTestId('deploy-decisions');
  await expect(decisions).toContainText('uniqueGrade');
  await expect(decisions).toContainText('processes/unique-grade.dmn');
  await expect(decisions).toContainText('UNIQUE');

  const resources = page.getByTestId('deploy-resources');
  await expect(resources).toContainText('processes/hitPolicies-extensions.json');
  await expect(resources).toContainText('processes/priority-risk.dmn');

  // what the server really has
  const client = apiClient();
  const deployments = (await client.listDeployments()).items;
  expect(deployments).toHaveLength(1);
  const names = (await client.listDeploymentResources(deployments[0]!.id)).map((r) => r.name).sort();
  expect(names).toContain('processes/hitPolicies.bpmn20.xml');
  expect(names).toContain('processes/unique-grade.dmn');
  expect(names).toContain('processes/hitPolicies-extensions.json');
});

test('R2 the workbench covers the editors: no control of the diagram below shows through it', async ({ page }) => {
  await openProject(page, 'C12-misc-flow');
  await deployProject(page);
  await expect(workbench(page)).toBeVisible();
  const toggle = page.locator('.editor-panel.active .djs-minimap .toggle');
  await expect(toggle).toBeAttached();
  const box = (await toggle.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="workbench"]'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBe(true);
});

test('R2 a deployed decision opens in the read-only DMN viewer', async ({ page }) => {
  await openProject(page, 'C16-dmn-hit-policies');
  await deployProject(page);
  await page.getByTestId('deploy-view-uniqueGrade').click();
  const preview = page.getByTestId('dmn-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.dmn-decision-table-container table')).toBeVisible();
  await expect(preview.locator('tbody tr').first()).toBeVisible();
});

test('R2 a plain corpus project deploys and its processes can be started from the result', async ({ page }) => {
  await openProject(page, 'C12-misc-flow');
  await deployProject(page);
  const definitions = page.getByTestId('deploy-definitions');
  for (const key of ['implicitSplit', 'linkEvents', 'receiveTask']) await expect(definitions).toContainText(key);
  await page.getByTestId('deploy-start-receiveTask').click();
  await expect(page.getByTestId('start-tab')).toBeVisible();
  await expect(page.getByTestId('start-process')).toHaveValue('receiveTask');
});

test('R2 errors of the lint block the deployment: nothing reaches the server and the Problems panel opens', async ({ page }) => {
  await openProject(page, 'rule-check');
  await runMenu(page, 'Deploy project');
  await expect(page.getByTestId('toasts')).toContainText('Not deployed');
  await expect(page.getByTestId('bottom-panel')).toBeVisible();
  const problem = page.getByTestId('problem').first();
  await expect(problem).toBeVisible();
  await expect(page.getByTestId('problem').filter({ hasText: 'business rule task' }).first()).toHaveAttribute('data-severity', 'error');
  // the workbench shows the same errors, clickable
  await runMenu(page, 'Instances');
  await page.getByTestId('run-tab-deploy').click();
  await expect(page.getByTestId('deploy-outcome')).toContainText('Not deployed');
  expect((await apiClient().listDeployments()).items).toHaveLength(0);
});

test('R2 an error only the engine knows is mapped to the element in the Problems panel (source engine)', async ({ page }) => {
  await openProject(page, 'shell-task');
  await runMenu(page, 'Deploy project');
  await expect(page.getByTestId('toasts')).toContainText('Not deployed');
  const engine = page.locator('[data-testid="problem"][data-source="engine"]');
  await expect(engine.first()).toBeVisible();
  await expect(engine.first()).toHaveAttribute('data-element', 'runCommand');
  await expect(engine.first()).toHaveAttribute('data-severity', 'error');
  await expect(engine.first()).toContainText(/shell/i);
  // a click selects the element in its diagram
  await engine.first().getByRole('button').first().click();
  await expect(page.locator('.editor-panel.active .djs-element.selected[data-element-id="runCommand"]')).toBeVisible();
  expect((await apiClient().listDeployments()).items).toHaveLength(0);
});

test('R2 warnings need a confirmation; "Deploy anyway" deploys', async ({ page }) => {
  await openProject(page, 'warn-only');
  await runMenu(page, 'Deploy project');
  const choice = page.getByTestId('choice-dialog');
  await expect(choice).toContainText('Deploy with warnings?');
  await expect(choice).toContainText('group');
  await choice.getByRole('button', { name: 'Cancel' }).click();
  expect((await apiClient().listDeployments()).items).toHaveLength(0);
  // the deploy tab remembers that it was cancelled
  await runMenu(page, 'Instances');
  await page.getByTestId('run-tab-deploy').click();
  await expect(page.getByTestId('deploy-outcome')).toContainText('Cancelled at the warnings');

  await page.getByTestId('deploy-button').click();
  await page.getByTestId('choice-dialog').getByRole('button', { name: 'Deploy anyway' }).click();
  await expect(page.getByTestId('deploy-definitions')).toContainText('grouped');
  expect((await apiClient().listProcessDefinitions({ latest: true })).items.map((d) => d.key)).toContain('grouped');
});

test('R2 the open editors are saved before the project is deployed', async ({ page }) => {
  await openProject(page, 'run-demo');
  // open the process and rename a task in the diagram: unsaved changes
  await page.getByTestId('explorer').getByText('flaky.bpmn20.xml').dblclick();
  const task = page.locator('.editor-panel.active .djs-element[data-element-id="callBackend"]');
  await expect(task).toBeVisible();
  await task.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Call the other backend');
  await page.locator('.editor-panel.active .djs-container').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('status-saved')).toContainText('unsaved');
  await deployProject(page);
  await expect(page.getByTestId('status-saved')).toContainText('All changes saved');
  const client = apiClient();
  const deployment = (await client.listDeployments()).items[0]!;
  expect(await client.getDeploymentResource(deployment.id, 'processes/flaky.bpmn20.xml')).toContain('Call the other backend');
});

test('R4 the watermark of the viewer is visible and not covered on the deploy tab and in the instance view', async ({ page }) => {
  await openProject(page, 'run-demo');
  await deployProject(page);
  await expect(workbench(page)).toBeVisible();
  await page.getByTestId('deploy-start-orderReview').click();
  await page.getByTestId('start-variables-add').click();
  await page.getByTestId('start-variables-name-0').fill('orderId');
  await page.getByTestId('start-variables-value-0').fill('W-1');
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('instance-view')).toBeVisible();
  await expect(page.getByTestId('instance-diagram-canvas')).toHaveAttribute('data-loaded', 'true');
  await expectWatermarkVisible(page, 'instance view', '[data-testid="instance-diagram"]');
});
