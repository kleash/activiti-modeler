import { activePanel, openView } from '../dmn/support';
import { expect, openProject, test } from './support';

/**
 * R8 / DM10: the decision tester of the DMN editor evaluates a table of a C16 project through the real modeler server (the one
 * connection of the modeler, signed in for the project), shows the result rows and marks the matched rule in the decision table.
 */

test('R8 DM10 the decision tester evaluates the unique-grade table on the server: rows, matched rule and its highlight in the table', async ({ page }) => {
  await openProject(page, 'C16-dmn-hit-policies');
  await page.getByTestId('explorer').getByText('unique-grade.dmn').dblclick();
  await openView(page, 'uniqueGrade');
  await activePanel(page).getByTestId('dmn-test-decision').click();
  const tester = page.getByTestId('decision-tester');
  await expect(tester).toBeVisible();
  // one connection: the tester shows the server of the status bar
  await expect(page.getByTestId('tester-server-summary')).toContainText('modeler@');
  await expect(page.getByTestId('tester-decision')).toHaveValue('uniqueGrade');

  const rules = activePanel(page).locator('tr').filter({ has: page.locator('td.rule-index') });
  await page.getByTestId('tester-input-score').fill('65');
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-matched')).toContainText('A rule matched');
  await expect(page.getByTestId('tester-rows')).toContainText('mid');
  await expect(page.getByTestId('tester-matched-rules')).toHaveText('uniqueGrade_mid');
  await expect(rules.nth(0)).not.toHaveClass(/activiti-matched-rule/);
  await expect(rules.nth(1)).toHaveClass(/activiti-matched-rule/);
  await expect(rules.nth(2)).not.toHaveClass(/activiti-matched-rule/);

  // another input: the old marks go away, the new evaluation marks the other rule
  await page.getByTestId('tester-input-score').fill('90');
  await expect(rules.nth(1)).not.toHaveClass(/activiti-matched-rule/);
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-rows')).toContainText('high');
  await expect(page.getByTestId('tester-matched-rules')).toHaveText('uniqueGrade_high');
  await expect(rules.nth(2)).toHaveClass(/activiti-matched-rule/);

  // the first rule: a negative score is below 50
  await page.getByTestId('tester-input-score').fill('-1');
  await page.getByTestId('tester-evaluate').click();
  await expect(page.getByTestId('tester-matched-rules')).toHaveText('uniqueGrade_low');
  await expect(rules.nth(0)).toHaveClass(/activiti-matched-rule/);
});
