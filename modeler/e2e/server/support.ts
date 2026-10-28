import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { basicAuth, RuntimeClient } from '@activiti-modeler/runtime-client';
import { expect, type Page } from '@playwright/test';

import { test as base } from '../support/test';

export { expect };

/** Origin of the modeler server the global setup started. */
export const serverUrl = (): string => process.env['MODELER_SERVER_URL']!;
export const workspaceDir = (): string => process.env['MODELER_E2E_WORKSPACE']!;

/** A client of the server for the checks and the clean-up of the tests (it is not the app's own client). */
export function apiClient(user = 'modeler'): RuntimeClient {
  return new RuntimeClient({ baseUrl: serverUrl(), auth: basicAuth(user, user) });
}

/** Removes every deployment (with its instances, jobs and history), so that the next test starts on an empty engine. */
export async function cleanEngine(): Promise<void> {
  const client = apiClient();
  for (const deployment of (await client.listDeployments({ size: 200 })).items) {
    await client.devDeleteDeployment(deployment.id);
  }
}

let copies = 0;

/** Copies a project of the workspace to a fresh folder (a test may save into it) and returns the new name. */
export function freshCopy(project: string): string {
  const name = `${project}-${process.pid}-${++copies}`;
  cpSync(join(workspaceDir(), project), join(workspaceDir(), name), { recursive: true });
  return name;
}

export function removeProject(name: string): void {
  const dir = join(workspaceDir(), name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** `test` of the server specs: the page logs no unexpected errors, the base URL is the server's, the engine is empty after each test. */
export const test = base.extend<{ baseURL: string; project: string; emptyEngine: void }>({
  // The engine is empty before a test and after it (the server starts with an auto-deployment of its own; a hook registered in this
  // module would belong to the first spec file that loads it, a fixture belongs to every test).
  emptyEngine: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies from a destructuring pattern
    async ({}, use) => {
      await cleanEngine();
      await use();
      await cleanEngine();
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies from a destructuring pattern
  baseURL: async ({}, use) => use(serverUrl()),
  project: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies from a destructuring pattern
    async ({}, use) => {
      await use('run-demo');
    },
    { option: true },
  ],
});

/** Signs in through the connection dialog (the page is served by the server, so the URL stays empty). */
export async function signIn(page: Page, user = 'modeler'): Promise<void> {
  await page.getByTestId('status-server').click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill(user);
  await dialog.getByTestId('connection-password').fill(user);
  await dialog.getByTestId('connection-connect').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('status-server')).toHaveAttribute('data-status', 'connected');
}

/** Opens a project of the server workspace through File > Open server workspace (it needs the sign-in). */
export async function openServerProject(page: Page, name: string): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Open server workspace…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Open server workspace' }).getByTestId('prompt-confirm').click(); // the URL: the default is the server the page came from
  const projectDialog = page.getByRole('dialog', { name: 'Project on the server' });
  await projectDialog.getByTestId('prompt-input').fill(name);
  await projectDialog.getByTestId('prompt-confirm').click();
  await expect(page.getByTestId('status-storage')).toContainText(name);
}

/** Opens the page, signs in and opens a (fresh copy of a) project of the server workspace. Returns the project's name. */
export async function openProject(page: Page, source = 'run-demo', options: { copy?: boolean; user?: string } = {}): Promise<string> {
  const name = options.copy === false ? source : freshCopy(source);
  await page.goto('/');
  await expect(page.getByTestId('status-server')).toBeVisible();
  await signIn(page, options.user);
  await openServerProject(page, name);
  return name;
}

/** The run menu. */
export async function runMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Run', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
}

/**
 * Run > Deploy project; a project with warnings asks first, and the helper answers "Deploy anyway" (the warnings of the hand-written
 * projects are the lint's advice, not what a test is about). Resolves when the result is shown.
 */
export async function deployProject(page: Page): Promise<void> {
  await runMenu(page, 'Deploy project');
  const result = page.getByTestId('deploy-result');
  const choice = page.getByTestId('choice-dialog');
  await expect(result.or(choice)).toBeVisible();
  if (await choice.isVisible()) {
    await choice.getByRole('button', { name: 'Deploy anyway' }).click();
  }
  await expect(result).toBeVisible();
}
