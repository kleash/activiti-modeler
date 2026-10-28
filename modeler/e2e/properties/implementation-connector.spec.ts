import { activePanel } from '../support/app';
import { normalize, bpmn, CRM_CONNECTOR, declared, entry, expect, extensions, openScene, pick, processExtension, test, type, valueOf, type Page, type Scene } from './support';

const plain: Scene = async (a) => {
  await a.addConnector('crm', CRM_CONNECTOR);
  await a.createShape({ type: 'serviceTask', id: 'svc' });
  await a.setProperty('svc', 'impl.type', 'connector');
};

const popup = (page: Page) => page.locator('.djs-popup');
const popupEntry = (page: Page, id: string) => popup(page).locator(`[data-id="apply-template-${id}"]`);

/** Both documents as the exporter writes them, to compare before and after an undo. */
async function snapshot(api: Parameters<typeof bpmn>[0]): Promise<{ xml: string; json: Record<string, unknown> }> {
  return { xml: normalize(await bpmn(api)), json: await extensions(api) };
}

test.describe('Implementation: connector picker and templates', () => {
  test('Implementation: the connector picker lists the actions of the project', async ({ page }) => {
    await openScene(page, plain, 'svc');
    const options = await entry(page, 'impl.connector.pick').locator('option').allInnerTexts();
    expect(options).toEqual(['(choose an action)', 'crm.LOOKUP: Look up a customer', 'crm.DELETE: Delete a customer']);
  });

  test('Implementation: choosing an action applies its template - implementation, name, mappings, declared variables and the version link - in one undo step', async ({ page }) => {
    const api = await openScene(page, plain, 'svc');
    const before = await snapshot(api);
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    const xml = await bpmn(api);
    expect(xml).toContain('implementation="crm.LOOKUP"');
    expect(xml).toContain('name="Look up a customer"');
    expect(xml).toContain('activiti:templateId="crm.LOOKUP"');
    expect(xml).toContain('activiti:templateVersion="1"');
    expect((await processExtension(api)).mappings['svc']).toEqual({
      inputs: { customerId: { type: 'VARIABLE', value: 'customerId' } },
      outputs: { customerName: { type: 'VARIABLE', value: 'customerName' }, tier: { type: 'VARIABLE', value: 'tier' }, found: { type: 'VARIABLE', value: 'found' } },
    });
    expect(await declared(api)).toEqual([['customerName', 'string'], ['tier', 'string'], ['found', 'boolean']]);
    expect(await valueOf(page, 'impl.connector')).toBe('crm.LOOKUP');
    await api.undo();
    expect(await snapshot(api)).toEqual(before);
  });

  test('Implementation: typing the action by hand changes only the implementation and drops the template link', async ({ page }) => {
    const api = await openScene(page, plain, 'svc');
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    await type(page, 'impl.connector', 'crm.DELETE');
    const xml = await bpmn(api);
    expect(xml).toContain('implementation="crm.DELETE"');
    expect(xml).not.toContain('templateId');
    expect(Object.keys((await processExtension(api)).mappings['svc']!['outputs'] as object)).toEqual(['customerName', 'tier', 'found']);
  });

  test('Implementation: a project without connectors says where to add one', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc' });
      await a.setProperty('svc', 'impl.type', 'connector');
    }, 'svc');
    await expect(entry(page, 'impl.connector.empty')).toContainText('no connector definitions');
  });

  test('Implementation: the template header offers the chooser; choosing a connector action applies it', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addConnector('crm', CRM_CONNECTOR);
      await a.createShape({ type: 'serviceTask', id: 'svc' });
    }, 'svc');
    const before = await snapshot(api);
    await expect(entry(page, 'template.info')).toContainText('not created from a template');
    await page.getByTestId('template.info.choose').click();
    await expect(popup(page)).toBeVisible();
    // the built-in kinds and the actions of the project, each with its icon
    await expect(popupEntry(page, 'crm.LOOKUP')).toContainText('crm: Look up a customer');
    await expect(popupEntry(page, 'builtin/mail')).toBeVisible();
    await expect(popupEntry(page, 'crm.LOOKUP').locator('img')).toHaveCount(1);
    await popupEntry(page, 'crm.LOOKUP').click();
    expect(await bpmn(api)).toContain('activiti:templateId="crm.LOOKUP"');
    await expect(entry(page, 'template.info')).toContainText('Created from the template crm: Look up a customer (version 1)');
    await api.undo();
    expect(await snapshot(api)).toEqual(before);
  });

  test('Implementation: the chooser searches by keyword', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.addConnector('crm', CRM_CONNECTOR);
      await a.createShape({ type: 'serviceTask', id: 'svc' });
    }, 'svc');
    await page.getByTestId('template.info.choose').click();
    await popup(page).locator('input').first().pressSequentially('delete');
    await expect(popupEntry(page, 'crm.DELETE')).toBeVisible();
    await expect(popupEntry(page, 'crm.LOOKUP')).toHaveCount(0);
  });

  test('Implementation: a built-in template sets its implementation and shows its fields', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc' })), 'svc');
    await page.getByTestId('template.info.choose').click();
    await popupEntry(page, 'builtin/mail').click();
    const xml = await bpmn(api);
    expect(xml).toContain('activiti:type="mail"');
    expect(xml).toContain('activiti:templateId="builtin/mail"');
    await expect(page.locator('[data-group-id="group-mail"]')).toBeVisible();
  });

  test('Implementation: the replace menu of a task has "Apply template..." and turns an abstract task into a service task', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addConnector('crm', CRM_CONNECTOR);
      await a.createShape({ type: 'task', id: 'plain', name: 'Check' });
    }, 'plain');
    await api.select();
    await activePanel(page).locator('.djs-element[data-element-id="plain"] .djs-hit').click();
    await activePanel(page).locator('.djs-context-pad [data-action="replace"]').click();
    await page.locator('.djs-popup [data-id="apply-template"]').click();
    await popupEntry(page, 'crm.LOOKUP').click();
    const xml = await bpmn(api);
    expect(xml).toMatch(/<bpmn:serviceTask id="plain" name="Check" implementation="crm.LOOKUP"/);
    await api.undo();
    expect(await bpmn(api)).toContain('<bpmn:task id="plain"');
  });

  test('Implementation: the context pad appends a task from a template after any flow node', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addConnector('crm', CRM_CONNECTOR);
      await a.createShape({ type: 'startEvent', id: 'begin' });
    }, 'begin');
    await api.select();
    await activePanel(page).locator('.djs-element[data-element-id="begin"] .djs-hit').click();
    await activePanel(page).locator('.djs-context-pad [data-action="append.template"]').click();
    await popupEntry(page, 'crm.LOOKUP').click();
    const xml = await bpmn(api);
    expect(xml).toContain('implementation="crm.LOOKUP"');
    expect(xml).toMatch(/sourceRef="begin"/);
    const ids = await api.elementIds();
    expect(ids.length).toBeGreaterThan(2);
    await api.undo();
    expect(await bpmn(api)).not.toContain('crm.LOOKUP');
  });

  test('Implementation: the shape of a task made from a template wears the template icon', async ({ page }) => {
    await openScene(page, plain, 'svc');
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    await expect(page.locator('.djs-element[data-element-id="svc"] .activiti-task-connector')).toHaveCount(1);
    await page.getByTestId('template.info.unlink').click();
    await expect(page.locator('.djs-element[data-element-id="svc"] .activiti-task-connector')).toHaveCount(0);
  });

  test('Implementation: unlinking keeps the task as it is and one undo links it again', async ({ page }) => {
    const api = await openScene(page, plain, 'svc');
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    const linked = await snapshot(api);
    await page.getByTestId('template.info.unlink').click();
    const xml = await bpmn(api);
    expect(xml).not.toContain('templateId');
    expect(xml).toContain('implementation="crm.LOOKUP"');
    expect((await processExtension(api)).mappings['svc']).toBeDefined();
    await expect(entry(page, 'template.info')).toContainText('not created from a template');
    await api.undo();
    expect(await snapshot(api)).toEqual(linked);
  });

  test('Implementation: a template whose connector has a new version is reported and updating adds the new parameters', async ({ page }) => {
    const api = await openScene(page, plain, 'svc');
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    await expect(entry(page, 'template.info')).toContainText('(version 1)');
    const crm = JSON.parse(CRM_CONNECTOR) as { version: string; actions: Record<string, { inputs: unknown[]; outputs: unknown[] }> };
    crm.version = '2';
    crm.actions['LOOKUP']!.inputs.push({ id: 'region', name: 'region', type: 'string' });
    crm.actions['LOOKUP']!.outputs.push({ id: 'score', name: 'score', type: 'integer' });
    await api.setConnector('crm', JSON.stringify(crm));
    await expect(entry(page, 'template.info')).toContainText('now at version 2');
    const outdated = await snapshot(api);
    await page.getByTestId('template.info.update').click();
    const xml = await bpmn(api);
    expect(xml).toContain('activiti:templateVersion="2"');
    const mapping = (await processExtension(api)).mappings['svc']!;
    expect(Object.keys(mapping['inputs'] as object)).toEqual(['customerId', 'region']);
    expect(Object.keys(mapping['outputs'] as object)).toEqual(['customerName', 'tier', 'found', 'score']);
    expect(await declared(api)).toEqual([['customerName', 'string'], ['tier', 'string'], ['found', 'boolean'], ['score', 'integer']]);
    await expect(entry(page, 'template.info')).toContainText('(version 2)');
    await api.undo();
    expect(await snapshot(api)).toEqual(outdated);
  });

  test('Implementation: a template whose connector was removed is reported and can be unlinked', async ({ page }) => {
    const api = await openScene(page, plain, 'svc');
    await pick(page, 'impl.connector.pick', 'crm.LOOKUP');
    await api.removeConnector('crm');
    await expect(entry(page, 'template.info')).toContainText('which the project no longer defines');
    await expect(page.getByTestId('template.info.update')).toHaveCount(0);
    await page.getByTestId('template.info.unlink').click();
    expect(await bpmn(api)).not.toContain('templateId');
  });

  test('Implementation: choosing a template over a Java class task replaces the class', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.addConnector('crm', CRM_CONNECTOR);
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'com.example.Old' } });
    }, 'svc');
    await page.getByTestId('template.info.choose').click();
    await popupEntry(page, 'crm.LOOKUP').click();
    const xml = await bpmn(api);
    expect(xml).toContain('implementation="crm.LOOKUP"');
    expect(xml).not.toContain('activiti:class');
    await api.undo();
    expect(await bpmn(api)).toContain('activiti:class="com.example.Old"');
  });
});
