import {
  addRow, check, connectorTask, entry, expect, expectExtensionsUndoRestore, extensions, messageOf, openScene, pick, processExtension, reveal, suggestionsOf, test, type, userTask, valueOf, type Scene,
  declared,
} from './support';

const mappingOf = async (api: Parameters<typeof processExtension>[0], id = 'svc'): Promise<Record<string, unknown> | undefined> => (await processExtension(api)).mappings[id];

const callActivity: Scene = async (a) => void (await a.createShape({ type: 'callActivity', id: 'call' }));

test.describe('Input / output mapping', () => {
  for (const [value, expected] of [
    ['MAP_ALL', 'MAP_ALL'],
    ['MAP_ALL_INPUTS', 'MAP_ALL_INPUTS'],
    ['MAP_ALL_OUTPUTS', 'MAP_ALL_OUTPUTS'],
  ] as const) {
    test(`Input / output mapping: mapping type ${value}`, async ({ page }) => {
      const api = await openScene(page, connectorTask, 'svc');
      const before = await extensions(api);
      await pick(page, 'mapping.type', value);
      expect(await mappingOf(api)).toEqual({ mappingType: expected });
      await pick(page, 'mapping.type', '');
      expect(await mappingOf(api)).toBeUndefined();
      await api.undo();
      expect(await mappingOf(api)).toEqual({ mappingType: expected });
      await expectExtensionsUndoRestore(api, before);
    });
  }

  test('Input / output mapping: a variable input and a value input of a connector', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    const before = await extensions(api);
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[0].target', 'customerId');
    await type(page, 'mapping.inputs[0].value', 'cid');
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[1].target', 'greeting');
    await pick(page, 'mapping.inputs[1].type', 'VALUE');
    await type(page, 'mapping.inputs[1].value', 'hello');
    expect(await mappingOf(api)).toEqual({
      inputs: { customerId: { type: 'VARIABLE', value: 'cid' }, greeting: { type: 'VALUE', value: 'hello' } },
    });
    await expectExtensionsUndoRestore(api, before);
  });

  for (const [text, stored] of [
    ['hello', 'hello'],
    ['${tier}', '${tier}'],
    ['${customerName} is ${tier}', '${customerName} is ${tier}'],
    ['42', 42],
    ['"42"', '42'],
    ['true', true],
  ] as const) {
    test(`Input / output mapping: the value input ${text} is stored as ${JSON.stringify(stored)}`, async ({ page }) => {
      const api = await openScene(page, connectorTask, 'svc');
      await addRow(page, 'mapping.inputs');
      await type(page, 'mapping.inputs[0].target', 'x');
      await pick(page, 'mapping.inputs[0].type', 'VALUE');
      await type(page, 'mapping.inputs[0].value', text);
      expect(await mappingOf(api)).toEqual({ inputs: { x: { type: 'VALUE', value: stored } } });
      // the row shows what was typed after a reload of the panel
      await api.select('svc');
      expect(await valueOf(page, 'mapping.inputs[0].value')).toBe(text);
    });
  }

  test('Input / output mapping: an expression with a syntax error in a value input is not written', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[0].target', 'x');
    await pick(page, 'mapping.inputs[0].type', 'VALUE');
    await type(page, 'mapping.inputs[0].value', '${tier +}');
    await expect(messageOf(page, 'mapping.inputs[0].value')).toBeVisible();
    expect(await mappingOf(api)).toBeUndefined();
  });

  test('Input / output mapping: a variable output declares its target with the type the connector gives it', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    const before = await extensions(api);
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[0].target', 'tierOfCustomer');
    await type(page, 'mapping.outputs[0].value', 'tier');
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[1].target', 'isKnown');
    await type(page, 'mapping.outputs[1].value', 'found');
    expect(await mappingOf(api)).toEqual({ outputs: { tierOfCustomer: { type: 'VARIABLE', value: 'tier' }, isKnown: { type: 'VARIABLE', value: 'found' } } });
    expect(await declared(api)).toEqual([['tierOfCustomer', 'string'], ['isKnown', 'boolean']]);
    await expectExtensionsUndoRestore(api, before);
    expect(await declared(api)).toEqual([]);
  });

  test('Input / output mapping: a value output is typed from its literal and may not contain an expression', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[0].target', 'attempts');
    await pick(page, 'mapping.outputs[0].type', 'VALUE');
    await type(page, 'mapping.outputs[0].value', '3');
    expect(await mappingOf(api)).toEqual({ outputs: { attempts: { type: 'VALUE', value: 3 } } });
    expect(await declared(api)).toEqual([['attempts', 'integer']]);
    await type(page, 'mapping.outputs[0].value', '${other}');
    await expect(messageOf(page, 'mapping.outputs[0].value')).toContainText('cannot contain an expression');
    expect(await mappingOf(api)).toEqual({ outputs: { attempts: { type: 'VALUE', value: 3 } } });
  });

  test('Input / output mapping: a JSON patch output keeps the patch as an array and declares a json variable', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[0].target', 'profile');
    await pick(page, 'mapping.outputs[0].type', 'JSONPATCH');
    await type(page, 'mapping.outputs[0].value', '[{"op":"add","path":"/name","value":"Ann"}]');
    expect(await mappingOf(api)).toEqual({ outputs: { profile: { type: 'JSONPATCH', value: [{ op: 'add', path: '/name', value: 'Ann' }] } } });
    expect(await declared(api)).toEqual([['profile', 'json']]);
    await type(page, 'mapping.outputs[0].value', '{"op":"add"}');
    await expect(messageOf(page, 'mapping.outputs[0].value')).toContainText('array of operations');
    await expect(entry(page, 'mapping.jsonpatch.hint')).toContainText('ignores the result');
  });

  test('Input / output mapping: ephemeral', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    const before = await extensions(api);
    await check(page, 'mapping.ephemeral');
    expect(await mappingOf(api)).toEqual({ ephemeral: true });
    await expect(entry(page, 'mapping.ephemeral.hint')).toContainText('only a flag');
    await expectExtensionsUndoRestore(api, before);
  });

  test('Input / output mapping: a name mapped twice is refused and the first row stays', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[0].target', 'customerId');
    await type(page, 'mapping.inputs[0].value', 'a');
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[1].target', 'customerId');
    await type(page, 'mapping.inputs[1].value', 'b');
    await expect(entry(page, 'mapping.inputs[1]')).toContainText('mapped twice');
    expect(await mappingOf(api)).toEqual({ inputs: { customerId: { type: 'VARIABLE', value: 'a' } } });
  });

  test('Input / output mapping: removing a row removes it from the file', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await connectorTask(a);
      await a.setProperty('svc', 'mapping.inputs', { customerId: { type: 'VARIABLE', value: 'cid' }, extra: { type: 'VALUE', value: 1 } });
    }, 'svc');
    const before = await extensions(api);
    await reveal(page, 'mapping.inputs[1].target');
    await page.getByTestId('mapping.inputs[1]-remove').click();
    expect(await mappingOf(api)).toEqual({ inputs: { customerId: { type: 'VARIABLE', value: 'cid' } } });
    await expectExtensionsUndoRestore(api, before);
  });

  test('Input / output mapping: the autocomplete offers the inputs and outputs of the connector action and the process variables', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.setProperty('p', 'variables.list', [{ name: 'cid', type: 'string' }, { name: 'tier', type: 'string' }]);
      await connectorTask(a);
    }, 'svc');
    await addRow(page, 'mapping.inputs');
    await addRow(page, 'mapping.outputs');
    expect(await suggestionsOf(page, 'mapping.inputs[0].target')).toEqual(['customerId']);
    expect(await suggestionsOf(page, 'mapping.inputs[0].value')).toEqual(expect.arrayContaining(['cid', 'tier']));
    expect(await suggestionsOf(page, 'mapping.outputs[0].value')).toEqual(['customerName', 'tier', 'found']);
    expect(await suggestionsOf(page, 'mapping.outputs[0].target')).toEqual(['cid', 'tier']);
  });

  test('Input / output mapping: a user task takes inputs and outputs, and sys_task_assignee is offered', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await userTask(a);
      await a.setProperty('u', 'mapping.inputs', { amount: { type: 'VARIABLE', value: 'amount' } });
    }, 'u');
    await addRow(page, 'mapping.outputs');
    expect(await suggestionsOf(page, 'mapping.outputs[0].value')).toEqual(['sys_task_assignee', 'amount']);
    await type(page, 'mapping.outputs[0].target', 'completedBy');
    await type(page, 'mapping.outputs[0].value', 'sys_task_assignee');
    expect((await mappingOf(api, 'u'))?.['outputs']).toEqual({ completedBy: { type: 'VARIABLE', value: 'sys_task_assignee' } });
    await expect(entry(page, 'mapping.userTask.hint')).toContainText('completion variables never reach the process');
    await pick(page, 'mapping.type', 'MAP_ALL');
    await expect(entry(page, 'mapping.userTask.all.hint')).toContainText('sys_task_assignee');
  });

  test('Input / output mapping: a call activity maps inputs and outputs and explains what the child needs', async ({ page }) => {
    const api = await openScene(page, callActivity, 'call');
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[0].target', 'customerId');
    await type(page, 'mapping.inputs[0].value', 'customerId');
    expect((await mappingOf(api, 'call'))?.['inputs']).toEqual({ customerId: { type: 'VARIABLE', value: 'customerId' } });
    await expect(entry(page, 'mapping.callActivity.hint')).toContainText('extensions file');
  });

  test('Input / output mapping: the mapping of a start event is an output mapping on the start payload', async ({ page }) => {
    const api = await openScene(page, async (a) => a.createShape({ type: 'startEvent', id: 'begin' }).then(() => undefined), 'begin');
    await expect(entry(page, 'mapping.inputs')).toHaveCount(0);
    const options = await entry(page, 'mapping.type').locator('option').allInnerTexts();
    expect(options.map((o) => o.split(':')[0])).toEqual(['Only the rows below', 'MAP_ALL', 'MAP_ALL_OUTPUTS']);
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[0].target', 'customerName');
    await type(page, 'mapping.outputs[0].value', 'name');
    expect((await mappingOf(api, 'begin'))?.['outputs']).toEqual({ customerName: { type: 'VARIABLE', value: 'name' } });
    await expect(entry(page, 'mapping.start.hint')).toContainText('rest of the payload is dropped');
  });

  test('Input / output mapping: a message catch event maps the payload to variables', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'message' })), 'wait');
    await addRow(page, 'mapping.outputs');
    await type(page, 'mapping.outputs[0].target', 'orderRef');
    await type(page, 'mapping.outputs[0].value', 'ref');
    expect((await mappingOf(api, 'wait'))?.['outputs']).toEqual({ orderRef: { type: 'VARIABLE', value: 'ref' } });
    await expect(entry(page, 'mapping.catch.hint')).toContainText('payload of the message is dropped');
  });

  test('Input / output mapping: a message throw event maps the payload from inputs', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'intermediateThrowEvent', id: 'send', eventDefinition: 'message' })), 'send');
    await expect(entry(page, 'mapping.outputs')).toHaveCount(0);
    await addRow(page, 'mapping.inputs');
    await type(page, 'mapping.inputs[0].target', 'order');
    await type(page, 'mapping.inputs[0].value', 'orderId');
    expect((await mappingOf(api, 'send'))?.['inputs']).toEqual({ order: { type: 'VARIABLE', value: 'orderId' } });
    await expect(entry(page, 'mapping.throw.hint')).toContainText('payload of the message');
  });

  test('Input / output mapping: a signal event is not mapped by the engine and says so', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'intermediateCatchEvent', id: 'sig', eventDefinition: 'signal' })), 'sig');
    await expect(entry(page, 'mapping.signal.hint')).toContainText('Signal payloads are not mapped');
    await expect(entry(page, 'mapping.inputs')).toHaveCount(0);
    await expect(entry(page, 'mapping.outputs')).toHaveCount(0);
  });

  test('Input / output mapping: a decision task and a connector task show the engine notes; a class task has no mapping group', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'conn', attrs: { implementation: 'crm.LOOKUP' } });
      await a.createShape({ type: 'serviceTask', id: 'cls', attrs: { 'activiti:class': 'com.example.D' } });
    }, 'conn');
    await expect(entry(page, 'mapping.connector.hint')).toContainText('declared');
    await api.select('cls');
    await expect(entry(page, 'mapping.type')).toHaveCount(0);
  });

  test('Input / output mapping: an output to an undeclared variable is flagged', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await api.setProperty('svc', 'mapping.outputs', { tier: { type: 'VARIABLE', value: 'tier' } });
    await api.setProperty('p', 'variables.list', []);
    await api.select('svc');
    await expect(entry(page, 'mapping.outputs.undeclared')).toContainText('tier is not declared');
  });
});

