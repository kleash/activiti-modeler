import { type Page } from '@playwright/test';

import { expectWatermarkVisible } from '../support/watermark';
import { expect, openProject, test } from './support';

/** U16: token simulation over the diagram of the editor, only for a diagram without hidden constructs. */

async function openDiagram(page: Page, project: string, file: string, process: string): Promise<void> {
  await openProject(page, project);
  await page.getByTestId('explorer').getByText(file).dblclick();
  await expect(page.locator(`.editor-panel.active .djs-element[data-element-id="${process === 'orderReview' ? 'review' : 'rules'}"]`)).toBeVisible();
}

test('U16 token simulation plays the diagram: a token starts at the start event and follows the flow', async ({ page }) => {
  await openDiagram(page, 'run-demo', 'order-review.bpmn20.xml', 'orderReview');
  await expect(page.locator('.editor-panel.active').getByTestId('simulate-toggle')).toBeEnabled();
  await expect(page.locator('.editor-panel.active').getByTestId('simulate-why')).toBeHidden();
  await page.locator('.editor-panel.active').getByTestId('simulate-toggle').click();
  const pane = page.locator('.editor-panel.active').getByTestId('simulation-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute('data-ready', 'true');
  // the simulation is on: the start event has a trigger button (a context pad overlay of the simulation) and nothing is running yet
  await expect(pane.locator('.bts-notification')).toHaveCount(0);
  // trigger the start event: a token appears and the simulation's palette, scopes and notifications show up
  await pane.locator('.bts-context-pad').first().click();
  await expect(pane.locator('.bts-palette')).toBeVisible({ timeout: 10_000 });
  await expect(pane.locator('.bts-notification').first()).toBeVisible();
  await expect(pane.locator('.bts-scope').first()).toBeVisible();
  await expectWatermarkVisible(page, 'token simulation', '[data-testid="simulation-pane"]');
  // back to the editor: the diagram was only copied
  await page.getByTestId('simulation-close').click();
  await expect(pane).toBeHidden();
  await expect(page.locator('.editor-panel.active .djs-element[data-element-id="review"]')).toBeVisible();
  await expect(page.getByTestId('tab-order-review.bpmn20.xml')).not.toHaveClass(/dirty/);
});

test('U16 is off for a diagram with a hidden construct, and says why', async ({ page }) => {
  await openDiagram(page, 'rule-check', 'rule-check.bpmn20.xml', 'ruleCheck');
  const why = page.locator('.editor-panel.active').getByTestId('simulate-why');
  await expect(why).toBeVisible();
  await expect(why).toContainText('Token simulation is off');
  await expect(why).toContainText(/business rule task/i);
  await expect(page.locator('.editor-panel.active').getByTestId('simulate-toggle')).toBeDisabled();
  await expect(page.locator('.editor-panel.active').getByTestId('simulate-toggle')).toHaveAttribute('title', /business rule task/i);
});
