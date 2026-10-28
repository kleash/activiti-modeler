import {
  BADGES_DMN, declared, entry, expect, expectExtensionsUndoRestore, extensions, messageOf, openScene, pick, processExtension, RISK_DMN, test, type, valueOf, type Scene, type Page,
} from './support';

const decisionTask: Scene = async (a) => {
  await a.addDmn('risk', RISK_DMN);
  await a.createShape({ type: 'serviceTask', id: 'dt', name: 'Decide', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
};

const mapping = async (api: Parameters<typeof processExtension>[0]): Promise<{ inputs?: Record<string, unknown>; outputs?: Record<string, unknown> }> => (await processExtension(api)).mappings['dt'] ?? {};

const options = (page: Page, id: string): Promise<string[]> => entry(page, id).locator('option').allInnerTexts();

test.describe('Decision', () => {
  test('Decision: without a DMN file in the project the decision id is typed and the constant is written', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'dt', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } })), 'dt');
    await expect(entry(page, 'decision.pick.empty')).toContainText('no DMN file');
    const before = await extensions(api);
    await type(page, 'decision.table', 'riskLevel');
    expect((await processExtension(api)).constants['dt']).toEqual({ _activiti_dmn_table_: { value: 'riskLevel' } });
    await expect(entry(page, 'decision.info.missing')).toContainText('No DMN file of the project defines the decision "riskLevel"');
    await expectExtensionsUndoRestore(api, before);
  });

  test('Decision: the picker lists the DMN files and the decisions of the project', async ({ page }) => {
    await openScene(page, async (a) => {
      await decisionTask(a);
      await a.addDmn('badges', BADGES_DMN);
    }, 'dt');
    expect(await options(page, 'decision.pick.file')).toEqual(['processes/risk.dmn', 'processes/badges.dmn']);
    expect(await options(page, 'decision.pick')).toEqual(['(choose a decision)', 'Risk level (riskLevel)']);
    await pick(page, 'decision.pick.file', 'processes/badges.dmn');
    expect(await options(page, 'decision.pick')).toEqual(['(choose a decision)', 'Badges (badges)']);
  });

  test('Decision: picking a decision writes the decision id, maps its inputs and outputs and declares the targets', async ({ page }) => {
    const api = await openScene(page, decisionTask, 'dt');
    const before = await extensions(api);
    await pick(page, 'decision.pick', 'riskLevel');
    const ext = await processExtension(api);
    expect(ext.constants['dt']).toEqual({ _activiti_dmn_table_: { value: 'riskLevel' } });
    expect(await mapping(api)).toEqual({
      inputs: { age: { type: 'VARIABLE', value: 'age' }, region: { type: 'VARIABLE', value: 'region' } },
      outputs: { level: { type: 'VARIABLE', value: 'level' }, points: { type: 'VARIABLE', value: 'points' } },
    });
    // FEEL types decide the declared types; numbers are BigDecimals in FEEL
    expect(await declared(api)).toEqual([['level', 'string'], ['points', 'bigdecimal']]);
    expect(await valueOf(page, 'decision.table')).toBe('riskLevel');
    await expect(entry(page, 'decision.info.summary')).toContainText('reads age, region and returns level, points');
    await expectExtensionsUndoRestore(api, before);
  });

  test('Decision: picking again adds what is missing and keeps the rows the task already has', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await decisionTask(a);
      await a.setProperty('dt', 'mapping.inputs', { age: { type: 'VARIABLE', value: 'customerAge' } });
    }, 'dt');
    await pick(page, 'decision.pick', 'riskLevel');
    expect((await mapping(api)).inputs).toEqual({ age: { type: 'VARIABLE', value: 'customerAge' }, region: { type: 'VARIABLE', value: 'region' } });
  });

  test('Decision: the buttons map only the inputs, only the outputs, and add the matched flag and the matched rules', async ({ page }) => {
    const api = await openScene(page, decisionTask, 'dt');
    await api.setProperty('dt', 'decision.table', 'riskLevel');
    await api.select('dt');
    await entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.inputs').click();
    expect(await mapping(api)).toEqual({ inputs: { age: { type: 'VARIABLE', value: 'age' }, region: { type: 'VARIABLE', value: 'region' } } });
    await entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.outputs').click();
    expect(Object.keys((await mapping(api)).outputs ?? {})).toEqual(['level', 'points']);
    await entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.matched').click();
    await entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.matchedRules').click();
    expect((await mapping(api)).outputs).toMatchObject({
      decisionMatched: { type: 'VARIABLE', value: '_activiti_dmn_matched_' },
      decisionMatchedRules: { type: 'VARIABLE', value: '_activiti_dmn_matched_rules_' },
    });
    expect(await declared(api)).toEqual([['level', 'string'], ['points', 'bigdecimal'], ['decisionMatched', 'boolean'], ['decisionMatchedRules', 'array']]);
    await expect(entry(page, 'decision.pick.actions').getByTestId('decision.pick.actions.matched')).toBeDisabled();
  });

  test('Decision: a multi-result decision is mapped as the list under the decision id', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addDmn('badges', BADGES_DMN);
      await a.createShape({ type: 'serviceTask', id: 'dt', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    }, 'dt');
    await pick(page, 'decision.pick', 'badges');
    expect(await mapping(api)).toEqual({ inputs: { points: { type: 'VARIABLE', value: 'points' } }, outputs: { badges: { type: 'VARIABLE', value: 'badges' } } });
    expect(await declared(api)).toEqual([['badges', 'array']]);
    await expect(entry(page, 'decision.info.summary')).toContainText('a list of rows');
  });

  test('Decision: an unmapped input is flagged because it evaluates as null and shows up as no match', async ({ page }) => {
    const api = await openScene(page, decisionTask, 'dt');
    await api.setProperty('dt', 'decision.table', 'riskLevel');
    await api.setProperty('dt', 'mapping.inputs', { age: { type: 'VARIABLE', value: 'age' } });
    await api.select('dt');
    await expect(entry(page, 'decision.inputs.hint')).toContainText('region is not mapped');
    await expect(entry(page, 'decision.inputs.hint')).toContainText('no rule matched');
  });

  test('Decision: the decision id can name a DMN file that holds one decision', async ({ page }) => {
    const api = await openScene(page, decisionTask, 'dt');
    await type(page, 'decision.table', 'risk');
    await expect(entry(page, 'decision.info.summary')).toContainText('reads age, region');
    expect((await processExtension(api)).constants['dt']).toEqual({ _activiti_dmn_table_: { value: 'risk' } });
  });

  test('Decision: a note says that the application needs the DMN connector, which the modeler server includes', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'dt', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } })), 'dt');
    await expect(entry(page, 'decision.connector.hint')).toBeVisible();
    await expect(entry(page, 'decision.connector.hint')).toContainText('the application that runs this process needs the dependency io.github.kleash.activiti:activiti-dmn-connector');
    await expect(entry(page, 'decision.connector.hint')).toContainText('The modeler server already includes it.');
  });

  test('Decision: the notes explain the output contract', async ({ page }) => {
    await openScene(page, decisionTask, 'dt');
    await expect(entry(page, 'decision.pick.hint')).toContainText('_activiti_dmn_matched_rules_');
    await expect(entry(page, 'decision.pick.hint')).toContainText('output columns are not emitted');
    await expect(entry(page, 'mapping.decision.hint')).toContainText('"no rule matched"');
    void messageOf;
  });
});
