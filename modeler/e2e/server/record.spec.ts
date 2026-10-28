import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, deployProject, openProject, test, workspaceDir } from './support';

/**
 * R7: record a scenario from an interactive run. The person starts an instance with "record" ticked and works it in the instance view;
 * the steps and the final state become a scenario file, which then replays on the server.
 */

test('R7 an interactive run of the order review is saved as a scenario file that replays and passes', async ({ page }) => {
  const project = await openProject(page, 'run-demo');
  await deployProject(page);
  // alice is a reviewer (the workspace and the deployment are the admin's work, the run is alice's)
  await page.getByTestId('run-connection').click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill('alice');
  await dialog.getByTestId('connection-password').fill('alice');
  await dialog.getByTestId('connection-connect').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('run-connection')).toContainText('alice');
  await page.getByTestId('deploy-start-orderReview').click();
  await expect(page.getByTestId('start-process')).toHaveValue('orderReview');
  await page.getByTestId('start-record').check();
  await page.getByTestId('start-variables-row-orderId').getByLabel(/Value of variable/).fill('R-1');
  await page.getByTestId('start-button').click();
  const banner = page.getByTestId('recording-banner');
  await expect(banner).toContainText('Recording a scenario of orderReview');
  await expect(banner).toContainText('0 steps');

  // the review task: claim it, complete it with approved = true
  await page.getByTestId('instance-panel-tasks').click();
  await page.getByTestId('task-claim').click();
  await expect(page.getByTestId('task-assignee')).toHaveText('alice');
  await page.getByTestId('task-complete').click();
  await page.getByTestId('complete-variables-add').click();
  await page.getByTestId('complete-variables-name-0').fill('approved');
  await page.getByTestId('complete-variables-type-0').selectOption('boolean');
  await page.getByTestId('complete-variables-value-0').fill('true');
  await page.getByTestId('task-complete-confirm').click();
  await expect(page.getByTestId('instance-diagram').locator('.djs-element[data-element-id="waitPayment"]')).toHaveClass(/activiti-active/);

  // the payment arrives, the goods are shipped
  await page.getByTestId('instance-panel-events').click();
  await page.getByTestId('message-name').fill('paymentReceived');
  await page.getByTestId('message-correlation').fill('R-1');
  await page.getByTestId('message-send').click();
  await expect(page.getByTestId('instance-diagram').locator('.djs-element[data-element-id="ship"]')).toHaveClass(/activiti-active/);
  await page.getByTestId('trigger-ship').click();
  await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
  await expect(banner).toContainText('5 steps');

  await page.getByTestId('recording-save').click();
  await page.getByTestId('prompt-input').fill('recorded approval');
  await page.getByTestId('prompt-confirm').click();
  await expect(page.getByTestId('scenario-editor')).toBeVisible();

  // the file: the start, the steps of the run and what the engine did as the expectations
  const saved = JSON.parse(readFileSync(join(workspaceDir(), project, 'scenarios', 'recorded-approval.scenario.json'), 'utf8')) as {
    users: Record<string, string[]>;
    scenarios: Array<{ start: unknown; steps: unknown[]; expect: Record<string, unknown> }>;
  };
  expect(saved.users).toEqual({ alice: ['reviewers'] });
  const [scenario] = saved.scenarios;
  expect(scenario!.start).toEqual({ process: 'orderReview', user: 'alice', variables: { orderId: 'R-1' } });
  expect(scenario!.steps).toEqual([
    { claim: { activity: 'review', user: 'alice' } },
    { expectTask: { activity: 'review' } },
    { completeTask: { activity: 'review', user: 'alice', variables: { approved: true } } },
    { message: { name: 'paymentReceived', correlationKey: 'R-1' } },
    { triggerReceiveTask: { activity: 'ship' } },
  ]);
  expect(scenario!.expect).toMatchObject({ state: 'COMPLETED', endEvents: ['shippedEnd'], variables: { approved: true, orderId: 'R-1' } });
  expect((scenario!.expect['path'] as { contains: string[] }).contains).toEqual(expect.arrayContaining(['start', 'review', 'decision', 'waitPayment', 'ship', 'shippedEnd']));

  // the recording is over, and the file replays on the server (running scenarios is the admin's: alice only appears inside the scenario)
  await expect(banner).toBeHidden();
  await page.getByTestId('status-server').click();
  const admin = page.getByTestId('connection-dialog');
  await admin.getByTestId('connection-user').fill('modeler');
  await admin.getByTestId('connection-password').fill('modeler');
  await admin.getByTestId('connection-connect').click();
  await expect(admin).toBeHidden();
  await page.getByTestId('scenario-run').click();
  await expect(page.getByTestId('scenario-report')).toHaveAttribute('data-passed', 'true', { timeout: 60_000 });
});

test('R7 without the tick nothing is recorded, and "Discard" drops a recording', async ({ page }) => {
  await openProject(page, 'run-demo');
  await deployProject(page);
  await page.getByTestId('deploy-start-flaky').click();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('instance-view')).toBeVisible();
  await expect(page.getByTestId('recording-banner')).toHaveCount(0);

  await page.getByTestId('run-tab-start').click();
  await page.getByTestId('start-record').check();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('recording-banner')).toBeVisible();
  await page.getByTestId('recording-discard').click();
  await expect(page.getByTestId('recording-banner')).toHaveCount(0);
});
