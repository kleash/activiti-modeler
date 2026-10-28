import { defineConfig } from '@playwright/test';

import { shared } from './playwright.shared';

/**
 * Corpus builds: every `corpus/<id>/build.ts` drives the real modeler in Chromium and the exported project is written
 * to `java/verification-harness/target/corpus/<id>` for the verification harness (the UI-driven builds also to `target/corpus-ui/<id>`).
 * Run with `npm run corpus:build`.
 */
export default defineConfig({
  ...shared,
  testDir: './e2e/corpus',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  timeout: 180_000,
  reporter: 'list',
});
