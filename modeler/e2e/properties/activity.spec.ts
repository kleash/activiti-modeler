import { addRow, bpmn, check, checkCase, clickIn, entry, expect, expectUndoRestores, messageOf, openScene, pick, pickCase, reveal, serviceTask, test, type, typeCase, userTask, valueOf, type Scene } from './support';

const loopingTask: Scene = async (a) => {
  await a.createShape({ type: 'userTask', id: 'u' });
  await a.setProperty('u', 'mi.type', 'parallel');
};

test.describe('Multi-instance', () => {
  pickCase({ title: 'Multi-instance: parallel', scene: userTask, select: 'u', id: 'mi.type', value: 'parallel', xml: [/<bpmn:multiInstanceLoopCharacteristics( isSequential="false")? ?\/?>/] });
  pickCase({ title: 'Multi-instance: sequential', scene: userTask, select: 'u', id: 'mi.type', value: 'sequential', xml: ['<bpmn:multiInstanceLoopCharacteristics isSequential="true"'] });
  typeCase({ title: 'Multi-instance: loop cardinality', scene: loopingTask, select: 'u', id: 'mi.cardinality', value: '3', xml: [/<bpmn:loopCardinality[^>]*>3<\/bpmn:loopCardinality>/] });
  typeCase({ title: 'Multi-instance: collection from a variable', scene: loopingTask, select: 'u', id: 'mi.collection', value: 'reviewers', xml: ['activiti:collection="reviewers"'] });
  typeCase({ title: 'Multi-instance: collection from an expression', scene: loopingTask, select: 'u', id: 'mi.collection', value: '${approvers}', xml: ['activiti:collection="${approvers}"'] });
  typeCase({ title: 'Multi-instance: element variable', scene: loopingTask, select: 'u', id: 'mi.elementVariable', value: 'reviewer', xml: ['activiti:elementVariable="reviewer"'] });
  typeCase({ title: 'Multi-instance: element index variable', scene: loopingTask, select: 'u', id: 'mi.elementIndexVariable', value: 'position', xml: ['activiti:elementIndexVariable="position"'] });
  typeCase({
    title: 'Multi-instance: completion condition',
    scene: loopingTask,
    select: 'u',
    id: 'mi.completionCondition',
    value: '${nrOfCompletedInstances >= quorum}',
    xml: [/<bpmn:completionCondition[^>]*>\$\{nrOfCompletedInstances &gt;= quorum\}<\/bpmn:completionCondition>/],
  });
  typeCase({ title: 'Multi-instance: output collection', scene: loopingTask, select: 'u', id: 'mi.outputCollection', value: 'verdicts', xml: ['<bpmn:loopDataOutputRef>verdicts</bpmn:loopDataOutputRef>'] });
  typeCase({ title: 'Multi-instance: output element', scene: loopingTask, select: 'u', id: 'mi.outputItem', value: 'verdict', xml: [/<bpmn:outputDataItem[^>]* name="verdict"/] });

  test('Multi-instance: switching to none removes the loop and its fields disappear', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'mi.type', 'sequential');
      await a.setProperty('u', 'mi.collection', 'people');
    }, 'u');
    const before = await bpmn(api);
    await pick(page, 'mi.type', 'none');
    expect(await bpmn(api)).not.toContain('multiInstanceLoopCharacteristics');
    await expect(entry(page, 'mi.collection')).toHaveCount(0);
    await expectUndoRestores(api, before);
    expect(await valueOf(page, 'mi.type')).toBe('sequential');
  });

  test('Multi-instance: a call activity offers no output collection and carries the engine warning', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'callActivity', id: 'call' });
      await a.setProperty('call', 'mi.type', 'parallel');
    }, 'call');
    await expect(entry(page, 'mi.outputCollection')).toHaveCount(0);
    await expect(entry(page, 'mi.call.hint')).toContainText('gets nothing back');
  });

  test('Multi-instance: a cardinality together with a collection is flagged', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'mi.type', 'parallel');
      await a.setProperty('u', 'mi.cardinality', '3');
      await a.setProperty('u', 'mi.collection', 'people');
    }, 'u');
    await expect(entry(page, 'mi.both.hint')).toContainText('uses the cardinality');
  });

  test('Multi-instance: an element variable must be a variable name and a completion condition an expression', async ({ page }) => {
    const api = await openScene(page, loopingTask, 'u');
    const before = await bpmn(api);
    await type(page, 'mi.elementVariable', 'the reviewer');
    await expect(messageOf(page, 'mi.elementVariable')).toContainText('plain identifier');
    await type(page, 'mi.completionCondition', 'nrOfCompletedInstances >= 2');
    await expect(messageOf(page, 'mi.completionCondition')).toContainText('constant string');
    expect(await bpmn(api)).toBe(before);
  });
});

test.describe('Asynchronous continuation', () => {
  checkCase({ title: 'Asynchronous continuation: async', scene: serviceTask, select: 'svc', id: 'async.async', xml: ['activiti:async="true"'] });
  checkCase({ title: 'Asynchronous continuation: exclusive off', scene: serviceTask, select: 'svc', id: 'async.exclusive', checked: false, xml: ['activiti:exclusive="false"'] });

  test('Asynchronous continuation: exclusive starts checked and switching it on again removes the attribute', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:exclusive': false } });
    }, 'svc');
    const before = await bpmn(api);
    await expect((await reveal(page, 'async.exclusive')).locator('input')).not.toBeChecked();
    await check(page, 'async.exclusive');
    expect(await bpmn(api)).not.toContain('activiti:exclusive');
    await expectUndoRestores(api, before);
  });

  test('Asynchronous continuation: offered on gateways and events too', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'exclusiveGateway', id: 'gw' })), 'gw');
    await expect(entry(page, 'async.async')).toHaveCount(1);
  });
});

test.describe('Job execution', () => {
  typeCase({ title: 'Job execution: failed job retry time cycle of a service task', scene: serviceTask, select: 'svc', id: 'job.failedJobRetryTimeCycle', value: 'R5/PT10S', xml: ['<activiti:failedJobRetryTimeCycle>R5/PT10S</activiti:failedJobRetryTimeCycle>'] });

  test('Job execution: only service tasks have the group, and a bad cycle is refused', async ({ page }) => {
    const api = await openScene(page, serviceTask, 'svc');
    const before = await bpmn(api);
    await type(page, 'job.failedJobRetryTimeCycle', 'five times');
    await expect(messageOf(page, 'job.failedJobRetryTimeCycle')).toContainText('R<attempts>/<wait>');
    expect(await bpmn(api)).toBe(before);
  });

  test('Job execution: a user task has no job execution group', async ({ page }) => {
    await openScene(page, userTask, 'u');
    await expect(page.locator('[data-group-id="group-job"]')).toHaveCount(0);
    await expect(page.locator('[data-group-id="group-async"]')).toHaveCount(1);
  });
});

test.describe('Error mapping', () => {
  test('Error mapping: exception class to an error code, with subclasses', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Pay' } })), 'svc');
    const before = await bpmn(api);
    await addRow(page, 'errors.mapExceptions');
    await type(page, 'errors.mapExceptions[0].errorCode', 'PAYMENT_FAILED');
    // an error code alone is the default entry that maps every other exception (the engine reads an empty class that way)
    expect(await bpmn(api)).toMatch(/<activiti:mapException errorCode="PAYMENT_FAILED"\s*\/>/);
    await type(page, 'errors.mapExceptions[0].exceptionClass', 'com.example.PaymentException');
    expect(await bpmn(api)).toContain('<activiti:mapException errorCode="PAYMENT_FAILED">com.example.PaymentException</activiti:mapException>');
    const box = entry(page, 'errors.mapExceptions[0].includeChildExceptions').locator('input');
    await box.check();
    expect(await bpmn(api)).toContain('<activiti:mapException errorCode="PAYMENT_FAILED" includeChildExceptions="true">com.example.PaymentException</activiti:mapException>');
    await expectUndoRestores(api, before);
  });

  test('Error mapping: mappings are matched in the order listed and can be moved and removed', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Pay' } });
      await a.setProperty('svc', 'errors.mapExceptions', [
        { errorCode: 'E_SPECIFIC', exceptionClass: 'java.lang.IllegalStateException' },
        { errorCode: 'E_ANY', exceptionClass: 'java.lang.Exception', includeChildExceptions: true },
      ]);
    }, 'svc');
    const before = await bpmn(api);
    await clickIn(page, 'errors.mapExceptions[1]', 'Move up');
    expect(await bpmn(api)).toMatch(/E_ANY[\s\S]*E_SPECIFIC/);
    await clickIn(page, 'errors.mapExceptions[0]', 'Remove');
    expect(await bpmn(api)).not.toContain('E_ANY');
    await expectUndoRestores(api, before);
  });

  test('Error mapping: offered on call activities, and not on a delegate expression or a plain service task', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'callActivity', id: 'call' })), 'call');
    await expect(page.locator('[data-group-id="group-errorMapping"]')).toHaveCount(1);
    await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:delegateExpression': '${d}' } })), 'svc');
    await expect(page.locator('[data-group-id="group-errorMapping"]')).toHaveCount(0);
  });

  test('Error mapping: an exception class must be a qualified class name', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Pay' } })), 'svc');
    await addRow(page, 'errors.mapExceptions');
    await type(page, 'errors.mapExceptions[0].exceptionClass', 'Boom');
    await expect(messageOf(page, 'errors.mapExceptions[0].exceptionClass')).toContainText('fully qualified');
  });
});

test.describe('Skip expression', () => {
  test('Skip expression: user task, with the note about the enabling variable', async ({ page }) => {
    const api = await openScene(page, userTask, 'u');
    const before = await bpmn(api);
    await type(page, 'skip.expression', '${skipReview}');
    expect(await bpmn(api)).toContain('activiti:skipExpression="${skipReview}"');
    await expect(entry(page, 'skip.enabled.hint')).toContainText('_ACTIVITI_SKIP_EXPRESSION_ENABLED');
    await expect(entry(page, 'skip.enabled.hint')).toContainText('Declare it as a process property');
    await expectUndoRestores(api, before);
  });

  test('Skip expression: service task and sequence flow', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc' });
      await a.createShape({ type: 'endEvent', id: 'end' });
      await a.connect('svc', 'end', 'flow');
    }, 'svc');
    await type(page, 'skip.expression', '${skipIt}');
    expect(await bpmn(api)).toContain('<bpmn:serviceTask id="svc" activiti:skipExpression="${skipIt}"');
    await api.select('flow');
    await type(page, 'skip.expression', '${skipFlow}');
    expect(await bpmn(api)).toContain('activiti:skipExpression="${skipFlow}"');
  });

  test('Skip expression: the warning goes away once the enabling variable is declared', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'skip.expression', '${skipReview}');
      await a.setExtensions({ properties: [{ name: '_ACTIVITI_SKIP_EXPRESSION_ENABLED', type: 'boolean', value: true }] });
    }, 'u');
    await expect(entry(page, 'skip.enabled.hint')).not.toContainText('ignored unless');
    await expect(entry(page, 'skip.enabled.hint')).toContainText('only while _ACTIVITI_SKIP_EXPRESSION_ENABLED is true');
  });
});

test.describe('Condition', () => {
  const gatewayFlow: Scene = async (a) => {
    await a.createShape({ type: 'exclusiveGateway', id: 'gw' });
    await a.createShape({ type: 'endEvent', id: 'end' });
    await a.createShape({ type: 'endEvent', id: 'other' });
    await a.connect('gw', 'end', 'flow');
    await a.connect('gw', 'other', 'flow2');
  };
  typeCase({ title: 'Condition: expression of a sequence flow', scene: gatewayFlow, select: 'flow', id: 'flow.condition', value: '${amount > 100}', xml: [/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{amount &gt; 100\}<\/bpmn:conditionExpression>/] });
  checkCase({ title: 'Condition: default flow', scene: gatewayFlow, select: 'flow', id: 'flow.default', xml: [/<bpmn:exclusiveGateway id="gw" default="flow"/] });

  test('Condition: the default flow has no condition, and making a flow the default removes its condition in the same step', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await gatewayFlow(a);
      await a.setProperty('flow', 'flow.condition', '${amount > 100}');
    }, 'flow');
    const before = await bpmn(api);
    await check(page, 'flow.default');
    const xml = await bpmn(api);
    expect(xml).toContain('default="flow"');
    expect(xml).not.toContain('conditionExpression');
    await expect(entry(page, 'flow.condition')).toHaveCount(0);
    await expect(entry(page, 'flow.condition.hint')).toContainText('no condition');
    await expectUndoRestores(api, before);
  });

  test('Condition: a syntax error is refused and a plain text without ${...} is refused as a constant', async ({ page }) => {
    const api = await openScene(page, gatewayFlow, 'flow');
    const before = await bpmn(api);
    await type(page, 'flow.condition', '${amount >');
    await expect(messageOf(page, 'flow.condition')).toContainText('never closed');
    await type(page, 'flow.condition', 'amount > 100');
    await expect(messageOf(page, 'flow.condition')).toContainText('constant string');
    expect(await bpmn(api)).toBe(before);
  });

  test('Condition: a string + in a condition is flagged but written (the engine fails on it)', async ({ page }) => {
    const api = await openScene(page, gatewayFlow, 'flow');
    await type(page, 'flow.condition', "${'go-' + region == 'go-EU'}");
    await expect(messageOf(page, 'flow.condition')).toContainText("no '+' for strings");
    expect(await bpmn(api)).toContain('conditionExpression');
  });

  test('Condition: completes the process variables and the JUEL keywords while typing', async ({ page }) => {
    await openScene(page, async (a) => {
      await gatewayFlow(a);
      await a.setExtensions({ properties: [{ name: 'amountTotal', type: 'integer' }] });
    }, 'flow');
    const editor = entry(page, 'flow.condition').locator('.cm-content');
    await editor.click();
    await page.keyboard.insertText('${amo');
    await page.keyboard.press('Control+Space');
    // a click on the option (the popup ignores Enter for a moment after it opened, a click it takes at once)
    await page.locator('.cm-tooltip-autocomplete li', { hasText: 'amountTotal' }).click();
    await expect(editor).toContainText('${amountTotal');
  });

  test('Condition: highlights the expression and matches brackets', async ({ page }) => {
    await openScene(page, gatewayFlow, 'flow');
    const editor = entry(page, 'flow.condition').locator('.cm-content');
    await editor.click();
    await page.keyboard.insertText("${(amount > 100) and name == 'x'}");
    // the syntax is parsed in the background; once it is, the language marks strings and numbers with their own classes
    await expect.poll(() => entry(page, 'flow.condition').locator('.cm-line span').count()).toBeGreaterThan(3);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(entry(page, 'flow.condition').locator('.cm-matchingBracket')).toHaveCount(2);
  });
});
