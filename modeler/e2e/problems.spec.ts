import { expect } from '@playwright/test';

import { activePanel, menu, openApp, selected } from './support/app';
import { dropCase, n01Oracle, openProblems, problemIds, problemRows, problemsPanel, rows } from './support/lint';
import { ModelerApi } from './support/modelerApi';
import { test } from './support/test';

declare global {
  interface Window {
    __focusEvents?: Array<Record<string, unknown>>;
    __modelerLint?: {
      connectMockServer(problems: Array<Record<string, unknown>>, options?: { asyncExecutorActive?: boolean }): void;
      sentFiles(): string[];
      problems(): Promise<Array<{ rule: string; path: string; elementId?: string; severity: string; message: string }>>;
      checkDeployable(): Promise<{ deployable: boolean; counts: { error: number; warning: number; info: number } }>;
    };
  }
}

const oracle = n01Oracle();

const focusedEntry = (page: import('@playwright/test').Page): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-entry-id]')?.getAttribute('data-entry-id') ?? null);

/** Loads one N01 case into a fresh app and opens the Problems tab. */
async function load(page: import('@playwright/test').Page, file: string): Promise<string> {
  await openApp(page);
  const path = await dropCase(page, file, oracle[file]!);
  await openProblems(page);
  return path;
}

test.describe('U11 lint and the Problems panel', () => {
  test('U11 activiti/no-business-rule-task: the Problems tab lists the problem with its severity, element, rule and documentation link', async ({ page }) => {
    const path = await load(page, 'business-rule-task.bpmn20.xml');
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/no-business-rule-task@decide']);
    const row = problemRows(page).first();
    await expect(row).toHaveAttribute('data-severity', 'error');
    await expect(row).toContainText('Decide the grade');
    await expect(row.locator('a.problem-rule')).toHaveAttribute('href', /lint-rules\/no-business-rule-task\.md$/);
    await expect(row.getByTestId('problem-fix')).toContainText('Decision task');
  });

  test('U11 the status bar counts the errors and warnings of the project and opens the Problems tab', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('status-problems')).toContainText('0 errors');
    const path = await dropCase(page, 'business-rule-task.bpmn20.xml', oracle['business-rule-task.bpmn20.xml']!);
    await expect(page.getByTestId('status-errors')).toContainText('1');
    // the new process of the project only has style warnings
    await expect(page.getByTestId('status-warnings')).toContainText('4');
    await page.getByTestId('status-problems').click();
    await expect(problemsPanel(page)).toBeVisible();
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/no-business-rule-task@decide']);
  });

  test('U11 the canvas shows an overlay with the problems of the element, and the lint button toggles them', async ({ page }) => {
    await load(page, 'business-rule-task.bpmn20.xml');
    const overlay = activePanel(page).locator('.bjsl-overlay');
    await expect(overlay.first()).toBeVisible();
    await expect(overlay.locator('.bjsl-icon-error').first()).toBeVisible();
    await expect(activePanel(page).locator('.bjsl-button')).toBeVisible();
  });

  test('U11 activiti/invalid-timer-value: a click on a problem selects the element and emits activiti.lint.focus with the field of the entry', async ({ page }) => {
    await load(page, 'invalid-timer.bpmn20.xml');
    await page.evaluate(() => {
      window.__focusEvents = [];
      window.addEventListener('activiti.lint.focus', (e) => window.__focusEvents!.push({ ...((e as CustomEvent).detail as object) }));
    });
    await problemRows(page).first().getByRole('button').first().click();
    await expect(selected(page)).toHaveAttribute('data-element-id', 'start');
    const events = await page.evaluate(() => window.__focusEvents);
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({ elementId: 'start', entryId: 'timer.definition' });
  });

  test('U11 activiti/invalid-timer-value: the click focuses the field of the entry in the real properties panel', async ({ page }) => {
    await load(page, 'invalid-timer.bpmn20.xml');
    await problemRows(page).first().getByRole('button').first().click();
    await expect.poll(() => focusedEntry(page)).toBe('timer.definition.value');
    await expect(page.locator('#properties-panel-slot [data-entry-id="timer.definition.value"]')).toBeVisible();
  });

  test('U11 activiti/skip-expression-needs-enable-variable: the click focuses the skip expression of the user task', async ({ page }) => {
    const path = await load(page, 'skip-expression.bpmn20.xml');
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/skip-expression-needs-enable-variable@review']);
    await problemRows(page).filter({ hasText: 'skip' }).first().getByRole('button').first().click();
    await expect(selected(page)).toHaveAttribute('data-element-id', 'review');
    await expect.poll(() => focusedEntry(page)).toBe('skip.expression');
  });

  test('U11 the severity buttons and the file selector filter the list', async ({ page }) => {
    await openApp(page);
    await dropCase(page, 'invalid-timer.bpmn20.xml', oracle['invalid-timer.bpmn20.xml']!);
    await dropCase(page, 'group.bpmn20.xml', oracle['group.bpmn20.xml']!);
    await openProblems(page);
    await expect.poll(async () => (await rows(page)).map((r) => r.path)).toEqual(expect.arrayContaining(['processes/invalid-timer.bpmn20.xml', 'processes/group.bpmn20.xml']));
    const all = (await rows(page)).length;
    // warnings only: the group is a warning
    await page.getByTestId('filter-error').click();
    await expect.poll(async () => (await rows(page)).every((r) => r.severity !== 'error')).toBe(true);
    expect((await rows(page)).length).toBeLessThan(all);
    await page.getByTestId('filter-error').click();
    // one file
    await page.getByTestId('problems-file').selectOption('processes/group.bpmn20.xml');
    await expect.poll(async () => [...new Set((await rows(page)).map((r) => r.path))]).toEqual(['processes/group.bpmn20.xml']);
    await page.getByTestId('problems-file').selectOption('');
    await expect.poll(async () => (await rows(page)).length).toBe(all);
  });

  test('U11 the lint runs on the whole project: problems of a file that is not open are listed, and a click opens it', async ({ page }) => {
    await openApp(page);
    await dropCase(page, 'invalid-timer.bpmn20.xml', oracle['invalid-timer.bpmn20.xml']!);
    await dropCase(page, 'business-rule-task.bpmn20.xml', oracle['business-rule-task.bpmn20.xml']!);
    await openProblems(page);
    // the business rule task file is the open one; the timer problem belongs to the other file
    await expect.poll(() => problemIds(page, 'processes/invalid-timer.bpmn20.xml')).toEqual(['activiti/invalid-timer-value@start']);
    await problemRows(page).filter({ has: page.locator('.problem-rule', { hasText: 'invalid-timer-value' }) }).getByRole('button').first().click();
    await expect(page.getByTestId('tab-invalid-timer.bpmn20.xml')).toHaveClass(/active/);
    await expect(selected(page)).toHaveAttribute('data-element-id', 'start');
  });

  test('U11 the lint follows the edits: it runs after a debounce and clears a problem that was fixed', async ({ page }) => {
    const api = await ModelerApi.open(page);
    await api.createProject('lint-live');
    await api.newProcess('live');
    const id = await api.createShape({ type: 'bpmn:ServiceTask', id: 'svc', name: 'Call' });
    await openProblems(page);
    await expect.poll(() => problemIds(page)).toContain('activiti/service-task-missing-implementation@svc');
    await api.setProperty(id, 'impl.class', 'com.example.Call');
    await expect.poll(() => problemIds(page)).not.toContain('activiti/service-task-missing-implementation@svc');
  });

  test('U11 activiti/no-business-rule-task: the quick fix is one undoable step', async ({ page }) => {
    await openApp(page);
    const path = await dropCase(page, 'business-rule-task.bpmn20.xml', oracle['business-rule-task.bpmn20.xml']!);
    await openProblems(page);
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/no-business-rule-task@decide']);
    await problemRows(page).first().getByTestId('problem-fix').click();
    // the task is a decision task now, mapped, and the decision is found: only the note about the DMN connector is left
    await expect(page.getByTestId('toasts')).toContainText('Convert to a Decision task: done');
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/decision-task-needs-dmn-connector@decide']);
    await menu(page, 'Edit', 'Undo');
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/no-business-rule-task@decide']);
    await menu(page, 'Edit', 'Redo');
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/decision-task-needs-dmn-connector@decide']);
  });

  test('U11 the server problems are merged, tagged engine and not repeated when the client rule has the same key on the element', async ({ page }) => {
    await openApp(page);
    const path = await dropCase(page, 'business-rule-task.bpmn20.xml', oracle['business-rule-task.bpmn20.xml']!);
    await openProblems(page);
    await expect(page.getByTestId('validate-server')).toHaveCount(0);
    await page.evaluate((p) => {
      window.__modelerLint!.connectMockServer([
        { path: p, elementId: 'decide', key: 'trial-deploy', severity: 'error', message: 'trial deployment failed: NullPointerException', source: 'engine' },
        { path: p, elementId: 'decide', key: 'ENGINE_ONLY', severity: 'error', message: 'only the engine knows', source: 'engine' },
      ]);
    }, path);
    await page.getByTestId('validate-server').click();
    await expect.poll(async () => (await rows(page)).filter((r) => r.source === 'engine').map((r) => r.key)).toEqual(['ENGINE_ONLY']);
    // the duplicate of the client's own finding is not listed twice
    expect((await rows(page)).filter((r) => r.path === path && r.element === 'decide')).toHaveLength(2);
    expect(await page.evaluate(() => window.__modelerLint!.sentFiles())).toContain(path);
  });

  test('U11 the deploy gate refuses a project with errors and passes a clean one', async ({ page }) => {
    await openApp(page);
    const path = await dropCase(page, 'business-rule-task.bpmn20.xml', oracle['business-rule-task.bpmn20.xml']!);
    await openProblems(page);
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/no-business-rule-task@decide']);
    const refused = await page.evaluate(() => window.__modelerLint!.checkDeployable());
    expect(refused.deployable).toBe(false);
    expect(refused.counts.error).toBeGreaterThan(0);
    await problemRows(page).first().getByTestId('problem-fix').click();
    // the decision task keeps its note about the DMN connector: a note does not block a deployment
    await expect.poll(() => problemIds(page, path)).toEqual(['activiti/decision-task-needs-dmn-connector@decide']);
    await expect.poll(() => page.evaluate(() => window.__modelerLint!.checkDeployable().then((r) => r.deployable))).toBe(true);
  });
});
