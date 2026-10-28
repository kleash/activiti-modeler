import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Page } from '@playwright/test';

import { expectWatermarkVisible } from '../support/watermark';
import { apiClient, expect, freshCopy, openServerProject, runMenu, signIn, test, workspaceDir } from './support';

/** R6: the scenario editor (form, JSON, schema check) and the runner (POST /api/dev/scenarios/run on the live engine, async executor on). */

async function open(page: Page, source: string, prepare?: (dir: string) => void): Promise<string> {
  const name = freshCopy(source);
  prepare?.(join(workspaceDir(), name));
  await page.goto('/');
  await expect(page.getByTestId('status-server')).toBeVisible();
  await signIn(page);
  await openServerProject(page, name);
  return name;
}

const card = (page: Page, name: string) => page.getByTestId(`scenario-result-${name}`);

test('R6 runs a scenario file: pass / fail per scenario and step, and the path on the diagram', async ({ page }) => {
  await open(page, 'run-demo');
  await runMenu(page, 'Scenarios');
  await page.getByTestId('scenario-run-order-review.scenario.json').click();
  const summary = page.getByTestId('scenario-summary');
  await expect(summary).toContainText('Passed');
  await expect(summary).toContainText('3 scenarios');
  for (const name of ['an approved order is paid and shipped', 'a rejected order ends at once', 'the reminder fires while the review is open']) {
    await expect(card(page, name)).toHaveAttribute('data-status', 'PASSED');
  }
  // every step is listed with its result
  const approved = card(page, 'an approved order is paid and shipped');
  await expect(approved.locator('[data-status="PASSED"]').first()).toBeVisible();
  await expect(approved).toContainText('completeTask');
  await expect(approved.locator('li[data-status="FAILED"]')).toHaveCount(0);

  // the path of the selected scenario on the diagram: visited elements and flows
  await approved.getByRole('button', { name: 'an approved order is paid and shipped' }).click();
  const path = page.getByTestId('scenario-diagram');
  await expect(page.getByTestId('scenario-diagram-canvas')).toHaveAttribute('data-loaded', 'true');
  await expect(path.locator('.djs-element[data-element-id="shippedEnd"]')).toHaveClass(/activiti-completed/);
  await expect(path.locator('.djs-element[data-element-id="f_waitPayment_ship"]')).toHaveClass(/activiti-flow-taken/);
  await expect(path.locator('.djs-element[data-element-id="rejectedEnd"]')).not.toHaveClass(/activiti-completed/);
  await expectWatermarkVisible(page, 'scenario path', '[data-testid="scenario-diagram"]');

  // the run left nothing behind on the server
  expect((await apiClient().listProcessInstances()).items.filter((i) => i.state === 'ACTIVE')).toHaveLength(0);
  expect((await apiClient().listDeployments()).items).toHaveLength(0);
});

test('R6 a failing assertion is shown with the step that failed and the reason', async ({ page }) => {
  await open(page, 'run-demo', (dir) => {
    writeFileSync(
      join(dir, 'scenarios', 'failing.scenario.json'),
      JSON.stringify({
        name: 'Failing',
        users: { alice: ['reviewers'] },
        scenarios: [
          {
            name: 'expects the wrong end event',
            start: { process: 'orderReview', user: 'alice', variables: { orderId: 'F-1' } },
            steps: [{ completeTask: { activity: 'review', user: 'alice', variables: { approved: false } } }],
            expect: { state: 'COMPLETED', endEvents: ['shippedEnd'] },
          },
          {
            name: 'a step that cannot work',
            start: { process: 'orderReview', user: 'alice', variables: { orderId: 'F-2' } },
            steps: [{ expectActive: ['ship'] }, { executeJobs: {} }],
          },
        ],
      }),
    );
  });
  await runMenu(page, 'Scenarios');
  await page.getByTestId('scenario-run-failing.scenario.json').click();
  await expect(page.getByTestId('scenario-summary')).toContainText('Failed (2)');
  const wrong = card(page, 'expects the wrong end event');
  await expect(wrong).toHaveAttribute('data-status', 'FAILED');
  await expect(wrong.getByTestId('scenario-failures')).toContainText('shippedEnd');
  const broken = card(page, 'a step that cannot work');
  await expect(broken.locator('li[data-status="FAILED"]')).toHaveCount(1);
  await expect(broken.locator('li[data-status="SKIPPED"]')).toHaveCount(1);
  await expect(broken).toContainText('expectActive');
  await expect(page.getByTestId('scenario-file-failing.scenario.json')).toHaveAttribute('data-status', 'failed');
  // the text report of the runner is there too
  await page.getByRole('button', { name: 'text report' }).click();
  await expect(page.getByTestId('scenario-rendered')).toContainText('[FAIL]');
});

test('R6 runs every scenario file of a corpus project through the server', async ({ page }) => {
  await open(page, 'C12-misc-flow');
  await runMenu(page, 'Run all scenarios');
  await expect(page.getByTestId('scenario-file-implicit-split.scenario.json')).toHaveAttribute('data-status', 'passed', { timeout: 60_000 });
  await expect(page.getByTestId('scenario-file-link-events.scenario.json')).toHaveAttribute('data-status', 'passed');
  await expect(page.getByTestId('scenario-file-receive-task.scenario.json')).toHaveAttribute('data-status', 'passed');
});

test.describe('R6 a refused project', () => {
  // the server refuses on purpose: the browser logs every 4xx answer of a request as a console error
  test.use({ allowedErrors: [/Failed to load resource: the server responded with a status of 4\d\d/] });
  test('R6 the server refuses a project with errors and the report says which', async ({ page }) => {
    await open(page, 'rule-check', (dir) => {
      const scenarios = join(dir, 'scenarios');
      mkdirSync(scenarios, { recursive: true });
      writeFileSync(join(scenarios, 'rules.scenario.json'), JSON.stringify({ name: 'Rules', scenarios: [{ name: 'starts', start: { process: 'ruleCheck' } }] }));
    });
    await runMenu(page, 'Scenarios');
    await page.getByTestId('scenario-run-rules.scenario.json').click();
    await expect(page.getByTestId('scenario-error')).toBeVisible();
    await expect(page.getByTestId('scenario-error')).toContainText(/error|NullPointer|business rule/i);
  });
});

test.describe('the scenario editor', () => {
  test('R6 form and JSON are one document; the schema check names the problem and the place', async ({ page }) => {
    const name = await open(page, 'run-demo');
    await page.getByTestId('explorer').getByText('order-review.scenario.json').dblclick();
    const editor = page.getByTestId('scenario-editor');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('scenario-schema-status')).toContainText('Valid against the scenario schema');

    // a change in the form is in the JSON (the editor draws only the lines in view, so it is the first scenario that is looked at)
    await page.getByTestId('scenario0-name').fill('an approved order is paid and shipped, fast');
    await expect(editor.locator('.cm-content')).toContainText('an approved order is paid and shipped, fast');
    await page.getByTestId('scenario0-name').fill('an approved order is paid and shipped');
    await page.getByTestId('scenario1-name').fill('a rejected order ends right away');
    await expect(page.getByTestId('tab-order-review.scenario.json')).toHaveClass(/dirty/);

    // a step: the form edits one field of the step
    await page.getByTestId('scenario1-step0-variables').fill('{"approved": true}');
    await page.getByTestId('scenario1-step0-variables').fill('{"approved": false}');

    // an invalid document: the user of a completeTask step is required
    await page.getByTestId('scenario1-step0-user').fill('');
    await expect(page.getByTestId('scenario-schema-status')).toContainText('1 schema problem');
    await expect(page.getByTestId('scenario-schema-problems')).toContainText('/scenarios/1/steps/0/completeTask: needs the property "user"');
    // the editor marks the place in the JSON (it draws the lines in view only, so a problem near the top shows it: the name of the first scenario)
    await page.getByTestId('scenario0-name').fill('');
    await expect(editor.locator('.cm-lintRange-error').first()).toBeVisible();
    await page.getByTestId('scenario0-name').fill('an approved order is paid and shipped');
    // the form fixes it
    await page.getByTestId('scenario1-step0-user').fill('alice');
    await expect(page.getByTestId('scenario-schema-status')).toContainText('Valid against the scenario schema');

    // adding a step from the menu
    await page.getByTestId('scenario1-add-step').selectOption('executeJobs');
    await expect(page.getByTestId('scenario1-step1')).toHaveAttribute('data-step-type', 'executeJobs');

    // save writes the document
    await page.keyboard.press('Control+S');
    await expect(page.getByTestId('tab-order-review.scenario.json')).not.toHaveClass(/dirty/);
    const saved = JSON.parse(readFileSync(join(workspaceDir(), name, 'scenarios', 'order-review.scenario.json'), 'utf8')) as { scenarios: Array<{ name: string; steps: unknown[] }> };
    expect(saved.scenarios[1]!.name).toBe('a rejected order ends right away');
    expect(saved.scenarios[1]!.steps).toEqual([{ completeTask: { activity: 'review', user: 'alice', variables: { approved: false } } }, { executeJobs: {} }]);
  });

  test('R6 a syntax error in the JSON is marked and the form waits', async ({ page }) => {
    await open(page, 'run-demo');
    await page.getByTestId('explorer').getByText('flaky.scenario.json').dblclick();
    const editor = page.getByTestId('scenario-editor');
    await page.getByTestId('scenario-view-json').click();
    await editor.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('}}');
    await expect(page.getByTestId('scenario-schema-status')).toContainText('schema problem');
    await expect(page.getByTestId('scenario-schema-problems')).toContainText('Invalid JSON');
    await page.getByTestId('scenario-view-form').click();
    await expect(editor).toContainText('The form needs a JSON object');
  });

  test('R6 "Run scenario" saves and runs the file on the server and shows the report under the editor', async ({ page }) => {
    await open(page, 'run-demo');
    await page.getByTestId('explorer').getByText('flaky.scenario.json').dblclick();
    await page.getByTestId('scenario-run').click();
    const report = page.getByTestId('scenario-report');
    await expect(report).toHaveAttribute('data-passed', 'true', { timeout: 60_000 });
    await expect(report).toContainText('the call fails until it is a dead letter');
    await expect(report).toContainText('without the failure the call succeeds');
  });
});
