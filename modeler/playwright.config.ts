import { defineConfig } from '@playwright/test';

import { shared } from './playwright.shared';

export default defineConfig({
  ...shared,
  testDir: './e2e',
  // the corpus builds have their own config (playwright.corpus.config.ts, `npm run corpus:build`)
  // the server specs have their own config (playwright.server.config.ts): they run against the real modeler server
  testIgnore: ['**/corpus/**', '**/server/**'],
  fullyParallel: true,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
});
