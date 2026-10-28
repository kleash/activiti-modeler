import { addRow, bpmn, clickIn, entry, expect, expectUndoRestores, messageOf, openScene, pick, test, type, typeCase, userTask, valueOf } from './support';

const startEvent = async (a: Parameters<typeof openScene>[1] extends infer F ? (F extends (api: infer A) => unknown ? A : never) : never): Promise<void> => void (await a.createShape({ type: 'startEvent', id: 'start' }));

test.describe('Start initiator / form', () => {
  typeCase({ title: 'Start initiator / form: initiator variable', scene: startEvent, select: 'start', id: 'start.initiator', value: 'starter', xml: ['activiti:initiator="starter"'] });
  typeCase({ title: 'Start initiator / form: form key of a start event', scene: startEvent, select: 'start', id: 'form.key', value: 'startForm', xml: ['activiti:formKey="startForm"'] });

  test('Start initiator / form: the initiator shows the host-application note and refuses a name that is not a variable', async ({ page }) => {
    const api = await openScene(page, startEvent, 'start');
    await expect(entry(page, 'start.initiator.hint')).toContainText('Authentication.setAuthenticatedUserId');
    const before = await bpmn(api);
    await type(page, 'start.initiator', 'the starter');
    await expect(messageOf(page, 'start.initiator')).toContainText('plain identifier');
    expect(await bpmn(api)).toBe(before);
  });
});

test.describe('Form', () => {
  typeCase({ title: 'Form: form key of a user task', scene: userTask, select: 'u', id: 'form.key', value: 'reviewForm', xml: ['activiti:formKey="reviewForm"'] });
  typeCase({ title: 'Form: form key from an expression', scene: userTask, select: 'u', id: 'form.key', value: '${formName}', xml: ['activiti:formKey="${formName}"'] });

  test('Form: legacy form properties are edited as rows and marked "not executed by Activiti 9"', async ({ page }) => {
    const api = await openScene(page, userTask, 'u');
    await expect(page.locator('[data-group-id="group-form"]')).toContainText('not executed by Activiti 9');
    const before = await bpmn(api);
    await addRow(page, 'form.properties');
    // incomplete (no id yet): not written
    await type(page, 'form.properties[0].name', 'Customer');
    expect(await bpmn(api)).not.toContain('formProperty');
    await type(page, 'form.properties[0].id', 'customer');
    await pick(page, 'form.properties[0].type', 'string');
    await pick(page, 'form.properties[0].required', 'true');
    expect(await bpmn(api)).toContain('<activiti:formProperty id="customer" name="Customer" type="string" required="true" />');
    await api.undo();
    await api.undo();
    await api.undo();
    expect(await bpmn(api)).toBe(before);
  });

  test('Form: legacy form properties keep their enum values on a round trip', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'form.properties', [{ id: 'status', name: 'Status', type: 'enum', values: [{ id: 'open', name: 'Open' }, { id: 'done', name: 'Done' }] }]);
    }, 'u');
    expect(await valueOf(page, 'form.properties[0].values')).toBe('open=Open, done=Done');
    await type(page, 'form.properties[0].name', 'State');
    const xml = await bpmn(api);
    expect(xml).toMatch(/<activiti:formProperty id="status" name="State" type="enum">\s*<activiti:value id="open" name="Open" \/>\s*<activiti:value id="done" name="Done" \/>/);
  });

  test('Form: a form property can be moved and removed', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'form.properties', [{ id: 'a' }, { id: 'b' }]);
    }, 'u');
    const before = await bpmn(api);
    await clickIn(page, 'form.properties[0]', 'Move down');
    expect(await bpmn(api)).toMatch(/formProperty id="b"[\s\S]*formProperty id="a"/);
    await clickIn(page, 'form.properties[0]', 'Remove');
    expect(await bpmn(api)).not.toContain('formProperty id="b"');
    await expectUndoRestores(api, before);
  });

  test('Form: the start event keeps the legacy properties in the Form group and the form key in Start initiator / form', async ({ page }) => {
    await openScene(page, startEvent, 'start');
    await expect(page.locator('[data-group-id="group-startInitiator"] [data-entry-id="form.key"]')).toHaveCount(1);
    await expect(page.locator('[data-group-id="group-form"] [data-entry-id="form.properties"]')).toHaveCount(1);
    await expect(page.locator('[data-group-id="group-form"] [data-entry-id="form.key"]')).toHaveCount(0);
  });
});
