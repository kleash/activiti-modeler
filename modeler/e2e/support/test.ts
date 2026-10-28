import { expect, test as base } from '@playwright/test';

/**
 * `test` of the shell specs: like Playwright's, plus a check that the page logged no errors. An uncaught exception or a
 * `console.error` that a spec does not expect fails the test, so a swallowed failure cannot hide behind a passing assertion.
 * A spec that provokes an error on purpose lists it in `allowedErrors`.
 */
export const test = base.extend<{ allowedErrors: RegExp[]; pageErrors: void }>({
  allowedErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
      });
      await use();
      expect(
        errors.filter((e) => !allowedErrors.some((pattern) => pattern.test(e))),
        'errors logged by the page',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator, TestInfo } from '@playwright/test';
