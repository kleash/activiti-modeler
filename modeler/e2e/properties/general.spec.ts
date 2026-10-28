import { bpmn, entry, expect, expectUndoRestores, extensions, messageOf, openScene, test, type, valueOf } from './support';

test.describe('General', () => {
  test('General: name of a task', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'userTask', id: 'u', name: 'Review' })), 'u');
    const before = await bpmn(api);
    await type(page, 'general.name', 'Approve the loan');
    expect(await bpmn(api)).toContain('<bpmn:userTask id="u" name="Approve the loan"');
    await expectUndoRestores(api, before);
    expect(await valueOf(page, 'general.name')).toBe('Review');
  });

  test('General: the panel shows the element selected last, also when the model changes before the panel is drawn again', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'a' });
      await a.createShape({ type: 'userTask', id: 'b' });
    }, 'a');
    expect(await valueOf(page, 'general.id')).toBe('a');
    // in one task: select b, then a change of a (a lint result, a catalog change or a command lands there on a busy machine)
    await page.evaluate(() => {
      const api = (window as unknown as { __modelerTestApi: { select(id: string): void; setProperty(id: string, key: string, value: unknown): void } }).__modelerTestApi;
      api.select('b');
      api.setProperty('a', 'general.name', 'Changed');
    });
    await expect(entry(page, 'general.id').locator('input')).toHaveValue('b');
  });

  test('General: name of the process', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'general.name', 'Loan approval');
    expect(await bpmn(api)).toContain('<bpmn:process id="p" name="Loan approval"');
    await expectUndoRestores(api, before);
  });

  test('General: ID renames the element, the flows that point at it and its entry of the extensions file', async ({ page }) => {
    const api = await openScene(
      page,
      async (a) => {
        await a.createShape({ type: 'startEvent', id: 'start' });
        await a.createShape({ type: 'userTask', id: 'u' });
        await a.connect('start', 'u', 'f');
        await a.setExtensions({ elementId: 'u', constants: { limit: 3 } });
      },
      'u',
    );
    const before = await bpmn(api);
    const jsonBefore = JSON.stringify(await extensions(api));
    await type(page, 'general.id', 'review');
    const xml = await bpmn(api);
    expect(xml).toContain('<bpmn:userTask id="review"');
    expect(xml).toContain('targetRef="review"');
    expect(JSON.stringify(await extensions(api))).toContain('"review"');
    await expectUndoRestores(api, before);
    expect(JSON.stringify(await extensions(api))).toBe(jsonBefore);
  });

  test('General: ID that is not a valid NCName is refused with a message and writes nothing', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'userTask', id: 'u' })), 'u');
    const before = await bpmn(api);
    await type(page, 'general.id', 'review task');
    await expect(messageOf(page, 'general.id')).toContainText('cannot contain spaces');
    await type(page, 'general.id', '1st');
    await expect(messageOf(page, 'general.id')).toContainText('must start with a letter');
    expect(await bpmn(api)).toBe(before);
  });

  test('General: ID that another element uses is refused with the accessor message', async ({ page }) => {
    const api = await openScene(
      page,
      async (a) => {
        await a.createShape({ type: 'userTask', id: 'u' });
        await a.createShape({ type: 'userTask', id: 'other' });
      },
      'u',
    );
    const before = await bpmn(api);
    await type(page, 'general.id', 'other');
    await expect(messageOf(page, 'general.id')).toContainText('already used');
    expect(await bpmn(api)).toBe(before);
  });

  test('General: ID of the process is the key of the process definition and of its extensions', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.setExtensions({ properties: [{ name: 'amount', type: 'integer' }] })));
    const before = await bpmn(api);
    await type(page, 'general.id', 'loanApproval');
    expect(await bpmn(api)).toContain('<bpmn:process id="loanApproval"');
    expect(JSON.stringify(await extensions(api))).toContain('"loanApproval"');
    await expectUndoRestores(api, before);
  });

  test('General: executable is checked and cannot be switched off', async ({ page }) => {
    const api = await openScene(page);
    const box = entry(page, 'general.executable').locator('input[type=checkbox]');
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
    expect(await bpmn(api)).toContain('isExecutable="true"');
  });

  test('General: target namespace of the definitions', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'general.targetNamespace', 'http://example.org/loans');
    expect(await bpmn(api)).toContain('targetNamespace="http://example.org/loans"');
    await expectUndoRestores(api, before);
  });

  test('General: target namespace longer than 255 characters is refused', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'general.targetNamespace', `http://example.org/${'x'.repeat(260)}`);
    await expect(messageOf(page, 'general.targetNamespace')).toContainText('at most 255');
    expect(await bpmn(api)).toBe(before);
  });
});

test.describe('Documentation', () => {
  test('Documentation: text of a task', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'userTask', id: 'u' })), 'u');
    const before = await bpmn(api);
    await type(page, 'documentation.text', 'Please review the loan.');
    expect(await bpmn(api)).toMatch(/<bpmn:documentation>Please review the loan\.<\/bpmn:documentation>/);
    await expectUndoRestores(api, before);
  });

  test('Documentation: text of the process counts the characters and refuses more than 2000', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'documentation.text', 'Short description');
    expect(await bpmn(api)).toContain('<bpmn:documentation>Short description</bpmn:documentation>');
    await expect(entry(page, 'documentation.text')).toContainText('17 of 2000 characters');
    await type(page, 'documentation.text', 'x'.repeat(2001));
    await expect(messageOf(page, 'documentation.text')).toContainText('at most 2000');
    expect(await bpmn(api)).toContain('<bpmn:documentation>Short description</bpmn:documentation>');
    await api.undo();
    expect(await bpmn(api)).not.toContain('documentation');
    void before;
  });

  test('Documentation: clearing the text removes the documentation element', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'documentation.text', 'Old');
    }, 'u');
    const before = await bpmn(api);
    await type(page, 'documentation.text', '');
    expect(await bpmn(api)).not.toContain('documentation');
    await expectUndoRestores(api, before);
  });
});

test.describe('Candidate starters', () => {
  test('Candidate starters: users', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'starters.users', 'ann, bob');
    expect(await bpmn(api)).toContain('activiti:candidateStarterUsers="ann, bob"');
    await expectUndoRestores(api, before);
  });

  test('Candidate starters: groups', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'starters.groups', 'clerks');
    expect(await bpmn(api)).toContain('activiti:candidateStarterGroups="clerks"');
    await expectUndoRestores(api, before);
  });

  test('Candidate starters: potential starter expression', async ({ page }) => {
    const api = await openScene(page);
    const before = await bpmn(api);
    await type(page, 'starters.potential', 'user(ann), group(clerks)');
    expect(await bpmn(api)).toMatch(/<activiti:potentialStarter>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(ann\), group\(clerks\)<\/bpmn:formalExpression>/);
    await expectUndoRestores(api, before);
  });
});

