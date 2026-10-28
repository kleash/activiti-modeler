import { expect } from '@playwright/test';

import { dropFiles, processXml } from '../support/app';
import { openProblems, problemIds } from '../support/lint';
import { test } from '../support/test';
import {
  activePanel, connect, drdConnectionIds, drdShapeIds, newDmn, openApp, openView, placeShape, renameShape, replaceDecisionWith, saveAndRead, selectShape, tab, viewChip,
  openColumnEditor, inputHeader, inputSettled, columnPopup, padEntry,
} from './support';

// the connection probe of the run feature asks for a modeler server that these tests do not start
test.use({ viewport: { width: 1600, height: 900 }, allowedErrors: [/Failed to load resource/] });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('DM4 a literal expression decision: the decision is replaced by a literal expression, the FEEL text and the variable type are edited in its view', async ({ page }) => {
  await newDmn(page, 'dmn-decision-table', 'limits');
  const decision = await placeShape(page, 'create.decision');
  await renameShape(page, decision, 'maxLoan');
  await replaceDecisionWith(page, decision, 'literal-expression');
  // the replaced decision is a new element with the same name: its view is a literal expression
  await expect.poll(async () => (await activePanel(page).getByTestId('dmn-views').locator('button').allInnerTexts()).join('|')).toMatch(/maxLoan\s+expression/);
  const id = (await drdShapeIds(page)).find((s) => s.startsWith('Decision_'))!;
  await connect(page, 'InputData_amount', id);
  await openView(page, id);

  const editor = activePanel(page).getByRole('textbox', { name: 'Literal expression editor' });
  await editor.click();
  await page.keyboard.type('amount * 4');
  await inputSettled(page);
  const type = activePanel(page).getByRole('textbox', { name: 'Variable type' });
  await type.click();
  await type.fill('number');
  await page.keyboard.press('Enter');
  await inputSettled(page);

  const xml = await saveAndRead(page, 'limits.dmn', 'processes/limits.dmn');
  expect(xml).toMatch(/<decision id="Decision_\w+" name="maxLoan">/);
  expect(xml).toMatch(/<literalExpression id="[^"]+">\s*<text>amount \* 4<\/text>\s*<\/literalExpression>/);
  expect(xml).toMatch(/<variable id="[^"]+" name="maxLoan" typeRef="number" \/>/);
  expect(xml).toMatch(/<requiredInput href="#InputData_amount" \/>/);
  await expect(tab(page, 'limits.dmn')).not.toHaveClass(/dirty/);
});

test('DM5 required decisions: a decision requires another decision in the DRD, and the file says so', async ({ page }) => {
  // the DRD template: credit_riskClass is required by credit_offer
  await newDmn(page, 'dmn-drd', 'chain');
  expect((await drdConnectionIds(page)).some((c) => c === 'chain_offer_req_chain_riskClass')).toBe(true);
  // a third decision that requires the sink decision: drawn from the sink to the new decision
  const bonus = await placeShape(page, 'create.decision');
  await renameShape(page, bonus, 'bonus');
  const requirement = await connect(page, 'chain_offer', bonus);
  expect(requirement).toMatch(/^InformationRequirement_/);
  await replaceDecisionWith(page, bonus, 'decision-table');
  const xml = await saveAndRead(page, 'chain.dmn', 'processes/chain.dmn');
  expect(xml).toMatch(/<requiredDecision href="#chain_riskClass" \/>/);
  expect(xml).toMatch(/<decision id="Decision_\w+" name="bonus">[\s\S]*?<requiredDecision href="#chain_offer" \/>/);
  // the table of the new decision reads the required decision by its name: the DRD suggests it
  const id = (await drdShapeIds(page)).find((s) => s.startsWith('Decision_'))!;
  await openView(page, id);
  await openColumnEditor(inputHeader(page, 0));
  const expression = columnPopup(page).locator('[aria-label="Input expression"]');
  await expression.click();
  await page.keyboard.type('chain_o');
  await expect(page.locator('.cm-tooltip-autocomplete li').filter({ hasText: 'chain_offer' }).first()).toBeVisible();
});

test('DM6 a business knowledge model has a boxed expression view; the Problems panel says that only the KIE engine runs it (L29)', async ({ page }) => {
  await newDmn(page, 'dmn-decision-table', 'pricing');
  const bkm = await placeShape(page, 'create.business-knowledge-model');
  await renameShape(page, bkm, 'discountRate');
  await selectShape(page, bkm);
  await padEntry(page, 'replace').click();
  await page.locator('.djs-popup .entry[data-id="replace-with-literal-expression"]').click();
  const id = (await drdShapeIds(page)).find((s) => s.startsWith('BusinessKnowledgeModel_'))!;
  await expect(viewChip(page, id)).toContainText('boxed');
  await openView(page, id);
  // the boxed view: the function's parameters and its body
  await expect(activePanel(page).locator('.dmn-boxed-expression-container')).toBeVisible();
  // the parameters are edited in a popup (the edit button shows on hover, under the text: the event is dispatched)
  await activePanel(page).getByLabel('Edit formal parameters').dispatchEvent('click');
  await page.locator('.formal-parameters .add-parameter').click();
  await page.locator('.formal-parameters .function-definition-parameter input').first().fill('years');
  await page.locator('.formal-parameters .function-definition-parameter .dms-input-select input').fill('number');
  await inputSettled(page);
  await activePanel(page).locator('.function-definition-body').click();
  await activePanel(page).getByRole('textbox', { name: 'Literal expression', exact: true }).click();
  await page.keyboard.type('if years >= 5 then 0.1 else 0');
  await inputSettled(page);
  const xml = await saveAndRead(page, 'pricing.dmn', 'processes/pricing.dmn');
  expect(xml, xml.slice(xml.indexOf('<businessKnowledgeModel'), xml.indexOf('</businessKnowledgeModel>'))).toMatch(/<businessKnowledgeModel id="BusinessKnowledgeModel_\w+" name="discountRate">/);
  expect(xml).toMatch(/<encapsulatedLogic id="[^"]+">\s*<formalParameter [^>]*name="years"/);
  expect(xml).toMatch(/<text>if years &gt;= 5 then 0\.1 else 0<\/text>/);
  // the lint knows the Operaton engine cannot run it
  await openProblems(page);
  await expect.poll(() => problemIds(page, 'processes/pricing.dmn')).toContain(`activiti/dmn-unsupported-on-operaton@${id}`);
});

const LOAN_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_loan" name="loan" namespace="http://activiti.org/schema/1.0/dmn/Definitions_loan">
  <inputData id="InputData_income" name="income"><variable id="InputData_income_variable" name="income" typeRef="number" /></inputData>
  <decision id="maxLoan" name="maxLoan">
    <variable id="maxLoan_variable" name="maxLoan" typeRef="number" />
    <informationRequirement id="maxLoan_req_income"><requiredInput href="#InputData_income" /></informationRequirement>
    <decisionTable id="maxLoan_table" hitPolicy="UNIQUE">
      <input id="maxLoan_input1" label="Income"><inputExpression id="maxLoan_inputExpression1" typeRef="number"><text>income</text></inputExpression></input>
      <output id="maxLoan_output1" name="maxLoan" typeRef="number" />
      <rule id="maxLoan_low"><inputEntry id="maxLoan_low_in1"><text>&lt; 2000</text></inputEntry><outputEntry id="maxLoan_low_out1"><text>5000</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>
`;

test('DM7 the FEEL editor suggests the variables of the DRD and the process variables of the project that calls the file', async ({ page }) => {
  const bpmn = processXml('order', [
    { id: 'start', type: 'startEvent', x: 100, y: 100 },
    { id: 'decide', type: 'serviceTask', name: 'Decide', x: 200, y: 80 },
  ]).replace('<bpmn:serviceTask id="decide" name="Decide" />', '<bpmn:serviceTask id="decide" name="Decide" implementation="dmn-connector.EXECUTE_TABLE" />');
  const extensions = JSON.stringify({
    id: 'process-order',
    extensions: {
      order: {
        properties: { p1: { id: 'p1', name: 'customerIncome', type: 'integer', required: false }, p2: { id: 'p2', name: 'customerCountry', type: 'string', required: false } },
        mappings: {},
        constants: { decide: { _activiti_dmn_table_: { value: 'maxLoan' } } },
      },
    },
  });
  await dropFiles(page, [{ name: 'order.bpmn20.xml', content: bpmn }, { name: 'order-extensions.json', content: extensions }, { name: 'loan.dmn', content: LOAN_DMN }]);
  await expect(tab(page, 'order.bpmn20.xml')).toBeVisible();
  await page.getByRole('treeitem', { name: 'loan.dmn', exact: true }).dblclick();
  await expect(tab(page, 'loan.dmn')).toHaveClass(/active/);
  await openView(page, 'maxLoan');

  await openColumnEditor(inputHeader(page, 0));
  const expression = columnPopup(page).locator('[aria-label="Input expression"]');
  await expression.click();
  await page.keyboard.press('Control+A');
  // a variable of the DRD: the input data `income`
  await page.keyboard.type('inc');
  const suggestions = page.locator('.cm-tooltip-autocomplete li');
  await expect(suggestions.filter({ hasText: /^income/ }).first()).toBeVisible();
  // a process variable of the process whose decision task evaluates this decision
  await page.keyboard.press('Control+A');
  await page.keyboard.type('customerC');
  await expect(suggestions.filter({ hasText: 'customerCountry' }).first()).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('customerI');
  await expect(suggestions.filter({ hasText: 'customerIncome' }).first()).toBeVisible();
});
