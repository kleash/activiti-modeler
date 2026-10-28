import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';

import { dropFiles, idbFiles, menu, openApp, tab } from './support/app';
import { exportZip, openProblems, problemIds } from './support/lint';
import { ModelerApi } from './support/modelerApi';
import { test } from './support/test';

/** U17: a Camunda 7 file offers its conversion to Activiti; what cannot be translated is in a report that can be saved as Markdown. */

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/activiti-project/test/fixtures/camunda');
const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8');

const strip = (page: import('@playwright/test').Page) => page.getByTestId('camunda-offer');
const reportDialog = (page: import('@playwright/test').Page) => page.getByTestId('loss-report-dialog');

async function importFixture(page: import('@playwright/test').Page, name: string): Promise<void> {
  await openApp(page);
  await dropFiles(page, [{ name, content: fixture(name) }]);
}

test.describe('U17 Camunda 7 import', () => {
  test('U17 opening a Camunda 7 file shows the offer; the file lints with the Camunda problems until it is converted', async ({ page }) => {
    await importFixture(page, 'order-approval.bpmn');
    await expect(tab(page, 'order-approval.bpmn20.xml')).toBeVisible();
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText('Camunda 7 extensions');
    await expect(strip(page)).toContainText('Activiti does not run them');
    await openProblems(page);
    await expect.poll(async () => (await problemIds(page, 'processes/order-approval.bpmn20.xml')).some((id) => id.startsWith('activiti/no-camunda-extensions'))).toBe(true);
  });

  test('U17 "Keep as is" hides the offer and leaves the file as it was', async ({ page }) => {
    await importFixture(page, 'order-approval.bpmn');
    await expect(strip(page)).toBeVisible();
    await page.getByTestId('camunda-keep').click();
    await expect(strip(page)).toHaveCount(0);
    expect((await idbFiles(page))['processes/order-approval.bpmn20.xml']).toContain('camunda:historyTimeToLive');
  });

  test('U17 Convert translates the file, opens the report with element, what and why, and the tab is unsaved until it is saved', async ({ page }) => {
    await importFixture(page, 'order-approval.bpmn');
    await page.getByTestId('camunda-convert').click();
    await expect(reportDialog(page)).toBeVisible();
    await expect(page.getByTestId('loss-report-summary')).toContainText('translated');
    // an entry per lost thing: the element id, what it was, what happened, why
    const entry = reportDialog(page).locator('[data-testid="loss-entry"][data-element="reviewOrder"]', { hasText: 'followUpDate' });
    await expect(entry).toContainText('camunda:followUpDate');
    await expect(entry).toContainText('dropped');
    await expect(entry).toContainText('Activiti has no follow-up date');
    await expect(reportDialog(page).locator('[data-testid="loss-entry"][data-element="checkStock"]', { hasText: 'asyncAfter' })).toContainText('only an asynchronous continuation before');
    await expect(reportDialog(page).locator('[data-kind="info"]').first()).toBeVisible();
    await page.getByTestId('loss-report-close').click();
    await expect(reportDialog(page)).toHaveCount(0);

    await expect(strip(page)).toHaveCount(0);
    await expect(tab(page, 'order-approval.bpmn20.xml')).toHaveClass(/dirty/);
    // nothing is written until the person saves
    expect((await idbFiles(page))['processes/order-approval.bpmn20.xml']).toContain('camunda:historyTimeToLive');
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'order-approval.bpmn20.xml')).not.toHaveClass(/dirty/);

    const files = await idbFiles(page);
    const xml = files['processes/order-approval.bpmn20.xml']!;
    expect(xml).not.toMatch(/camunda/i);
    expect(xml).toContain('activiti:assignee="${reviewer}"');
    expect(xml).toContain('activiti:async="true"');
    expect(xml).toMatch(/<activiti:taskListener[^>]*event="create"/);
    expect(xml).not.toContain('event="update"');
    const extensions = JSON.parse(files['processes/order-approval-extensions.json']!) as { extensions: Record<string, { mappings: Record<string, { inputs?: Record<string, unknown>; outputs?: Record<string, unknown> }> }> };
    expect(Object.keys(extensions.extensions['orderApproval']!.mappings['reviewOrder']!.inputs!)).toEqual(['orderTotal', 'channel', 'regions', 'limits']);
    expect(extensions.extensions['orderApproval']!.mappings['reviewOrder']!.outputs).toEqual({ approved: { type: 'VARIABLE', value: 'decision' }, reviewedBy: { type: 'VALUE', value: 'anna' } });
  });

  test('U17 the converted file passes the export checks and the lint: no Camunda problem is left, the zip has no Camunda namespace', async ({ page }, testInfo) => {
    await importFixture(page, 'invoice-processing.bpmn');
    await page.getByTestId('camunda-convert').click();
    await page.getByTestId('loss-report-close').click();
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'invoice-processing.bpmn20.xml')).not.toHaveClass(/dirty/);
    const problems = await page.evaluate(() => window.__modelerLint!.problems());
    const mine = problems.filter((p) => p.path === 'processes/invoice-processing.bpmn20.xml');
    expect(mine.map((p) => p.rule)).not.toContain('activiti/no-camunda-extensions');
    expect(mine.map((p) => p.rule)).not.toContain('activiti/foreign-attribute-namespace');
    // what the lint still says is about Activiti: an external task without an implementation, a groovy script
    expect(mine.some((p) => p.elementId === 'validateSupplier')).toBe(true);
    const exported = await exportZip(page, testInfo);
    for (const [name, content] of Object.entries(exported)) expect(content, name).not.toMatch(/camunda\.org|\bcamunda:[A-Za-z]|zeebe/);
  });

  test('U17 the report can be saved as Markdown, with a table of what was dropped and why', async ({ page }) => {
    await importFixture(page, 'order-approval.bpmn');
    await page.getByTestId('camunda-convert').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('loss-report-save').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('order-approval.camunda-import.md');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const md = Buffer.concat(chunks).toString('utf8');
    expect(md).toContain('# Camunda 7 import report: order-approval.bpmn20.xml');
    expect(md).toContain('## Dropped');
    expect(md).toContain('| Element | Type | Item | What happened | Why |');
    expect(md).toContain('`camunda:followUpDate=');
    expect(md).toContain('Activiti has no follow-up date for a task');
    expect(md).toContain('## Converted');
  });

  test('U17 the File menu opens the report again, and converts a file that was kept', async ({ page }) => {
    await importFixture(page, 'call-and-subprocess.bpmn');
    await page.getByTestId('camunda-keep').click();
    await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
    await menu(page, 'File', 'Convert Camunda 7 extensions…');
    await expect(reportDialog(page)).toBeVisible();
    await expect(reportDialog(page).locator('[data-element="pickAndPack"]', { hasText: 'calledElementTenantId' })).toContainText('Activiti has no tenants');
    await page.keyboard.press('Escape');
    await expect(reportDialog(page)).toHaveCount(0);
    await menu(page, 'File', 'Camunda 7 import report…');
    await expect(reportDialog(page)).toBeVisible();
  });

  test('U17 the converted call activity, listeners and mappings are what the panel shows', async ({ page }) => {
    await importFixture(page, 'call-and-subprocess.bpmn');
    await page.getByTestId('camunda-convert').click();
    await page.getByTestId('loss-report-close').click();
    const api = await ModelerApi.attach(page);
    expect(await api.getProperty('pickAndPack', 'call.inheritVariables')).toBe(true);
    expect(await api.getProperty('pickAndPack', 'call.inheritBusinessKey')).toBe(true);
    expect(await api.getProperty('pickAndPack', 'call.in')).toEqual([
      { source: 'orderId', target: 'orderRef' },
      { sourceExpression: '${order.items.size()}', target: 'itemCount' },
    ]);
    expect(await api.getProperty('pickAndPack', 'mapping.type')).toBe('MAP_ALL_OUTPUTS');
    expect(await api.getProperty('bookCarrier', 'call.businessKey')).toBe('${orderNumber}');
    expect(await api.getProperty('labelling', 'async.async')).toBe(true);
  });

  test('U17 a Camunda 8 model says that only its structure is kept', async ({ page }) => {
    await importFixture(page, 'camunda8-zeebe.bpmn');
    await expect(strip(page)).toContainText('Camunda 8 (Zeebe)');
    await page.getByTestId('camunda-convert').click();
    await expect(reportDialog(page)).toContainText('Camunda 8 (Zeebe) model');
    await expect(reportDialog(page).locator('[data-testid="loss-entry"][data-element="work"]')).toHaveCount(2);
  });

  test('U17 a file with only the Camunda Modeler metadata converts without a loss', async ({ page }) => {
    await importFixture(page, 'modeler-attributes-only.bpmn20.xml');
    await expect(strip(page)).toContainText('metadata of the Camunda Modeler');
    await page.getByTestId('camunda-convert').click();
    await expect(page.getByTestId('loss-report-summary')).toContainText('0 dropped');
    await page.getByTestId('loss-report-close').click();
    await page.keyboard.press('Control+S');
    expect((await idbFiles(page))['processes/modeler-attributes-only.bpmn20.xml']).not.toContain('modeler:');
  });

  test('U17 a file without Camunda extensions shows no offer and the menu says there is nothing to convert', async ({ page }) => {
    await openApp(page);
    await expect(strip(page)).toHaveCount(0);
    await menu(page, 'File', 'Convert Camunda 7 extensions…');
    await expect(page.getByTestId('toasts')).toContainText('No Camunda extensions in this file');
  });

  test('U17 the test API imports a Camunda model through the same converter and exports it', async ({ page }) => {
    await openApp(page);
    const api = await ModelerApi.attach(page);
    await api.createProject('camunda', { defaultMappings: 'none' });
    const result = await api.importCamunda(fixture('call-and-subprocess.bpmn'), { fileName: 'call-and-subprocess.bpmn', defaultMappings: 'none' });
    expect(result.converted).toBe(true);
    expect(result.report.counts.dropped).toBeGreaterThan(3);
    const { files, warnings } = await api.exportProject();
    expect(warnings).toEqual([]);
    const bpmn = files.find((f) => f.path.endsWith('.bpmn20.xml'))!.content;
    expect(bpmn).not.toMatch(/camunda/i);
    expect(bpmn).toContain('activiti:inheritVariables="true"');
  });
});
