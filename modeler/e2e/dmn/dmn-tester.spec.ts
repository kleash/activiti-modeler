import { expect, type Page } from '@playwright/test';

import { test } from '../support/test';
import { activePanel, idbFiles, menu, newDmn, openApp, openView, tab } from './support';

test.use({ viewport: { width: 1600, height: 900 } });
test.setTimeout(90_000);

const EVALUATE = '**/api/dev/decisions/evaluate';
const tester = (page: Page) => page.getByTestId('decision-tester');

interface Evaluated {
  dmn: string;
  decisionRef: string;
  inputs: Record<string, unknown>;
}

/** The modeler server's answer for the `pricing` table of the template: amount 500 matches the first rule. */
const outcome = (rule: string, route: string) => ({
  decisionId: 'pricing',
  matched: true,
  rows: [{ route }],
  matchedRules: [rule],
  engine: 'operaton',
  decisions: [{ decisionId: 'pricing', decisionName: 'pricing', kind: 'DECISION_TABLE', hitPolicy: 'UNIQUE', multiResult: false, rows: [{ route }], matchedRules: [rule] }],
});

const ENGINE = {
  activitiVersion: '9.0.0', springBootVersion: '3.5.16', javaVersion: '25', historyLevel: 'full', dbHistoryUsed: true,
  asyncExecutor: { active: true, configured: true }, dmn: { available: true, engine: 'operaton' }, basePath: '/api', beans: [], connectors: [], scriptEngines: [],
};

/** The tester uses the one connection of the modeler (Run > Connect to server): here a mocked server that accepts modeler / modeler. */
async function connectToMockServer(page: Page): Promise<void> {
  await page.route('**/api/health', (route) => route.fulfill({ json: { app: 'activiti-modeler-server', status: 'UP' } }));
  await page.route('**/api/engine', (route) => route.fulfill({ json: ENGINE }));
  await page.getByTestId('status-server').click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill('modeler');
  await dialog.getByTestId('connection-password').fill('modeler');
  await dialog.getByTestId('connection-connect').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status-server')).toHaveAttribute('data-status', 'connected');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('DM10 the decision tester evaluates the open decision with typed inputs through the server, shows the rows and marks the matched rule in the table', async ({ page }) => {
  const requests: Evaluated[] = [];
  await page.route(EVALUATE, async (route) => {
    const body = route.request().postDataJSON() as Evaluated;
    requests.push(body);
    const small = Number(body.inputs['amount']) < 1000;
    await route.fulfill({ json: outcome(small ? 'pricing_small' : 'pricing_large', small ? 'standard' : 'review') });
  });
  await connectToMockServer(page);
  await newDmn(page, 'dmn-decision-table', 'pricing');
  await openView(page, 'pricing');
  await page.getByTestId('dmn-test-decision').click();
  await expect(tester(page)).toBeVisible();
  // the decision of the open view is preselected, its inputs come from the table (typed: amount is a number)
  await expect(page.getByTestId('tester-decision')).toHaveValue('pricing');
  await expect(tester(page).getByText('amount')).toBeVisible();

  // a text that is no number is refused before anything is sent
  await page.getByTestId('tester-input-amount').fill('lots');
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-error')).toContainText('"lots" is not a number');
  expect(requests).toHaveLength(0);

  await page.getByTestId('tester-input-amount').fill('500');
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-result')).toBeVisible();
  expect(requests).toHaveLength(1);
  // the model as edited goes along (the file is not saved), with the decision and the typed input
  expect(requests[0]!.decisionRef).toBe('pricing');
  expect(requests[0]!.inputs).toEqual({ amount: 500 });
  expect(requests[0]!.dmn).toContain('<decisionTable');
  expect(requests[0]!.dmn).toContain('id="pricing_small"');
  // rows, the matched flag, the engine and the matched rule ids
  await expect(page.getByTestId('tester-matched')).toContainText('A rule matched');
  await expect(page.getByTestId('tester-matched')).toContainText('operaton');
  await expect(page.getByTestId('tester-rows')).toContainText('standard');
  await expect(page.getByTestId('tester-matched-rules')).toHaveText('pricing_small');
  // the matched rule is marked in the decision table, the other one is not
  const rows = activePanel(page).locator('tr').filter({ has: page.locator('td.rule-index') });
  await expect(rows.nth(0)).toHaveClass(/activiti-matched-rule/);
  await expect(rows.nth(1)).not.toHaveClass(/activiti-matched-rule/);

  // another input: the marks of the old result go away with it, and the new evaluation marks the other rule
  await page.getByTestId('tester-input-amount').fill('5000');
  await expect(rows.nth(0)).not.toHaveClass(/activiti-matched-rule/);
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-rows')).toContainText('review');
  await expect(rows.nth(1)).toHaveClass(/activiti-matched-rule/);
  expect(requests.at(-1)!.inputs).toEqual({ amount: 5000 });
  // the tab is as it was: testing a decision changes nothing
  await expect(tab(page, 'pricing.dmn')).not.toHaveClass(/dirty/);
});

test('DM10 an empty field is not sent: the variable is missing and evaluates to null in FEEL', async ({ page }) => {
  const requests: Evaluated[] = [];
  await page.route(EVALUATE, async (route) => {
    requests.push(route.request().postDataJSON() as Evaluated);
    await route.fulfill({ json: { ...outcome('pricing_small', 'standard'), matched: false, rows: [], matchedRules: [] } });
  });
  await connectToMockServer(page);
  await newDmn(page, 'dmn-decision-table', 'pricing');
  await page.getByTestId('dmn-test-decision').click();
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-matched')).toContainText('No rule matched');
  await expect(page.getByTestId('tester-no-rows')).toBeVisible();
  expect(requests[0]!.inputs).toEqual({});
});

test.describe('the server refuses on purpose', () => {
  // the browser logs every 4xx answer of a request as a console error
  test.use({ allowedErrors: [/Failed to load resource: the server responded with a status of 4\d\d/] });
  test('DM10 without a connection the tester asks to connect; a wrong user and a failing decision are explained', async ({ page }) => {
    await newDmn(page, 'dmn-decision-table', 'pricing');
    await page.getByTestId('dmn-test-decision').click();
    await page.getByTestId('tester-input-amount').fill('500');
    // no connection: nothing is sent, the connection dialog of the modeler opens
    await expect(page.getByTestId('tester-server-summary')).toContainText('Not connected');
    await page.getByTestId('tester-evaluate').click();
    await expect(page.getByTestId('tester-error')).toContainText('Not connected to a modeler server');
    await expect(page.getByTestId('connection-dialog')).toBeVisible();
    await page.getByTestId('connection-dialog').getByRole('button', { name: /close|cancel/i }).first().click();

    await connectToMockServer(page);
    await expect(page.getByTestId('tester-server-summary')).toContainText('modeler@');
    // a server that refuses the user
    await page.route(EVALUATE, (route) => route.fulfill({ status: 403, contentType: 'application/problem+json', json: { title: 'Forbidden', status: 403, detail: 'Access Denied' } }));
    await page.getByTestId('tester-evaluate').click();
    await expect(page.getByTestId('tester-error')).toContainText('ROLE_ACTIVITI_ADMIN');
    await page.unroute(EVALUATE);
    await page.route(EVALUATE, (route) => route.fulfill({ status: 401, contentType: 'application/problem+json', json: { title: 'Unauthorized', status: 401 } }));
    await page.getByTestId('tester-evaluate').click();
    await expect(page.getByTestId('tester-error')).toContainText('did not accept the user "modeler"');
    // a decision that fails to evaluate: the server's own message
    await page.unroute(EVALUATE);
    await page.route(EVALUATE, (route) => route.fulfill({ status: 422, contentType: 'application/problem+json', json: { title: 'Unprocessable', status: 422, detail: "Decision 'pricing' fails: boom" } }));
    await page.getByTestId('tester-evaluate').click();
    await expect(page.getByTestId('tester-error')).toContainText("Decision 'pricing' fails: boom");
  });
});

test('DM5 / DM10 the tester evaluates a decision of a DRD and lists the decisions on the way', async ({ page }) => {
  await page.route(EVALUATE, async (route) => {
    const body = route.request().postDataJSON() as Evaluated;
    await route.fulfill({
      json: {
        decisionId: body.decisionRef,
        matched: true,
        rows: [{ offer: 'APPROVE' }],
        matchedRules: ['drd_offer_approve'],
        engine: 'operaton',
        decisions: [
          { decisionId: 'drd_riskClass', decisionName: 'drd_riskClass', kind: 'DECISION_TABLE', hitPolicy: 'UNIQUE', multiResult: false, rows: [{ drd_riskClass: 'LOW' }], matchedRules: ['drd_riskClass_low'] },
          { decisionId: 'drd_offer', decisionName: 'drd_offer', kind: 'DECISION_TABLE', hitPolicy: 'UNIQUE', multiResult: false, rows: [{ offer: 'APPROVE' }], matchedRules: ['drd_offer_approve'] },
        ],
      },
    });
  });
  await connectToMockServer(page);
  await newDmn(page, 'dmn-drd', 'drd');
  await page.getByTestId('dmn-test-decision').click();
  // the sink decision is preselected; what the whole DRD reads is asked for (score and amount), typed
  await expect(page.getByTestId('tester-decision')).toHaveValue('drd_offer');
  await expect(page.getByTestId('tester-input-score')).toBeVisible();
  await expect(page.getByTestId('tester-input-amount')).toBeVisible();
  await page.getByTestId('tester-input-score').fill('720');
  await page.getByTestId('tester-input-amount').fill('800');
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-steps')).toContainText('drd_riskClass');
  await expect(page.getByTestId('tester-steps')).toContainText('rules drd_riskClass_low');
  // the DRD marks the decisions that were evaluated
  await expect(activePanel(page).locator('.djs-element.activiti-evaluated')).toHaveCount(2);
  // the table of the required decision marks its rule
  await openView(page, 'drd_riskClass');
  await expect(activePanel(page).locator('tr.activiti-matched-rule')).toHaveCount(1);
  await expect(activePanel(page).locator('tr.activiti-matched-rule td.rule-index')).toHaveAttribute('data-row-id', 'drd_riskClass_low');
});

test('U33 the inputs of the tester are remembered per DMN file (and per decision), also after a reload', async ({ page }) => {
  await page.route(EVALUATE, (route) => route.fulfill({ json: outcome('pricing_small', 'standard') }));
  await connectToMockServer(page);
  await newDmn(page, 'dmn-decision-table', 'pricing');
  await activePanel(page).getByTestId('dmn-test-decision').click();
  await activePanel(page).getByTestId('tester-input-amount').fill('1234');
  await activePanel(page).getByTestId('tester-evaluate').click();
  await expect(activePanel(page).getByTestId('tester-result')).toBeVisible();
  // a second file has its own memory
  await menu(page, 'File', 'New file', 'DMN decision table');
  await page.getByTestId('prompt-input').fill('other');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'other.dmn')).toHaveClass(/active/);
  await activePanel(page).getByTestId('dmn-test-decision').click();
  await expect(activePanel(page).getByTestId('tester-input-amount')).toHaveValue('');
  await activePanel(page).getByTestId('tester-input-amount').fill('77');
  // close and reopen the first file: the form has what was typed
  await page.keyboard.press('Control+S');
  await tab(page, 'pricing.dmn').getByRole('tab').click();
  await expect(activePanel(page).getByTestId('tester-input-amount')).toHaveValue('1234');
  // after a reload (the workspace and the browser storage survive it)
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'pricing.dmn')).not.toHaveClass(/dirty/);
  await page.reload();
  await page.getByTestId('file-tree').getByRole('treeitem').filter({ hasText: 'pricing.dmn' }).dblclick();
  await expect(tab(page, 'pricing.dmn')).toHaveClass(/active/);
  await activePanel(page).getByTestId('dmn-test-decision').click();
  await expect(activePanel(page).getByTestId('tester-input-amount')).toHaveValue('1234');
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('activiti-modeler.decision-tester.v1:')).length)).toBe(2);
  void idbFiles;
});
