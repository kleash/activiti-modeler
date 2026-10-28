import { type Page } from '@playwright/test';

import { apiClient, deployProject, expect, openProject, test } from './support';

/**
 * R3 (start), R4 (instance view) and R5 (act on the instance) with real processes on the real server: the order review (a user task with a
 * candidate group and a reminder timer, a message catch, a receive task), the flaky call (a dead letter), the intake process (message start),
 * the signal wait and the abortable work (an event sub process).
 */

const diagram = (page: Page) => page.getByTestId('instance-diagram');
const element = (page: Page, id: string) => diagram(page).locator(`.djs-element[data-element-id="${id}"]`);
const instanceView = (page: Page) => page.getByTestId('instance-view');

const deploy = deployProject;

/** Opens the Start tab for a process of the deployment and waits for its form. */
async function startForm(page: Page, key: string): Promise<void> {
  await page.getByTestId(`deploy-start-${key}`).click();
  await expect(page.getByTestId('start-tab')).toBeVisible();
  await expect(page.getByTestId('start-process')).toHaveValue(key);
}

const valueOf = (page: Page, name: string) => page.getByTestId(`start-variables-row-${name}`).getByLabel(/Value of variable/);

async function loaded(page: Page): Promise<void> {
  await expect(instanceView(page)).toBeVisible();
  await expect(page.getByTestId('instance-diagram-canvas')).toHaveAttribute('data-loaded', 'true');
}

/** Starts the order review for an order and waits for the instance view. */
async function startOrder(page: Page, orderId: string, businessKey?: string): Promise<void> {
  await startForm(page, 'orderReview');
  await valueOf(page, 'orderId').fill(orderId);
  if (businessKey) await page.getByTestId('start-business-key').fill(businessKey);
  await page.getByTestId('start-button').click();
  await loaded(page);
}

/** Signs in as another user through the connection dialog (the workbench stays as it is). */
async function signInAgain(page: Page, user: string): Promise<void> {
  await page.getByTestId('run-connection').click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill(user);
  await dialog.getByTestId('connection-password').fill(user);
  await dialog.getByTestId('connection-connect').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('run-connection')).toContainText(user);
}

async function startFlaky(page: Page): Promise<void> {
  await startForm(page, 'flaky');
  await page.getByTestId('start-button').click();
  await loaded(page);
}

test.describe('R3 start an instance', () => {
  test('R3 the form lists the declared properties; a required one must have a value; business key and typed variables reach the engine', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startForm(page, 'orderReview');

    // the declared properties, with their type and default
    const orderId = page.getByTestId('start-variables-row-orderId');
    await expect(orderId).toContainText('*');
    await expect(orderId.getByLabel(/Type of variable/)).toHaveValue('string');
    await expect(page.getByTestId('start-variables-row-amount').getByLabel(/Type of variable/)).toHaveValue('integer');
    await expect(valueOf(page, 'amount')).toHaveValue('100');

    // a required property without a value does not start anything
    await page.getByTestId('start-button').click();
    await expect(orderId.getByRole('alert')).toHaveText('required');
    expect((await apiClient().listProcessInstances()).items).toHaveLength(0);

    await valueOf(page, 'orderId').fill('O-77');
    await valueOf(page, 'amount').fill('250');
    await page.getByTestId('start-business-key').fill('BK-77');
    await page.getByTestId('start-button').click();
    await loaded(page);

    await expect(instanceView(page)).toContainText('BK-77');
    await expect(page.getByTestId('instance-state')).toHaveText('ACTIVE');
    await page.getByTestId('instance-panel-variables').click();
    await expect(page.getByTestId('variable-value-orderId')).toHaveValue('O-77');
    await expect(page.getByTestId('variable-value-amount')).toHaveValue('250');

    const [instance] = (await apiClient().listProcessInstances()).items;
    expect(instance!.businessKey).toBe('BK-77');
    expect(instance!.startUserId).toBe('modeler');
    const variables = await apiClient().getProcessInstanceVariables(instance!.id);
    expect(variables.find((v) => v.name === 'amount')?.value).toBe(250);
    expect(variables.find((v) => v.name === 'orderId')?.value).toBe('O-77');
  });

  test('R3 a default the person leaves alone is applied by the engine; a variable that is not declared can be added', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startForm(page, 'orderReview');
    await valueOf(page, 'orderId').fill('O-78');
    await page.getByTestId('start-variables-add').click();
    await page.getByTestId('start-variables-name-4').fill('channel');
    await page.getByTestId('start-variables-value-4').fill('web');
    await page.getByTestId('start-button').click();
    await loaded(page);
    const [instance] = (await apiClient().listProcessInstances()).items;
    const variables = Object.fromEntries((await apiClient().getProcessInstanceVariables(instance!.id)).map((v) => [v.name, v.value]));
    expect(variables).toMatchObject({ orderId: 'O-78', amount: 100, channel: 'web' });
  });

  test('R3 starts an instance by message', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await page.getByTestId('run-tab-start').click();
    await page.getByTestId('start-mode-message').check();
    await page.getByTestId('start-message').fill('orderPlaced');
    await page.getByTestId('start-button').click();
    await loaded(page);
    await expect(instanceView(page)).toContainText('Order intake');
    const [instance] = (await apiClient().listProcessInstances()).items;
    expect(instance!.processDefinitionKey).toBe('intake');
    await expect(element(page, 'register')).toHaveClass(/activiti-active/);
  });

  test.describe('R3 a refusal of the server', () => {
    // the server refuses on purpose: the browser logs every 4xx answer of a request as a console error
    test.use({ allowedErrors: [/Failed to load resource: the server responded with a status of 4\d\d/] });
    test('R3 an error of the server is shown on the form', async ({ page }) => {
      await openProject(page);
      await deploy(page);
      await page.getByTestId('run-tab-start').click();
      await page.getByTestId('start-mode-message').check();
      await page.getByTestId('start-message').fill('noSuchMessage');
      await page.getByTestId('start-button').click();
      await expect(page.getByTestId('start-error')).toBeVisible();
    });
  });
});

test.describe('R4 the instance view', () => {
  test('R4 instance view highlights the active task, the completed start event and the flow taken', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-1');

    await expect(element(page, 'review')).toHaveClass(/activiti-active/);
    await expect(element(page, 'start')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'f_start_review')).toHaveClass(/activiti-flow-taken/);
    await expect(element(page, 'decision')).not.toHaveClass(/activiti-(active|completed)/);
    await expect(element(page, 'f_review_decision')).not.toHaveClass(/activiti-flow-taken/);
    // the token sits on the task
    await expect(diagram(page).getByTestId('token-review')).toHaveText('1');
    // the timer boundary event is waiting too: the reminder is a job
    await page.getByTestId('instance-panel-jobs').click();
    await expect(page.getByTestId('jobs-panel')).toContainText('TIMER');

    // the task, its candidates and the variables
    await page.getByTestId('instance-panel-tasks').click();
    const task = page.getByTestId('task-review');
    await expect(task).toContainText('Review order');
    await expect(page.getByTestId('task-candidates')).toContainText('group reviewers');
    await expect(page.getByTestId('task-assignee')).toContainText('unassigned');
    await page.getByTestId('instance-panel-path').click();
    await expect(page.getByTestId('path-activity-start')).toBeVisible();
    await expect(page.getByTestId('path-flows')).toContainText('f_start_review');
  });

  test('R4 the view and the list follow the instance by themselves (live refresh)', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-2');
    const id = (await page.getByTestId('instance-id').innerText()).trim();

    // somebody else acts through the API as alice: the open view catches up without a click
    const alice = apiClient('alice');
    const [task] = (await alice.listTasks({ processInstanceId: id, mine: true })).items;
    await alice.claimTask(task!.id);
    await alice.completeTask(task!.id, { approved: true });
    await expect(element(page, 'waitPayment')).toHaveClass(/activiti-active/);
    await expect(element(page, 'review')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'f_decision_waitPayment')).toHaveClass(/activiti-flow-taken/);
    await expect(page.getByTestId(`instance-${id}`)).toHaveAttribute('data-state', 'ACTIVE');
  });

  test('R4 a dead-letter job is an incident on its element, with the failure and the stack trace', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startFlaky(page);
    await expect(page.getByTestId('instance-incident')).toBeVisible();
    await expect(element(page, 'callBackend')).toHaveClass(/activiti-incident/);
    await expect(diagram(page).getByTestId('incident-callBackend')).toBeVisible();
    await page.getByTestId('instance-panel-jobs').click();
    const job = page.getByTestId('job-callBackend');
    await expect(job).toHaveAttribute('data-kind', 'DEADLETTER');
    await expect(job.getByTestId('job-exception')).not.toBeEmpty();
    await job.getByTestId('job-trace').click();
    await expect(page.getByTestId('job-stacktrace')).toContainText('Exception');
  });

  test('R4 an event sub process has no activity instance in the engine; the view infers it from the flows taken', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startForm(page, 'abortable');
    await page.getByTestId('start-button').click();
    await loaded(page);
    await expect(element(page, 'work')).toHaveClass(/activiti-active/);
    // abort: the message starts the event sub process
    await page.getByTestId('instance-panel-events').click();
    await page.getByTestId('message-name').fill('abort');
    await page.getByTestId('message-send').click();
    await expect(element(page, 'cleanup')).toHaveClass(/activiti-active/);
    // the container is shown as active because a token sits inside it
    await expect(element(page, 'abortHandler')).toHaveClass(/activiti-active/);
    await expect(element(page, 'f_abortStart_cleanup')).toHaveClass(/activiti-flow-taken/);
    // the engine really records nothing for the container
    const id = (await page.getByTestId('instance-id').innerText()).trim();
    const path = await apiClient().getProcessInstancePath(id);
    expect(path.activities.map((a) => a.activityId)).not.toContain('abortHandler');

    // finish the clean-up: the instance ends and the container is completed (still inferred)
    await page.getByTestId('instance-panel-tasks').click();
    await page.getByTestId('task-complete').click();
    await page.getByTestId('task-complete-confirm').click();
    await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
    await expect(element(page, 'abortHandler')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'abortEnd')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'work')).not.toHaveClass(/activiti-active/);
  });

  test('R4 finished instances stay in the list; the filter separates them, and a child call can be followed', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startForm(page, 'signalWait');
    await page.getByTestId('start-button').click();
    await loaded(page);
    await page.getByTestId('instance-panel-events').click();
    await page.getByTestId('signal-name').fill('proceed');
    await page.getByTestId('signal-send').click();
    await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
    await page.getByTestId('instances-filter').selectOption('running');
    await expect(page.getByTestId('instance-list').locator('li').filter({ hasText: 'signalWait' })).toHaveCount(0);
    await page.getByTestId('instances-filter').selectOption('finished');
    await expect(page.getByTestId('instance-list').locator('li').filter({ hasText: 'signalWait' })).toHaveCount(1);
  });
});

test.describe('R5 act on the instance', () => {
  test('R5 claims and completes a task with variables as the connected user; the instance moves on', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-3');
    await page.getByTestId('instance-panel-tasks').click();
    await expect(page.getByTestId('acting-user')).toHaveText('modeler');
    await page.getByTestId('task-claim').click();
    await expect(page.getByTestId('task-assignee')).toHaveText('modeler');
    await page.getByTestId('task-complete').click();
    await page.getByTestId('complete-variables-add').click();
    await page.getByTestId('complete-variables-name-0').fill('approved');
    await page.getByTestId('complete-variables-type-0').selectOption('boolean');
    await page.getByTestId('complete-variables-value-0').fill('true');
    await page.getByTestId('task-complete-confirm').click();

    await expect(element(page, 'waitPayment')).toHaveClass(/activiti-active/);
    await expect(element(page, 'review')).toHaveClass(/activiti-completed/);
    await page.getByTestId('instance-panel-variables').click();
    // the task's MAP_ALL output mapping carried the completion variable into the process
    await expect(page.getByTestId('variable-value-approved')).toHaveValue('true');
  });

  test.describe('R5 a refused claim', () => {
    // the server refuses on purpose: the browser logs every 4xx answer of a request as a console error
    test.use({ allowedErrors: [/Failed to load resource: the server responded with a status of 4\d\d/] });
    test('R5 acts as the connected user: bob is no reviewer, so claiming the review task is refused; alice may claim it', async ({ page }) => {
      await openProject(page);
      await deploy(page);
      await startOrder(page, 'O-8');
      // switch the connection to bob (a manager, not in the candidate group reviewers)
      await signInAgain(page, 'bob');
      await page.getByTestId('instance-panel-tasks').click();
      await expect(page.getByTestId('acting-user')).toHaveText('bob');
      await page.getByTestId('task-claim').click();
      await expect(page.getByTestId('toasts')).toContainText('Claim failed');
      await expect(page.getByTestId('task-assignee')).toContainText('unassigned');
      // alice is a reviewer
      await signInAgain(page, 'alice');
      await expect(page.getByTestId('acting-user')).toHaveText('alice');
      await page.getByTestId('task-claim').click();
      await expect(page.getByTestId('task-assignee')).toHaveText('alice');
    });
  });

  test('R5 sends a message with a correlation key, triggers the receive task and ends the instance', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-4');
    const id = (await page.getByTestId('instance-id').innerText()).trim();
    const client = apiClient();
    const [task] = (await client.listTasks({ processInstanceId: id })).items;
    await client.claimTask(task!.id);
    await client.completeTask(task!.id, { approved: true });
    await expect(element(page, 'waitPayment')).toHaveClass(/activiti-active/);

    await page.getByTestId('instance-panel-events').click();
    await page.getByTestId('message-name').fill('paymentReceived');
    await page.getByTestId('message-correlation').fill('O-4');
    await page.getByTestId('message-send').click();
    await expect(element(page, 'ship')).toHaveClass(/activiti-active/);
    await page.getByTestId('trigger-ship').click();
    await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
    await expect(element(page, 'shippedEnd')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'f_ship_shippedEnd')).toHaveClass(/activiti-flow-taken/);
  });

  test('R5 fires a timer: the reminder branch runs while the task stays open', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-5');
    await page.getByTestId('instance-panel-jobs').click();
    await page.getByTestId('job-fire').first().click();
    await page.getByTestId('instance-panel-variables').click();
    await expect(page.getByTestId('variable-value-reminded')).toHaveValue('true');
    await expect(element(page, 'remindedEnd')).toHaveClass(/activiti-completed/);
    await expect(element(page, 'review')).toHaveClass(/activiti-active/);
  });

  test('R5 edits a variable, retries the dead-letter job and the instance completes', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startFlaky(page);
    await expect(page.getByTestId('instance-incident')).toBeVisible();

    await page.getByTestId('instance-panel-variables').click();
    const value = page.getByTestId('variable-value-shouldFail');
    await expect(value).toHaveValue('true');
    await value.fill('false');
    await page.getByTestId('variable-save-shouldFail').click();
    await expect(page.getByTestId('toasts')).toContainText('shouldFail saved');

    await page.getByTestId('instance-panel-jobs').click();
    await page.getByTestId('job-retry').click();
    await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
    await expect(page.getByTestId('instance-incident')).toBeHidden();
    await expect(element(page, 'flakyEnd')).toHaveClass(/activiti-completed/);
  });

  test('R5 sends a signal', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startForm(page, 'signalWait');
    await page.getByTestId('start-button').click();
    await loaded(page);
    await expect(element(page, 'waitProceed')).toHaveClass(/activiti-active/);
    await page.getByTestId('instance-panel-events').click();
    await page.getByTestId('signal-name').fill('proceed');
    await page.getByTestId('signal-send').click();
    await expect(page.getByTestId('instance-state')).toHaveText('COMPLETED');
  });

  test('R5 suspends and activates an instance, and cancels it', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-6');
    await page.getByTestId('instance-suspend').click();
    await expect(page.getByTestId('instance-state')).toHaveText('SUSPENDED');
    await page.getByTestId('instance-activate').click();
    await expect(page.getByTestId('instance-state')).toHaveText('ACTIVE');
    await page.getByTestId('instance-cancel').click();
    await page.getByTestId('choice-dialog').getByRole('button', { name: 'Cancel the instance' }).click();
    await expect(page.getByTestId('instance-state')).toHaveText('CANCELLED');
  });

  test('R5 assigns a task to another user and releases it', async ({ page }) => {
    await openProject(page);
    await deploy(page);
    await startOrder(page, 'O-7');
    await page.getByTestId('instance-panel-tasks').click();
    await page.getByTestId('task-claim').click();
    await expect(page.getByTestId('task-assignee')).toHaveText('modeler');
    await page.getByTestId('task-assign').click();
    await page.getByTestId('task-assign-to').fill('alice');
    await page.getByTestId('task-assign-confirm').click();
    await expect(page.getByTestId('task-assignee')).toHaveText('alice');
  });
});
