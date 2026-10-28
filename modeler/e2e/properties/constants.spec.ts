import { addRow, connectorTask, entry, expect, expectExtensionsUndoRestore, extensions, openScene, processExtension, reveal, test, type, valueOf, RISK_DMN } from './support';

const constantsOf = async (api: Parameters<typeof processExtension>[0], id = 'svc'): Promise<Record<string, { value: unknown }> | undefined> => (await processExtension(api)).constants[id];

test.describe('Constants', () => {
  for (const [text, stored] of [
    ['EU', 'EU'],
    ['42', 42],
    ['0.5', 0.5],
    ['true', true],
    ['null', null],
    ['"42"', '42'],
    ['{ "a": [1, 2] }', { a: [1, 2] }],
    ['["x", "y"]', ['x', 'y']],
    ['${tier}', '${tier}'],
  ] as const) {
    test(`Constants: the value ${text} is stored as ${JSON.stringify(stored)}`, async ({ page }) => {
      const api = await openScene(page, connectorTask, 'svc');
      const before = await extensions(api);
      await addRow(page, 'constants.values');
      await type(page, 'constants.values[0].name', 'region');
      await type(page, 'constants.values[0].value', text);
      expect(await constantsOf(api)).toEqual({ region: { value: stored } });
      await api.select('svc');
      // a list or an object is shown as compact JSON
      expect(await valueOf(page, 'constants.values[0].value')).toBe(typeof stored === 'object' && stored !== null ? JSON.stringify(stored) : text);
      await expectExtensionsUndoRestore(api, before);
    });
  }

  test('Constants: several constants keep their order and one can be removed', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await connectorTask(a);
      await a.setProperty('svc', 'constants.values', { region: 'EU', limit: 42, flag: true });
    }, 'svc');
    expect(Object.keys((await constantsOf(api))!)).toEqual(['region', 'limit', 'flag']);
    const before = await extensions(api);
    await reveal(page, 'constants.values[1].name');
    await page.getByTestId('constants.values[1]-remove').click();
    expect(await constantsOf(api)).toEqual({ region: { value: 'EU' }, flag: { value: true } });
    await expectExtensionsUndoRestore(api, before);
  });

  test('Constants: a name that is used twice is refused', async ({ page }) => {
    const api = await openScene(page, connectorTask, 'svc');
    await addRow(page, 'constants.values');
    await type(page, 'constants.values[0].name', 'region');
    await type(page, 'constants.values[0].value', 'EU');
    await addRow(page, 'constants.values');
    await type(page, 'constants.values[1].name', 'region');
    await type(page, 'constants.values[1].value', 'US');
    await expect(entry(page, 'constants.values[1]')).toContainText('defined twice');
    expect(await constantsOf(api)).toEqual({ region: { value: 'EU' } });
  });

  test('Constants: the constant of a decision task is not listed and survives editing the others', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addDmn('risk', RISK_DMN);
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
      await a.setProperty('svc', 'decision.table', 'riskLevel');
    }, 'svc');
    await expect(entry(page, 'constants.values[0]')).toHaveCount(0);
    await addRow(page, 'constants.values');
    await type(page, 'constants.values[0].name', 'region');
    await type(page, 'constants.values[0].value', 'EU');
    expect(await constantsOf(api)).toEqual({ _activiti_dmn_table_: { value: 'riskLevel' }, region: { value: 'EU' } });
  });

  test('Constants: the group is for tasks that receive inputs, not for a class task', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'cls', attrs: { 'activiti:class': 'com.example.D' } });
    }, 'cls');
    await expect(entry(page, 'constants.values')).toHaveCount(0);
  });
});
