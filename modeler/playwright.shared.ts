import { devices, type PlaywrightTestConfig } from '@playwright/test';

export const PORT = 4173;

/** What the e2e suite and the corpus builds share: the production bundle with the test API switched on, served by vite preview. */
export const shared = {
  forbidOnly: !!process.env['CI'],
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Builds the app (with the test API switched on) and serves the production bundle, so the tests see what ships.
  webServer: {
    command: `VITE_MODELER_TEST_API=true npm run build -w app && npm run preview -w app -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
} satisfies PlaywrightTestConfig;
