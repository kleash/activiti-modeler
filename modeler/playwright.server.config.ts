import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the REAL modeler server (the run features of docs/FEATURE_MATRIX.md §G, and U16): the global setup builds
 * the jar (`scripts/build-server.sh`), starts it on a free port with a temporary workspace, and the tests drive the app the server serves,
 * with real processes on the embedded Activiti. Run with `npm run e2e:server`. The tests share one engine, so they run one after the other.
 */
export default defineConfig({
  testDir: './e2e/server',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/server',
  globalSetup: './e2e/server/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
