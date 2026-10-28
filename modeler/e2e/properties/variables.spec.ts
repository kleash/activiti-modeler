import { addRow, check, declared, entry, expect, expectExtensionsUndoRestore, extensions, messageOf, openScene, pick, processExtension, reveal, test, type } from './support';

/** A process variable row: `variables.list[<i>].<field>`. */
const cell = (i: number, field: string): string => `variables.list[${i}].${field}`;

const mapped: Parameters<typeof openScene>[1] = async (a) => {
  await a.createShape({ type: 'serviceTask', id: 'svc', name: 'Look up', attrs: { implementation: 'crm.LOOKUP' } });
  await a.setProperty('svc', 'mapping.outputs', { tier: { type: 'VARIABLE', value: 'tier' } });
};

test.describe('Process variables', () => {
  test('Process variables: a string variable with a default value and a description', async ({ page }) => {
    const api = await openScene(page);
    const before = await extensions(api);
    await addRow(page, 'variables.list');
    await type(page, cell(0, 'name'), 'orderId');
    await type(page, cell(0, 'value'), 'SO-1');
    await type(page, cell(0, 'description'), 'Order number');
    const [variable] = Object.values((await processExtension(api)).properties);
    expect(variable).toMatchObject({ name: 'orderId', type: 'string', required: false, value: 'SO-1', description: 'Order number' });
    expect(typeof variable!['id']).toBe('string');
    await expectExtensionsUndoRestore(api, before);
    expect(await declared(api)).toEqual([]);
  });

  for (const [type_, text, typed] of [
    ['boolean', 'true', true],
    ['integer', '7', 7],
    ['bigdecimal', '0.25', 0.25],
    ['bigdecimal', '12.50', '12.50'],
    ['date', '2030-05-17', '2030-05-17'],
    ['datetime', '2030-05-17T10:15:30.000Z', '2030-05-17T10:15:30.000Z'],
    ['json', '{ "retries": 3, "tags": ["a"] }', { retries: 3, tags: ['a'] }],
    ['array', '["x", "y"]', ['x', 'y']],
    ['file', '{ "id": "f-1", "name": "doc.pdf" }', { id: 'f-1', name: 'doc.pdf' }],
    ['folder', '{ "id": "d-1" }', { id: 'd-1' }],
    ['content', '{ "id": "c-1" }', { id: 'c-1' }],
    ['string', '${orderId}-${count}', '${orderId}-${count}'],
  ] as const) {
    test(`Process variables: type ${type_} with the default ${text}`, async ({ page }) => {
      const api = await openScene(page);
      const before = await extensions(api);
      await addRow(page, 'variables.list');
      await type(page, cell(0, 'name'), 'v');
      await pick(page, cell(0, 'type'), type_);
      await type(page, cell(0, 'value'), text);
      const [variable] = Object.values((await processExtension(api)).properties);
      expect(variable).toMatchObject({ name: 'v', type: type_, value: typed });
      await expectExtensionsUndoRestore(api, before);
    });
  }

  test('Process variables: required, display name, display, analytics and ephemeral', async ({ page }) => {
    const api = await openScene(page);
    await addRow(page, 'variables.list');
    await type(page, cell(0, 'name'), 'title');
    await check(page, cell(0, 'required'));
    await page.getByTestId('variables.list[0]-more').click();
    await type(page, cell(0, 'displayName'), 'Title');
    await pick(page, cell(0, 'display'), 'true');
    await pick(page, cell(0, 'analytics'), 'false');
    await pick(page, cell(0, 'ephemeral'), 'true');
    const [variable] = Object.values((await processExtension(api)).properties);
    expect(variable).toMatchObject({ name: 'title', required: true, displayName: 'Title', display: true, analytics: false, ephemeral: true });
    // an option set back to "Not set" is removed from the file
    await pick(page, cell(0, 'analytics'), '');
    expect(Object.values((await processExtension(api)).properties)[0]).not.toHaveProperty('analytics');
  });

  test('Process variables: a default that does not fit the type is refused with a message and not written', async ({ page }) => {
    const api = await openScene(page);
    await addRow(page, 'variables.list');
    await type(page, cell(0, 'name'), 'count');
    await pick(page, cell(0, 'type'), 'integer');
    await type(page, cell(0, 'value'), 'seven');
    await expect(messageOf(page, cell(0, 'value'))).toContainText('whole number');
    await expect(entry(page, 'variables.list[0]')).toContainText('not saved yet');
    // the variable keeps its last valid version while the value is wrong
    expect(Object.values((await processExtension(api)).properties)[0]).toMatchObject({ name: 'count', type: 'integer' });
    expect(Object.values((await processExtension(api)).properties)[0]).not.toHaveProperty('value');
    // fixing the value writes the row
    await type(page, cell(0, 'value'), '7');
    expect(Object.values((await processExtension(api)).properties)[0]).toMatchObject({ name: 'count', type: 'integer', value: 7 });
    await pick(page, cell(0, 'type'), 'date');
    await expect(messageOf(page, cell(0, 'value'))).toContainText('ISO 8601');
    await pick(page, cell(0, 'type'), 'boolean');
    await expect(messageOf(page, cell(0, 'value'))).toContainText('true or false');
    await pick(page, cell(0, 'type'), 'json');
    await type(page, cell(0, 'value'), '{broken');
    await expect(messageOf(page, cell(0, 'value'))).toContainText('JSON');
  });

  test('Process variables: a name must be a plain identifier and unique', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'variables.list', [{ name: 'taken', type: 'string' }]));
    await addRow(page, 'variables.list');
    await type(page, cell(1, 'name'), 'bad name');
    await expect(messageOf(page, cell(1, 'name'))).toContainText('plain identifier');
    await type(page, cell(1, 'name'), 'taken');
    await expect(entry(page, 'variables.list[1]')).toContainText('declared twice');
    expect(await declared(api)).toEqual([['taken', 'string']]);
  });

  test('Process variables: renaming keeps the id of the variable', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'variables.list', [{ name: 'old', type: 'string', value: 'x' }]));
    const [[idBefore]] = Object.entries((await processExtension(api)).properties);
    await type(page, cell(0, 'name'), 'renamed');
    const properties = (await processExtension(api)).properties;
    expect(Object.keys(properties)).toEqual([idBefore]);
    expect(properties[idBefore!]).toMatchObject({ name: 'renamed', value: 'x' });
  });

  test('Process variables: removing a variable deletes it; one undo brings it back', async ({ page }) => {
    const api = await openScene(page, async (a) => a.setProperty('p', 'variables.list', [{ name: 'a', type: 'string' }, { name: 'b', type: 'integer' }]));
    const before = await extensions(api);
    await reveal(page, cell(0, 'name'));
    await page.getByTestId('variables.list[0]-remove').click();
    expect(await declared(api)).toEqual([['b', 'integer']]);
    await expectExtensionsUndoRestore(api, before);
  });

  test('Process variables: removing a declared mapping target warns first and the engine consequence is explained', async ({ page }) => {
    const api = await openScene(page, mapped);
    expect(await declared(api)).toEqual([['tier', 'json']]);
    await reveal(page, cell(0, 'name'));
    await page.getByTestId('variables.list[0]-remove').click();
    const confirm = entry(page, 'variables.list[0].confirm');
    await expect(confirm).toContainText('target of the output mapping of svc');
    await expect(confirm).toContainText('drops that output');
    // nothing was removed yet; Keep leaves everything as it is
    expect(await declared(api)).toEqual([['tier', 'json']]);
    await page.getByTestId('variables.list[0]-keep').click();
    await expect(confirm).toHaveCount(0);
    expect(await declared(api)).toEqual([['tier', 'json']]);
    // Delete anyway removes it, in one step that one undo takes back
    const before = await extensions(api);
    await page.getByTestId('variables.list[0]-remove').click();
    await page.getByTestId('variables.list[0]-remove-anyway').click();
    expect(await declared(api)).toEqual([]);
    expect((await processExtension(api)).mappings['svc']).toBeDefined();
    await expectExtensionsUndoRestore(api, before);
  });

  test('Process variables: a json variable without a default is flagged because it starts as JSON null', async ({ page }) => {
    await openScene(page, async (a) => a.setProperty('p', 'variables.list', [{ name: 'profile', type: 'json' }]));
    await reveal(page, cell(0, 'name'));
    await expect(entry(page, 'variables.json.hint')).toContainText('JSON null');
    await expect(entry(page, cell(0, 'value'))).toContainText('JSON null');
  });

});
