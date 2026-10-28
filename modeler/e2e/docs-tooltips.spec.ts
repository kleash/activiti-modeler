import { expect, type Page } from '@playwright/test';

import { problemRows, openProblems } from './support/lint';
import { ModelerApi } from './support/modelerApi';
import { entry, openScene, panel } from './properties/support';
import { test } from './support/test';

/** U29: documentation tooltips in the properties panel and links to the lint rule pages in the Problems tab. */

const GUIDE = /docs\/user-guide\/properties\/[a-z-]+\.md/;

async function tooltipFor(page: Page, entryId: string) {
  await entry(page, entryId).locator('.bio-properties-panel-tooltip-wrapper').first().hover();
  const tooltip = page.locator('.bio-properties-panel-tooltip');
  await expect(tooltip).toBeVisible();
  return tooltip;
}

test.describe('U29 documentation tooltips', () => {
  test('U29 an entry of the properties panel explains itself on hover and links to its page of the user guide', async ({ page }) => {
    await openScene(page, async (api) => void (await api.createShape({ type: 'userTask', id: 'review' })), 'review');
    const tooltip = await tooltipFor(page, 'user.assignee');
    await expect(tooltip).toContainText('The user who works on the task');
    await expect(tooltip.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', new RegExp(`${GUIDE.source.replace('[a-z-]+', 'user-assignment')}$`));
    await expect(tooltip.getByRole('link', { name: 'Learn more' })).toHaveAttribute('target', '_blank');
  });

  test('U29 a tooltip says how the engine treats the field when that is not obvious', async ({ page }) => {
    await openScene(page, async (api) => void (await api.createShape({ type: 'userTask', id: 'review' })), 'review');
    const tooltip = await tooltipFor(page, 'user.customResource');
    await expect(tooltip).toContainText('Engine:');
    await expect(tooltip).toContainText('does not make the task visible to those users');
  });

  test('U29 an event definition entry links to the anchor of its section', async ({ page }) => {
    await openScene(
      page,
      async (api) => void (await api.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'message' })),
      'wait',
    );
    await expect(panel(page).locator('[data-entry-id="message.ref"]')).toBeVisible();
    const tooltip = await tooltipFor(page, 'message.ref');
    await expect(tooltip.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', /event-definitions\.md#message$/);
  });
});

test.describe('U29 lint rule pages', () => {
  test('U29 a problem in the Problems tab links to the page of its rule', async ({ page }) => {
    const api = await ModelerApi.open(page);
    await api.createProject('docs', { defaultMappings: 'none' });
    await api.newProcess('p', 'P');
    await api.createShape({ type: 'serviceTask', id: 'work' });
    await openProblems(page);
    const activitiRule = problemRows(page).locator('a.problem-rule', { hasText: /^activiti\// });
    await expect(activitiRule.first()).toBeVisible();
    const link = activitiRule.first();
    await expect(link).toHaveAttribute('href', /docs\/user-guide\/lint-rules\/[a-z0-9-]+\.md$/);
    await expect(link).toHaveAttribute('target', '_blank');
    // the rules of bpmnlint itself link to the bpmnlint documentation
    await expect(problemRows(page).locator('a.problem-rule', { hasText: /^bpmnlint\// }).first()).toHaveAttribute('href', /bpmn-io\/bpmnlint\/blob\/main\/docs\/rules\//);
  });
});
