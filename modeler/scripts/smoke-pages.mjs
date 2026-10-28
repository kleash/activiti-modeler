// Drives the browser-only build served under a sub-path (scripts/smoke-pages.sh starts `vite preview --base=/activiti-modeler/`).
//   node scripts/smoke-pages.mjs http://127.0.0.1:4173/activiti-modeler/
// Checks what must hold on GitHub Pages: every request of the page stays below the base path and succeeds, nothing calls a server (/api), the
// editor comes up with a project kept in the browser (IndexedDB), the bpmn.io watermark is shown, and the run features say
// "connect to a server" instead of failing.
import { URL } from 'node:url';

import { chromium } from '@playwright/test';

const url = process.argv[2];
if (!url || !url.endsWith('/')) {
  console.error('usage: node scripts/smoke-pages.mjs <url of the site, with a trailing slash>');
  process.exit(2);
}
const { origin, pathname: base } = new URL(url);

const failures = [];
const check = (ok, description, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${description}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) failures.push(description);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const requests = [];
  const bad = [];
  const consoleErrors = [];
  page.on('response', (response) => {
    const u = new URL(response.url());
    if (u.origin === origin) requests.push({ path: u.pathname, status: response.status() });
    if (response.status() >= 400) bad.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
  // a request that the reload below cancels in flight is not a failure of the site
  if (request.failure()?.errorText !== 'net::ERR_ABORTED') bad.push(`failed ${request.url()}: ${request.failure()?.errorText}`);
});
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto(url);
  try {
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor({ timeout: 30_000 });
  } catch {
    check(false, 'the editor opens a diagram under ' + base, `requests that went wrong: ${bad.slice(0, 5).join('; ') || 'none'}; console: ${consoleErrors.slice(0, 3).join(' | ')}`);
    throw new Error('the app did not start under ' + base);
  }
  check(true, 'the editor opens a diagram under ' + base);
  check((await page.title()) === 'Activiti Modeler', 'the page title is "Activiti Modeler"', await page.title());
  check(requests.length > 3 && requests.every((r) => r.path.startsWith(base)), `all ${requests.length} requests of the page are below ${base}`,
    requests.filter((r) => !r.path.startsWith(base)).map((r) => r.path).join(', '));
  check(requests.some((r) => r.path.startsWith(`${base}assets/`) && r.path.endsWith('.js')), 'the script bundle is served from the base path');
  check(!requests.some((r) => r.path.includes('/api/')), 'nothing calls a modeler server (/api)');
  check(bad.length === 0, 'no request failed or answered with an error', bad.join('; '));

  const watermark = page.locator('.editor-panel.active .bjs-powered-by');
  check(await watermark.isVisible(), 'the bpmn.io watermark is visible');
  check((await page.getByTestId('project-name').innerText()) === 'my-project', 'a first project exists');

  // the project lives in the browser: IndexedDB, and it is still there after a reload
  const projects = () => page.evaluate(async () => (await globalThis.indexedDB.databases()).map((d) => d.name));
  const before = await projects();
  check(before.length > 0, 'the project is kept in IndexedDB', JSON.stringify(before));
  await page.reload();
  await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor({ timeout: 60_000 });
  check((await page.getByTestId('project-name').innerText()) === 'my-project', 'the project is there after a reload');
  check(JSON.stringify(await projects()) === JSON.stringify(before), 'and in the same database');

  // run features without a server
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Run', exact: true }).click();
  await page.getByTestId('menu-instances').click();
  const notConnected = page.getByTestId('not-connected');
  await notConnected.waitFor({ timeout: 15_000 });
  check(/Not connected to a modeler server/.test(await notConnected.innerText()), 'the run view says it is not connected to a server');
  check(await page.getByTestId('not-connected-connect').isVisible(), 'and offers "Connect to a server..."');
  check(!requests.some((r) => r.path.includes('/api/')), 'opening the run view still calls no server');

  check(consoleErrors.length === 0, 'no console errors', consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  console.error(String(error.message ?? error));
  failures.push('aborted');
} finally {
  await browser.close();
}
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed: the browser-only build works under ' + base);
