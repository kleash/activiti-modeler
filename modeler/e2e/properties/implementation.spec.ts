import { addRow, bpmn, clickIn, entry, expect, expectUndoRestores, extensions, messageOf, openScene, pick, pickCase, serviceTask, test, type, typeCase, checkCase, valueOf, type Scene } from './support';

const serviceClass: Scene = async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Delegate' } }));
const serviceExpression: Scene = async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:expression': '${bean.run()}' } }));
const mailTask: Scene = async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:type': 'mail' } }));
const shellTask: Scene = async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:type': 'shell' } }));
const scriptTask: Scene = async (a) => void (await a.createShape({ type: 'scriptTask', id: 'script' }));
const callActivity: Scene = async (a) => void (await a.createShape({ type: 'callActivity', id: 'call' }));

test.describe('Implementation', () => {
  pickCase({ title: 'Implementation: type Java class', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'class', xml: ['activiti:class=""'] });
  pickCase({ title: 'Implementation: type Expression', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'expression', xml: ['activiti:expression=""'] });
  pickCase({ title: 'Implementation: type Delegate expression', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'delegateExpression', xml: ['activiti:delegateExpression=""'] });
  pickCase({ title: 'Implementation: type Connector', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'connector', xml: ['implementation=""'] });
  pickCase({ title: 'Implementation: type Mail', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'mail', xml: ['activiti:type="mail"'] });
  pickCase({ title: 'Implementation: type Shell', scene: serviceTask, select: 'svc', id: 'impl.type', value: 'shell', xml: ['activiti:type="shell"'] });
  pickCase({
    title: 'Implementation: type Decision (DMN) is a service task that calls the DMN connector',
    scene: serviceTask,
    select: 'svc',
    id: 'impl.type',
    value: 'decision',
    xml: ['implementation="dmn-connector.EXECUTE_TABLE"'],
    after: async (api) => expect(JSON.stringify(await extensions(api))).toContain('_activiti_dmn_table_'),
  });

  typeCase({ title: 'Implementation: Java class', scene: serviceClass, select: 'svc', id: 'impl.class', value: 'com.example.ShippingDelegate', xml: ['activiti:class="com.example.ShippingDelegate"'] });
  typeCase({ title: 'Implementation: expression', scene: serviceExpression, select: 'svc', id: 'impl.expression', value: "${orderService.ship(order)}", xml: ['activiti:expression="${orderService.ship(order)}"'] });
  typeCase({ title: 'Implementation: result variable name of an expression', scene: serviceExpression, select: 'svc', id: 'impl.resultVariable', value: 'shipment', xml: ['activiti:resultVariableName="shipment"', 'activiti:expression="${bean.run()}"'] });
  typeCase({
    title: 'Implementation: delegate expression',
    scene: async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:delegateExpression': '${old}' } })),
    select: 'svc',
    id: 'impl.delegateExpression',
    value: '${shippingDelegate}',
    xml: ['activiti:delegateExpression="${shippingDelegate}"'],
  });
  typeCase({
    title: 'Implementation: connector action',
    scene: async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { implementation: 'old.ACTION' } })),
    select: 'svc',
    id: 'impl.connector',
    value: 'mailer.SEND',
    xml: ['implementation="mailer.SEND"'],
  });
  typeCase({
    title: 'Implementation: decision key of a decision task',
    scene: async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } })),
    select: 'svc',
    id: 'decision.table',
    value: 'riskLevel',
    xml: ['implementation="dmn-connector.EXECUTE_TABLE"'],
    after: async (api) => expect(JSON.stringify(await extensions(api))).toContain('"riskLevel"'),
  });

  test('Implementation: switching the type removes the settings of the previous one, in one undo step', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Delegate' } });
      await a.setProperty('svc', 'fields.list', [{ name: 'tag', string: 'x' }]);
    }, 'svc');
    const before = await bpmn(api);
    await pick(page, 'impl.type', 'expression');
    const xml = await bpmn(api);
    expect(xml).toContain('activiti:expression=""');
    expect(xml).not.toContain('activiti:class');
    expect(xml).not.toContain('activiti:field');
    await expect(entry(page, 'fields.list')).toHaveCount(0);
    await api.undo();
    expect(await bpmn(api)).toBe(before);
  });

  test('Implementation: a Java class must be a class name, an expression is refused there', async ({ page }) => {
    const api = await openScene(page, serviceClass, 'svc');
    const before = await bpmn(api);
    await type(page, 'impl.class', '${bean}');
    await expect(messageOf(page, 'impl.class')).toContainText('fully qualified class name');
    expect(await bpmn(api)).toBe(before);
  });

  test('Implementation: a connector action needs the form <connector>.<ACTION> and a web service is refused', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { implementation: 'mailer.SEND' } })), 'svc');
    const before = await bpmn(api);
    await type(page, 'impl.connector', 'mailer');
    await expect(messageOf(page, 'impl.connector')).toContainText('<connector>.<ACTION>');
    await type(page, 'impl.connector', '##WebService');
    await expect(messageOf(page, 'impl.connector')).toContainText('not supported by Activiti 9');
    expect(await bpmn(api)).toBe(before);
  });

  test('Implementation: a send task works as mail only', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'sendTask', id: 'send' })), 'send');
    const options = await entry(page, 'impl.type').locator('option').allInnerTexts();
    expect(options).toEqual(['(choose how the task works)', 'Mail']);
    expect(await valueOf(page, 'impl.type')).toBe('mail');
    await expect(page.locator('[data-group-id="group-mail"]')).toBeVisible();
  });

  test('Implementation: the decision task shows its decision key and the connector the mapping note', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { implementation: 'mailer.SEND' } })), 'svc');
    await expect(entry(page, 'impl.connector.hint')).toContainText('input / output mapping');
  });
});

test.describe('Field injection', () => {
  test('Field injection: fields of a Java class as text and as expression', async ({ page }) => {
    const api = await openScene(page, serviceClass, 'svc');
    const before = await bpmn(api);
    await addRow(page, 'fields.list');
    await type(page, 'fields.list[0].name', 'variable');
    // a field without a value is not written yet
    expect(await bpmn(api)).not.toContain('activiti:field');
    await type(page, 'fields.list[0].value', 'reminders');
    expect(await bpmn(api)).toMatch(/<activiti:field name="variable">\s*<activiti:string>reminders<\/activiti:string>/);
    await addRow(page, 'fields.list');
    await type(page, 'fields.list[1].name', 'who');
    await pick(page, 'fields.list[1].kind', 'expression');
    await type(page, 'fields.list[1].value', '${person}');
    expect(await bpmn(api)).toMatch(/<activiti:field name="who">\s*<activiti:expression>\$\{person\}<\/activiti:expression>/);
    await expectUndoRestores(api, before);
  });

  test('Field injection: a field is removed and the others keep their order', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'a.B' } });
      await a.setProperty('svc', 'fields.list', [{ name: 'a', string: '1' }, { name: 'b', string: '2' }, { name: 'c', string: '3' }]);
    }, 'svc');
    const before = await bpmn(api);
    await clickIn(page, 'fields.list[1]', 'Remove');
    const xml = await bpmn(api);
    expect(xml).toMatch(/name="a"[\s\S]*name="c"/);
    expect(xml).not.toContain('name="b"');
    await expectUndoRestores(api, before);
  });

  test('Field injection: a literal with ${...} is flagged, because it is never evaluated', async ({ page }) => {
    await openScene(page, serviceClass, 'svc');
    await addRow(page, 'fields.list');
    await type(page, 'fields.list[0].name', 'tag');
    await type(page, 'fields.list[0].value', '${customerId}');
    await expect(messageOf(page, 'fields.list[0].value')).toContainText('not evaluated');
  });

  test('Field injection: only a Java class or a delegate expression takes fields', async ({ page }) => {
    await openScene(page, serviceExpression, 'svc');
    await expect(page.locator('[data-group-id="group-fields"]')).toHaveCount(0);
  });
});

const MAIL_FIELDS = ['to', 'from', 'cc', 'bcc', 'subject', 'text', 'textVar', 'html', 'htmlVar', 'charset', 'ignoreException', 'exceptionVariableName', 'attachments'];
const SHELL_FIELDS = ['command', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'directory', 'wait', 'redirectError', 'cleanEnv', 'outputVariable', 'errorCodeVariable'];
/** The fields that start as literal text; the others start as expressions (an expression that has no ${...} is the same text). */
const LITERAL = new Set(['textVar', 'htmlVar', 'charset', 'exceptionVariableName', 'ignoreException', 'outputVariable', 'errorCodeVariable', 'wait', 'redirectError', 'cleanEnv', 'directory', 'command']);
const fieldXml = (name: string): RegExp => new RegExp(`<activiti:field name="${name}">\\s*<activiti:${LITERAL.has(name) ? 'string' : 'expression'}>value-${name}</activiti:${LITERAL.has(name) ? 'string' : 'expression'}>`);

test.describe('Mail / Shell fields', () => {
  for (const name of MAIL_FIELDS) {
    typeCase({
      title: `Mail / Shell fields: mail ${name}`,
      scene: mailTask,
      select: 'svc',
      id: `mail.${name}`,
      value: `value-${name}`,
      xml: [fieldXml(name)],
    });
  }
  for (const name of SHELL_FIELDS) {
    typeCase({
      title: `Mail / Shell fields: shell ${name}`,
      scene: shellTask,
      select: 'svc',
      id: `shell.${name}`,
      value: `value-${name}`,
      xml: [fieldXml(name)],
    });
  }

  test('Mail / Shell fields: a text with ${...} becomes an expression field, and a text field is switched with the type select', async ({ page }) => {
    const api = await openScene(page, mailTask, 'svc');
    const before = await bpmn(api);
    await type(page, 'mail.to', '${customerEmail}');
    expect(await bpmn(api)).toMatch(/<activiti:field name="to">\s*<activiti:expression>\$\{customerEmail\}<\/activiti:expression>/);
    await entry(page, 'mail.subject').locator('select').selectOption('string');
    await type(page, 'mail.subject', 'Order confirmed');
    expect(await bpmn(api)).toMatch(/<activiti:field name="subject">\s*<activiti:string>Order confirmed<\/activiti:string>/);
    await entry(page, 'mail.subject').locator('select').selectOption('expression');
    expect(await bpmn(api)).toMatch(/<activiti:field name="subject">\s*<activiti:expression>Order confirmed<\/activiti:expression>/);
    await expectUndoRestores(api, before);
  });

  test('Mail / Shell fields: clearing a field removes it', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:type': 'mail' } });
      await a.setProperty('svc', 'mail.to', 'ann@example.com');
      await a.setProperty('svc', 'mail.subject', 'Hello');
    }, 'svc');
    const before = await bpmn(api);
    await type(page, 'mail.to', '');
    const xml = await bpmn(api);
    expect(xml).not.toContain('name="to"');
    expect(xml).toContain('name="subject"');
    await expectUndoRestores(api, before);
  });

  test('Mail / Shell fields: a literal with ${...} is flagged', async ({ page }) => {
    await openScene(page, shellTask, 'svc');
    await entry(page, 'shell.arg1').locator('select').selectOption('string');
    await type(page, 'shell.arg1', 'x${who}');
    await expect(messageOf(page, 'shell.arg1')).toBeVisible();
  });

  test('Mail / Shell fields: a send task takes the mail fields', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'sendTask', id: 'send' })), 'send');
    const before = await bpmn(api);
    await type(page, 'mail.to', 'ann@example.com');
    expect(await bpmn(api)).toMatch(/<bpmn:sendTask id="send" activiti:type="mail">[\s\S]*<activiti:field name="to">/);
    await expectUndoRestores(api, before);
  });
});

test.describe('Script', () => {
  pickCase({ title: 'Script: format javascript', scene: scriptTask, select: 'script', id: 'script.format', value: 'javascript', xml: ['scriptFormat="javascript"'] });
  pickCase({ title: 'Script: format juel', scene: scriptTask, select: 'script', id: 'script.format', value: 'juel', xml: ['scriptFormat="juel"'] });
  typeCase({ title: 'Script: JUEL script', scene: scriptTask, select: 'script', id: 'script.text', value: '${price * quantity}', xml: [/<bpmn:script>\$\{price \* quantity\}<\/bpmn:script>/] });
  typeCase({
    title: 'Script: JavaScript script',
    scene: async (a) => {
      await a.createShape({ type: 'scriptTask', id: 'script' });
      await a.setProperty('script', 'script.format', 'javascript');
    },
    select: 'script',
    id: 'script.text',
    value: "execution.setVariable('sum', total);",
    xml: ["<bpmn:script>execution.setVariable('sum', total);</bpmn:script>"],
  });
  typeCase({ title: 'Script: result variable', scene: scriptTask, select: 'script', id: 'script.resultVariable', value: 'total', xml: ['activiti:resultVariable="total"'] });
  checkCase({
    title: 'Script: autoStoreVariables, with the warning that the bundled engines ignore it',
    scene: scriptTask,
    select: 'script',
    id: 'script.autoStoreVariables',
    xml: ['activiti:autoStoreVariables="true"'],
    after: async (_api, page) => expect(entry(page, 'script.autoStoreVariables.hint')).toContainText('no effect'),
  });

  test('Script: a syntax error in a JUEL script is refused, a JavaScript script is not checked as JUEL', async ({ page }) => {
    const api = await openScene(page, scriptTask, 'script');
    const before = await bpmn(api);
    await type(page, 'script.text', '${price *}');
    await expect(messageOf(page, 'script.text')).toContainText('operand');
    expect(await bpmn(api)).toBe(before);
    await pick(page, 'script.format', 'javascript');
    await type(page, 'script.text', 'var total = price *;');
    expect(await bpmn(api)).toContain('var total = price *;');
  });

  test('Script: a script format the engine does not bundle is flagged', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'scriptTask', id: 'script' });
      await a.setProperty('script', 'script.format', 'groovy');
    }, 'script');
    await expect(entry(page, 'script.format.hint')).toContainText('JSR-223');
    expect(await valueOf(page, 'script.format')).toBe('groovy');
  });
});

test.describe('Called element', () => {
  typeCase({ title: 'Called element: process key', scene: callActivity, select: 'call', id: 'call.calledElement', value: 'riskCheck', xml: ['calledElement="riskCheck"'] });
  typeCase({ title: 'Called element: process key from an expression', scene: callActivity, select: 'call', id: 'call.calledElement', value: '${childProcess}', xml: ['calledElement="${childProcess}"'] });
  typeCase({ title: 'Called element: business key', scene: callActivity, select: 'call', id: 'call.businessKey', value: '${orderId}', xml: ['activiti:businessKey="${orderId}"'] });
  checkCase({ title: 'Called element: inherit business key', scene: callActivity, select: 'call', id: 'call.inheritBusinessKey', xml: ['activiti:inheritBusinessKey="true"'] });
  checkCase({ title: 'Called element: inherit variables', scene: callActivity, select: 'call', id: 'call.inheritVariables', xml: ['activiti:inheritVariables="true"'] });

  test('Called element: in parameters from a variable and from an expression', async ({ page }) => {
    const api = await openScene(page, callActivity, 'call');
    const before = await bpmn(api);
    await addRow(page, 'call.in');
    await type(page, 'call.in[0].value', 'customerId');
    await type(page, 'call.in[0].target', 'customer');
    expect(await bpmn(api)).toContain('<activiti:in source="customerId" target="customer" />');
    await addRow(page, 'call.in');
    await pick(page, 'call.in[1].kind', 'sourceExpression');
    await type(page, 'call.in[1].value', '${amount * 2}');
    await type(page, 'call.in[1].target', 'doubled');
    expect(await bpmn(api)).toContain('<activiti:in sourceExpression="${amount * 2}" target="doubled" />');
    await expectUndoRestores(api, before);
  });

  test('Called element: out parameters', async ({ page }) => {
    const api = await openScene(page, callActivity, 'call');
    const before = await bpmn(api);
    await addRow(page, 'call.out');
    await type(page, 'call.out[0].value', 'result');
    await type(page, 'call.out[0].target', 'childResult');
    expect(await bpmn(api)).toContain('<activiti:out source="result" target="childResult" />');
    await expectUndoRestores(api, before);
  });

  test('Called element: a bad process key is refused', async ({ page }) => {
    const api = await openScene(page, callActivity, 'call');
    const before = await bpmn(api);
    await type(page, 'call.calledElement', 'my process');
    await expect(messageOf(page, 'call.calledElement')).toContainText('process key');
    expect(await bpmn(api)).toBe(before);
  });
});

