import { addListItem, addRow, bpmn, clickIn, entry, reveal, expect, expectUndoRestores, messageOf, openScene, pick, test, type, userTask, valueOf, type Scene } from './support';

const task: Scene = userTask;
const process: Scene = async () => {};

/** Adds a listener to the group and returns the id prefix of its entries. */
async function addListener(page: Parameters<typeof addListItem>[0], group: string, key: string, index = 0): Promise<string> {
  await addListItem(page, group);
  return `${key}[${index}]`;
}

test.describe('Execution listeners', () => {
  test('Execution listeners: Java class on a task', async ({ page }) => {
    const api = await openScene(page, task, 'u');
    const before = await bpmn(api);
    const base = await addListener(page, 'executionListeners', 'listeners.execution');
    // a new listener is created with the type chosen and an empty class: the engine and lint report it until it is filled in
    expect(await bpmn(api)).toContain('<activiti:executionListener event="start" class="" />');
    await expect(messageOf(page, `${base}.class`)).toContainText('needs a class');
    await type(page, `${base}.class`, 'com.example.StartListener');
    expect(await bpmn(api)).toContain('<activiti:executionListener event="start" class="com.example.StartListener" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: event of a listener on a task (start or end)', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.execution', [{ event: 'start', class: 'a.B' }]);
    }, 'u');
    const before = await bpmn(api);
    await pick(page, 'listeners.execution[0].event', 'end');
    expect(await bpmn(api)).toContain('<activiti:executionListener event="end" class="a.B" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: expression', async ({ page }) => {
    const api = await openScene(page, task, 'u');
    const before = await bpmn(api);
    const base = await addListener(page, 'executionListeners', 'listeners.execution');
    await pick(page, `${base}.type`, 'expression');
    await type(page, `${base}.expression`, "${listenerRecorder.recordExecution(execution)}");
    expect(await bpmn(api)).toContain('<activiti:executionListener event="start" expression="${listenerRecorder.recordExecution(execution)}" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: delegate expression', async ({ page }) => {
    const api = await openScene(page, task, 'u');
    const before = await bpmn(api);
    const base = await addListener(page, 'executionListeners', 'listeners.execution');
    await pick(page, `${base}.type`, 'delegateExpression');
    await type(page, `${base}.delegateExpression`, '${recordingExecutionListener}');
    expect(await bpmn(api)).toContain('<activiti:executionListener event="start" delegateExpression="${recordingExecutionListener}" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: onTransaction on a delegate expression, with a custom properties resolver', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc' });
      await a.setProperty('svc', 'listeners.execution', [{ event: 'start', delegateExpression: '${beforeCommitExecutionListener}' }]);
    }, 'svc');
    const before = await bpmn(api);
    await pick(page, 'listeners.execution[0].onTransaction', 'before-commit');
    await pick(page, 'listeners.execution[0].resolverType', 'class');
    await type(page, 'listeners.execution[0].customPropertiesResolverClass', 'com.example.CorpusPropertiesResolver');
    expect(await bpmn(api)).toContain('<activiti:executionListener event="start" delegateExpression="${beforeCommitExecutionListener}" onTransaction="before-commit" customPropertiesResolverClass="com.example.CorpusPropertiesResolver" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: onTransaction cannot be combined with an expression', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.execution', [{ event: 'start', expression: '${x}' }]);
    }, 'u');
    const before = await bpmn(api);
    await pick(page, 'listeners.execution[0].onTransaction', 'committed');
    await expect(messageOf(page, 'listeners.execution[0].onTransaction')).toContainText('cannot be an expression');
    expect(await bpmn(api)).toBe(before);
  });

  test('Execution listeners: injected fields of a class listener', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.execution', [{ event: 'start', class: 'com.example.FieldListener' }]);
    }, 'u');
    const before = await bpmn(api);
    await addRow(page, 'listeners.execution[0].fields');
    await type(page, 'listeners.execution[0].fields[0].name', 'tag');
    await type(page, 'listeners.execution[0].fields[0].value', 'process');
    expect(await bpmn(api)).toMatch(/<activiti:executionListener event="start" class="com.example.FieldListener">\s*<activiti:field name="tag">\s*<activiti:string>process<\/activiti:string>/);
    await pick(page, 'listeners.execution[0].fields[0].kind', 'expression');
    expect(await bpmn(api)).toMatch(/<activiti:field name="tag">\s*<activiti:expression>process<\/activiti:expression>/);
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: order of listeners can be changed and a listener removed', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.execution', [{ event: 'start', class: 'a.First' }, { event: 'start', class: 'a.Second' }]);
    }, 'u');
    const before = await bpmn(api);
    await clickIn(page, 'listeners.execution[0].order', 'Move down');
    expect(await bpmn(api)).toMatch(/a\.Second[\s\S]*a\.First/);
    await clickIn(page, 'listeners.execution[0]', 'Delete item');
    expect(await bpmn(api)).not.toContain('a.Second');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: take listener of a sequence flow offers only the take event', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.createShape({ type: 'endEvent', id: 'end' });
      await a.connect('u', 'end', 'flow');
    }, 'flow');
    const before = await bpmn(api);
    const base = await addListener(page, 'executionListeners', 'listeners.execution');
    expect(await valueOf(page, `${base}.event`)).toBe('take');
    await type(page, `${base}.class`, 'com.example.TakeListener');
    expect(await bpmn(api)).toContain('<activiti:executionListener event="take" class="com.example.TakeListener" />');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: process start and end listeners, with the warning about variables in an end listener', async ({ page }) => {
    const api = await openScene(page, process);
    const before = await bpmn(api);
    const base = await addListener(page, 'executionListeners', 'listeners.execution');
    await pick(page, `${base}.event`, 'end');
    await pick(page, `${base}.type`, 'expression');
    await type(page, `${base}.expression`, "${execution.setVariable('done', true)}");
    expect(await bpmn(api)).toContain('<activiti:executionListener event="end" expression="${execution.setVariable(&#39;done&#39;, true)}" />');
    await expect(entry(page, `${base}.hint`)).toContainText('process instance execution was deleted');
    await expectUndoRestores(api, before);
  });

  test('Execution listeners: an exclusive gateway end listener is flagged as never called', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'exclusiveGateway', id: 'gw' });
      await a.setProperty('gw', 'listeners.execution', [{ event: 'end', class: 'a.B' }]);
    }, 'gw');
    await expect(entry(page, 'listeners.execution[0].hint')).toContainText('never calls its end listeners');
  });
});

test.describe('Task listeners', () => {
  const EVENTS = ['create', 'assignment', 'complete', 'delete', 'all'];
  for (const event of EVENTS) {
    test(`Task listeners: ${event} event`, async ({ page }) => {
      const api = await openScene(page, task, 'u');
      const before = await bpmn(api);
      const base = await addListener(page, 'taskListeners', 'listeners.task');
      await pick(page, `${base}.event`, event);
      await type(page, `${base}.class`, 'com.example.TaskListener');
      expect(await bpmn(api)).toContain(`<activiti:taskListener event="${event}" class="com.example.TaskListener" />`);
      await expectUndoRestores(api, before);
    });
  }

  test('Task listeners: expression and delegate expression', async ({ page }) => {
    const api = await openScene(page, task, 'u');
    const before = await bpmn(api);
    await addListItem(page, 'taskListeners');
    await pick(page, 'listeners.task[0].event', 'complete');
    await pick(page, 'listeners.task[0].type', 'expression');
    await type(page, 'listeners.task[0].expression', "${execution.setVariable('completedBy', task.assignee)}");
    await addListItem(page, 'taskListeners');
    await pick(page, 'listeners.task[1].type', 'delegateExpression');
    await type(page, 'listeners.task[1].delegateExpression', '${recordingTaskListener}');
    const xml = await bpmn(api);
    expect(xml).toContain('<activiti:taskListener event="complete" expression="${execution.setVariable(&#39;completedBy&#39;, task.assignee)}" />');
    expect(xml).toContain('<activiti:taskListener event="create" delegateExpression="${recordingTaskListener}" />');
    await expectUndoRestores(api, before);
  });

  test('Task listeners: onTransaction on a delegate expression only', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.task', [{ event: 'complete', delegateExpression: '${committedTaskListener}' }]);
    }, 'u');
    const before = await bpmn(api);
    await pick(page, 'listeners.task[0].onTransaction', 'committed');
    expect(await bpmn(api)).toContain('<activiti:taskListener event="complete" delegateExpression="${committedTaskListener}" onTransaction="committed" />');
    await pick(page, 'listeners.task[0].type', 'class');
    await expect(messageOf(page, 'listeners.task[0].onTransaction')).toContainText('TransactionDependentTaskListener');
    await api.undo();
    await expectUndoRestores(api, before);
  });

  test('Task listeners: fields with a text and an expression', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.task', [{ event: 'all', class: 'com.example.FieldTaskListener' }]);
    }, 'u');
    const before = await bpmn(api);
    await addRow(page, 'listeners.task[0].fields');
    await type(page, 'listeners.task[0].fields[0].name', 'tag');
    await pick(page, 'listeners.task[0].fields[0].kind', 'expression');
    await type(page, 'listeners.task[0].fields[0].value', '${customerId}');
    expect(await bpmn(api)).toMatch(/<activiti:field name="tag">\s*<activiti:expression>\$\{customerId\}<\/activiti:expression>/);
    await expectUndoRestores(api, before);
  });

  test('Task listeners: a field added to a new listener keeps the event and the class set before it', async ({ page }) => {
    const api = await openScene(page, task, 'u');
    const before = await bpmn(api);
    await addListItem(page, 'taskListeners');
    await pick(page, 'listeners.task[0].event', 'all');
    await type(page, 'listeners.task[0].class', 'com.example.FieldTaskListener');
    await addRow(page, 'listeners.task[0].fields');
    await type(page, 'listeners.task[0].fields[0].name', 'tag');
    await type(page, 'listeners.task[0].fields[0].value', 'any');
    expect(await bpmn(api)).toMatch(/<activiti:taskListener event="all" class="com\.example\.FieldTaskListener">\s*<activiti:field name="tag">\s*<activiti:string>any<\/activiti:string>/);
    await expectUndoRestores(api, before);
  });

  test('Task listeners: a delete listener comes with the note about cancellation', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.task', [{ event: 'delete', class: 'a.B' }]);
    }, 'u');
    await expect(entry(page, 'listeners.task[0].hint')).toContainText('also run when the task is cancelled');
  });
});

test.describe('Event listeners', () => {
  test('Event listeners: Java class with events typed and an entity type', async ({ page }) => {
    const api = await openScene(page, process);
    const before = await bpmn(api);
    await addListItem(page, 'eventListeners');
    await type(page, 'listeners.event[0].events', 'TASK_CREATED,TASK_COMPLETED');
    await pick(page, 'listeners.event[0].entityType', 'task');
    await type(page, 'listeners.event[0].class', 'com.example.RecordingEventListener');
    expect(await bpmn(api)).toContain('<activiti:eventListener events="TASK_CREATED,TASK_COMPLETED" entityType="task" class="com.example.RecordingEventListener" />');
    await expectUndoRestores(api, before);
  });

  test('Event listeners: events typed after the class keep the class', async ({ page }) => {
    const api = await openScene(page, process);
    await addListItem(page, 'eventListeners');
    await type(page, 'listeners.event[0].class', 'com.example.RecordingEventListener');
    await type(page, 'listeners.event[0].events', 'TASK_CREATED');
    expect(await bpmn(api)).toContain('<activiti:eventListener events="TASK_CREATED" class="com.example.RecordingEventListener" />');
  });

  test('Event listeners: events are picked from the list of the engine event types and unknown names are refused', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.setProperty('p', 'listeners.event', [{ class: 'a.B' }]);
    });
    const before = await bpmn(api);
    const item = await reveal(page, 'listeners.event[0].events');
    await item.locator('summary').click();
    await item.locator('input[data-event-type="PROCESS_STARTED"]').check();
    await item.locator('input[data-event-type="PROCESS_COMPLETED"]').check();
    expect(await bpmn(api)).toContain('events="PROCESS_STARTED,PROCESS_COMPLETED"');
    await type(page, 'listeners.event[0].events', 'PROCESS_STARTED,NOT_AN_EVENT');
    await expect(messageOf(page, 'listeners.event[0].events')).toContainText('Unknown event type: NOT_AN_EVENT');
    expect(await bpmn(api)).toContain('events="PROCESS_STARTED,PROCESS_COMPLETED"');
    await expectUndoRestores(api, before);
  });

  test('Event listeners: delegate expression', async ({ page }) => {
    const api = await openScene(page, process);
    const before = await bpmn(api);
    await addListItem(page, 'eventListeners');
    await pick(page, 'listeners.event[0].type', 'delegateExpression');
    await type(page, 'listeners.event[0].delegateExpression', '${recordingEventListener}');
    expect(await bpmn(api)).toContain('<activiti:eventListener delegateExpression="${recordingEventListener}" />');
    await expectUndoRestores(api, before);
  });

  const THROWS: Array<[string, string, string]> = [
    ['signal', 'signalName', 'taskDone'],
    ['globalSignal', 'signalName', 'taskDoneGlobal'],
    ['message', 'messageName', 'taskDoneMessage'],
    ['error', 'errorCode', 'GUARD'],
  ];
  for (const [kind, field, value] of THROWS) {
    test(`Event listeners: throw ${kind}`, async ({ page }) => {
      const api = await openScene(page, process);
      const before = await bpmn(api);
      await addListItem(page, 'eventListeners');
      await pick(page, 'listeners.event[0].type', `throw:${kind}`);
      await type(page, `listeners.event[0].${field}`, value);
      expect(await bpmn(api)).toContain(`throwEvent="${kind}" ${field}="${value}"`);
      await expectUndoRestores(api, before);
    });
  }

  test('Event listeners: a listener without a value is shown with its message and moved or removed', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.setProperty('p', 'listeners.event', [{ class: 'a.First' }, { class: 'a.Second' }]);
    });
    const before = await bpmn(api);
    await clickIn(page, 'listeners.event[1].order', 'Move up');
    expect(await bpmn(api)).toMatch(/a\.Second[\s\S]*a\.First/);
    await clickIn(page, 'listeners.event[0]', 'Delete item');
    expect(await bpmn(api)).not.toContain('a.Second');
    await expectUndoRestores(api, before);
  });
});

