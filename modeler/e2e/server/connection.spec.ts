import { expect, signIn, test } from './support';

/**
 * R1: connection settings (server URL, user and password) and the health / engine information in the status bar, against the real
 * modeler server the global setup started.
 */

const status = (page: import('@playwright/test').Page) => page.getByTestId('status-server');
const stored = (page: import('@playwright/test').Page) => page.evaluate(() => localStorage.getItem('activiti-modeler.connection'));

test('R1 the status bar finds the server and asks for a sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveAttribute('data-status', 'signed-out');
  await expect(status(page)).toContainText('not signed in');
});

test('R1 signing in shows the Activiti version, the DMN engine and the async executor in the status bar', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).toHaveAttribute('data-status', 'signed-out');
  await signIn(page, 'modeler');
  await expect(status(page)).toContainText('modeler@');
  await expect(status(page)).toContainText('Activiti 9.0.0');
  await expect(status(page)).toContainText(/DMN Operaton/i);
  await expect(status(page)).toContainText('executor on');
  // the tooltip carries the details of the engine report
  await expect(status(page)).toHaveAttribute('title', /Spring Boot 3\.5.*history full.*async executor running/);
});

test.describe('a wrong password', () => {
  // the browser logs every 401 as a console error
  test.use({ allowedErrors: [/Failed to load resource: the server responded with a status of 401/] });

  test('R1 is refused and says so; the status stays signed out', async ({ page }) => {
  await page.goto('/');
  await status(page).click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill('modeler');
  await dialog.getByTestId('connection-password').fill('wrong');
  await dialog.getByTestId('connection-connect').click();
  await expect(dialog.getByTestId('connection-error')).toContainText('does not accept this user name and password');
  await expect(status(page)).toHaveAttribute('data-status', 'signed-out');
  });
});

test('R1 the URL and the user are remembered, the password only when asked for', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'alice');
  const settings = JSON.parse((await stored(page))!) as Record<string, unknown>;
  expect(settings).toEqual({ baseUrl: '', username: 'alice', rememberPassword: false });
  // a reload keeps the user but needs the password again: nothing secret was stored
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'signed-out');
  await status(page).click();
  await expect(page.getByTestId('connection-user')).toHaveValue('alice');
  await expect(page.getByTestId('connection-password')).toHaveValue('');
  await page.keyboard.press('Escape');
});

test('R1 "remember the password" stores it in this browser and a reload signs in again', async ({ page }) => {
  await page.goto('/');
  await status(page).click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill('bob');
  await dialog.getByTestId('connection-password').fill('bob');
  await dialog.getByTestId('connection-remember').check();
  await dialog.getByTestId('connection-connect').click();
  await expect(status(page)).toHaveAttribute('data-status', 'connected');
  expect(JSON.parse((await stored(page))!)).toEqual({ baseUrl: '', username: 'bob', rememberPassword: true, password: 'bob' });
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'connected');
  await expect(status(page)).toContainText('bob@');
  // signing out forgets the password
  await status(page).click();
  await page.getByTestId('connection-disconnect').click();
  expect(JSON.parse((await stored(page))!)).toEqual({ baseUrl: '', username: 'bob', rememberPassword: false });
});

test.describe('an unreachable server', () => {
  test.use({ allowedErrors: [/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/] });

  test('R1 is reported with the reason, and the app stays usable', async ({ page }) => {
    await page.goto('/');
    await status(page).click();
    const dialog = page.getByTestId('connection-dialog');
    await dialog.getByTestId('connection-url').fill('http://127.0.0.1:1');
    await dialog.getByTestId('connection-password').fill('modeler');
    await dialog.getByTestId('connection-connect').click();
    await expect(dialog.getByTestId('connection-error')).toContainText('No answer from the server');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(status(page)).toContainText('Server: not connected');
    await expect(page.getByTestId('status-storage')).toBeVisible();
  });
});
