import { addListItem, bpmn, clickIn, entry, expect, expectUndoRestores, messageOf, openScene, pick, test, type, type Scene } from './support';

const withMessage: Scene = async (a) => {
  await a.createShape({ type: 'intermediateCatchEvent', id: 'msg', eventDefinition: 'message' });
  await a.setProperty('p', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }]);
  await a.setProperty('msg', 'message.ref', 'approveOrder');
};

test.describe('Messages', () => {
  test('Messages: add a message', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await addListItem(page, 'messages');
    expect(await bpmn(api)).toMatch(/<bpmn:message id="Message_\w+" name="newMessage" \/>/);
    await expectUndoRestores(api, before);
  });

  test('Messages: rename a message', async ({ page }) => {
    const api = await openScene(page, withMessage);
    const before = await bpmn(api);
    await type(page, 'definitions.messages[0].name', 'orderApproved');
    expect(await bpmn(api)).toContain('<bpmn:message id="approveMessage" name="orderApproved" />');
    await expectUndoRestores(api, before);
  });

  test('Messages: change the id, references follow', async ({ page }) => {
    const api = await openScene(page, withMessage);
    const before = await bpmn(api);
    await type(page, 'definitions.messages[0].id', 'approvedMsg');
    const xml = await bpmn(api);
    expect(xml).toContain('<bpmn:message id="approvedMsg" name="approveOrder" />');
    expect(xml).toContain('messageRef="approvedMsg"');
    expect(xml).not.toContain('approveMessage');
    await expectUndoRestores(api, before);
  });

  test('Messages: an id that is not an NCName is refused with a message', async ({ page }) => {
    const api = await openScene(page, withMessage);
    const before = await bpmn(api);
    await type(page, 'definitions.messages[0].id', '1 bad');
    await expect(messageOf(page, 'definitions.messages[0].id')).toContainText('cannot contain spaces');
    expect(await bpmn(api)).toBe(before);
  });

  test('Messages: the reference count is shown and delete clears the references in one undo step', async ({ page }) => {
    const api = await openScene(page, withMessage);
    const before = await bpmn(api);
    await expect(entry(page, 'definitions.messages[0].usage')).toContainText('Used by 1 element');
    await clickIn(page, 'definitions.messages[0]', /delete|remove/i);
    const xml = await bpmn(api);
    expect(xml).not.toContain('<bpmn:message ');
    expect(xml).not.toContain('messageRef');
    await api.undo();
    expect(await bpmn(api)).toBe(before);
  });

  test('Messages: an unused message reports it', async ({ page }) => {
    await openScene(page, async (a) => a.setProperty('p', 'definitions.messages', [{ id: 'm1', name: 'unused' }]));
    await expect(entry(page, 'definitions.messages[0].usage')).toContainText('Not used');
  });
});

test.describe('Signals', () => {
  const withSignal: Scene = async (a) => {
    await a.createShape({ type: 'intermediateCatchEvent', id: 'sig', eventDefinition: 'signal' });
    await a.setProperty('p', 'definitions.signals', [{ id: 'stockSignal', name: 'stockLow' }]);
    await a.setProperty('sig', 'signal.ref', 'stockLow');
  };

  test('Signals: add a signal', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await addListItem(page, 'signals');
    expect(await bpmn(api)).toMatch(/<bpmn:signal id="Signal_\w+" name="newSignal" \/>/);
    await expectUndoRestores(api, before);
  });

  test('Signals: rename and scope', async ({ page }) => {
    const api = await openScene(page, withSignal);
    const before = await bpmn(api);
    await type(page, 'definitions.signals[0].name', 'stockEmpty');
    expect(await bpmn(api)).toContain('name="stockEmpty"');
    await pick(page, 'definitions.signals[0].scope', 'processInstance');
    expect(await bpmn(api)).toMatch(/<bpmn:signal id="stockSignal" name="stockEmpty" activiti:scope="processInstance"/);
    await expectUndoRestores(api, before);
  });

  test('Signals: delete shows the reference count and clears the references', async ({ page }) => {
    const api = await openScene(page, withSignal);
    const before = await bpmn(api);
    await expect(entry(page, 'definitions.signals[0].usage')).toContainText('Used by 1 element');
    await clickIn(page, 'definitions.signals[0]', /delete|remove/i);
    const xml = await bpmn(api);
    expect(xml).not.toContain('<bpmn:signal ');
    expect(xml).not.toContain('signalRef');
    await api.undo();
    expect(await bpmn(api)).toBe(before);
  });

  test('Signals: a duplicate name is refused with a message', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'definitions.signals', [{ id: 's1', name: 'one' }, { id: 's2', name: 'two' }]));
    const before = await bpmn(api);
    await type(page, 'definitions.signals[1].name', 'one');
    await expect(messageOf(page, 'definitions.signals[1].name')).toContainText('twice');
    expect(await bpmn(api)).toBe(before);
  });
});

test.describe('Errors', () => {
  const withError: Scene = async (a) => {
    await a.createShape({ type: 'endEvent', id: 'errEnd', eventDefinition: 'error' });
    await a.setProperty('p', 'definitions.errors', [{ id: 'guardError', name: 'Guard error', errorCode: 'GUARD' }]);
    await a.setProperty('errEnd', 'error.ref', 'GUARD');
  };

  test('Errors: add an error', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await addListItem(page, 'errors');
    expect(await bpmn(api)).toMatch(/<bpmn:error id="Error_\w+" name="ERROR_CODE" errorCode="ERROR_CODE" \/>/);
    await expectUndoRestores(api, before);
  });

  test('Errors: change the error code and the name', async ({ page }) => {
    const api = await openScene(page, withError);
    const before = await bpmn(api);
    await type(page, 'definitions.errors[0].errorCode', 'DENIED');
    expect(await bpmn(api)).toContain('errorCode="DENIED"');
    await type(page, 'definitions.errors[0].name', 'Denied');
    expect(await bpmn(api)).toContain('name="Denied"');
    await expectUndoRestores(api, before);
  });

  test('Errors: delete shows the reference count and clears the references', async ({ page }) => {
    const api = await openScene(page, withError);
    const before = await bpmn(api);
    await expect(entry(page, 'definitions.errors[0].usage')).toContainText('Used by 1 element');
    await clickIn(page, 'definitions.errors[0]', /delete|remove/i);
    const xml = await bpmn(api);
    expect(xml).not.toContain('<bpmn:error ');
    expect(xml).not.toContain('errorRef');
    await api.undo();
    expect(await bpmn(api)).toBe(before);
  });
});

test.describe('Data object', () => {
  test('Data object: add a data object to the process', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await addListItem(page, 'dataObjects');
    expect(await bpmn(api)).toMatch(/<bpmn:dataObject id="DataObject_\w+" name="variable" itemSubjectRef="xsd:string"/);
    await expectUndoRestores(api, before);
  });

  test('Data object: name, type and default value', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'data.objects', [{ id: 'amountObject', name: 'amount', type: 'xsd:string' }]));
    const before = await bpmn(api);
    await type(page, 'data.objects[0].name', 'total');
    expect(await bpmn(api)).toContain('name="total"');
    await pick(page, 'data.objects[0].type', 'xsd:int');
    expect(await bpmn(api)).toContain('itemSubjectRef="xsd:int"');
    await type(page, 'data.objects[0].value', '7');
    expect(await bpmn(api)).toMatch(/<activiti:value>7<\/activiti:value>/);
    await expectUndoRestores(api, before);
  });

  test('Data object: delete from the list', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'data.objects', [{ id: 'amountObject', name: 'amount', type: 'xsd:string' }]));
    const before = await bpmn(api);
    await clickIn(page, 'data.objects[0]', /delete|remove/i);
    expect(await bpmn(api)).not.toContain('<bpmn:dataObject ');
    await expectUndoRestores(api, before);
  });

  test('Data object: a variable name with a space is flagged', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'data.objects', [{ id: 'amountObject', name: 'amount', type: 'xsd:string' }]));
    const before = await bpmn(api);
    await type(page, 'data.objects[0].name', 'my var');
    await expect(messageOf(page, 'data.objects[0].name')).toBeVisible();
    expect(await bpmn(api)).toBe(before);
  });

  test('Data object: a drawn reference is edited through its fields', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'dataObjectReference', id: 'data' })), 'data');
    const before = await bpmn(api);
    await type(page, 'data.name', 'amount');
    expect(await bpmn(api)).toMatch(/<bpmn:dataObject id="DataObject_\w+" name="amount"/);
    await pick(page, 'data.type', 'xsd:int');
    expect(await bpmn(api)).toContain('itemSubjectRef="xsd:int"');
    await type(page, 'data.value', '3');
    expect(await bpmn(api)).toContain('<activiti:value>3</activiti:value>');
    await expectUndoRestores(api, before);
  });
});
