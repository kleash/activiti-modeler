import { addRow, bpmn, entry, expect, expectUndoRestores, messageOf, openScene, test, type, typeCase, userTask, valueOf } from './support';

test.describe('User assignment', () => {
  const simple: Array<[string, string, string, string]> = [
    ['assignee', 'user.assignee', 'ann', 'activiti:assignee="ann"'],
    ['assignee from an expression', 'user.assignee', '${initiator}', 'activiti:assignee="${initiator}"'],
    ['owner', 'user.owner', 'bob', 'activiti:owner="bob"'],
    ['candidate users', 'user.candidateUsers', 'ann, bob', 'activiti:candidateUsers="ann, bob"'],
    ['candidate users from an expression', 'user.candidateUsers', '${approvers}', 'activiti:candidateUsers="${approvers}"'],
    ['candidate groups', 'user.candidateGroups', 'reviewers, clerks', 'activiti:candidateGroups="reviewers, clerks"'],
    ['due date as a duration', 'user.dueDate', 'P2D', 'activiti:dueDate="P2D"'],
    ['due date as a date', 'user.dueDate', '2030-02-01T12:30:00Z', 'activiti:dueDate="2030-02-01T12:30:00Z"'],
    ['priority', 'user.priority', '80', 'activiti:priority="80"'],
    ['priority from an expression', 'user.priority', '${urgency}', 'activiti:priority="${urgency}"'],
    ['category', 'user.category', 'credit', 'activiti:category="credit"'],
    ['business calendar', 'user.businessCalendarName', 'duration', 'activiti:businessCalendarName="duration"'],
  ];
  for (const [name, id, value, xml] of simple) typeCase({ title: `User assignment: ${name}`, scene: userTask, select: 'u', id, value, xml: [xml] });

  typeCase({
    title: 'User assignment: human performer (standard BPMN)',
    scene: userTask,
    select: 'u',
    id: 'user.humanPerformer',
    value: 'carl',
    xml: [/<bpmn:humanPerformer>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>carl<\/bpmn:formalExpression>/],
  });

  typeCase({
    title: 'User assignment: potential owner (standard BPMN)',
    scene: userTask,
    select: 'u',
    id: 'user.potentialOwner',
    value: 'user(ann), user(carl), group(reviewers)',
    xml: [/<bpmn:potentialOwner>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(ann\), user\(carl\), group\(reviewers\)<\/bpmn:formalExpression>/],
  });

  test('User assignment: custom identity link (customResource)', async ({ page }) => {
    const api = await openScene(page, userTask, 'u');
    const before = await bpmn(api);
    await addRow(page, 'user.customResource');
    // a row without its users stays in the panel and is not written
    await type(page, 'user.customResource[0].name', 'supervisor');
    expect(await bpmn(api)).not.toContain('customResource');
    await type(page, 'user.customResource[0].expression', 'user(dave), group(managers)');
    expect(await bpmn(api)).toMatch(/<activiti:customResource name="supervisor">\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(dave\), group\(managers\)<\/bpmn:formalExpression>/);
    await expectUndoRestores(api, before);
    // the panel shows what the model has again
    await expect(entry(page, 'user.customResource[0].name')).toHaveCount(0);
  });

  test('User assignment: a custom identity link is removed with its button', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'user.customResource', [{ name: 'supervisor', expression: 'user(dave)' }]);
    }, 'u');
    const before = await bpmn(api);
    await entry(page, 'user.customResource[0]').getByRole('button', { name: 'Remove' }).click();
    expect(await bpmn(api)).not.toContain('customResource');
    await expectUndoRestores(api, before);
  });

  test('User assignment: invalid priority and due date are refused with a message and written nowhere', async ({ page }) => {
    const api = await openScene(page, userTask, 'u');
    const before = await bpmn(api);
    await type(page, 'user.priority', 'high');
    await expect(messageOf(page, 'user.priority')).toContainText('whole number');
    await type(page, 'user.dueDate', 'tomorrow');
    await expect(messageOf(page, 'user.dueDate')).toContainText('Not an ISO 8601');
    expect(await bpmn(api)).toBe(before);
  });

  test('User assignment: a bare name in a potential owner is read as a group, and the panel says so', async ({ page }) => {
    await openScene(page, userTask, 'u');
    await type(page, 'user.potentialOwner', 'reviewers');
    await expect(messageOf(page, 'user.potentialOwner')).toContainText('read as a group');
  });

  test('User assignment: an expression with a syntax error is refused', async ({ page }) => {
    const api = await openScene(page, userTask, 'u');
    const before = await bpmn(api);
    await type(page, 'user.assignee', '${starter');
    await expect(messageOf(page, 'user.assignee')).toContainText('never closed');
    expect(await bpmn(api)).toBe(before);
  });

  test('User assignment: the fields show the values the model has', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'user.assignee', 'ann');
      await a.setProperty('u', 'user.owner', 'bob');
      await a.setProperty('u', 'user.priority', '80');
    }, 'u');
    expect(await valueOf(page, 'user.assignee')).toBe('ann');
    expect(await valueOf(page, 'user.owner')).toBe('bob');
    expect(await valueOf(page, 'user.priority')).toBe('80');
  });
});

