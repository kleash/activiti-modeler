import { addRow, bpmn, check, checkCase, entry, expect, expectUndoRestores, messageOf, openScene, pick, pickCase, test, type, typeCase, valueOf, type Scene } from './support';

const catchTimer: Scene = async (a) => void (await a.createShape({ type: 'intermediateCatchEvent', id: 'timer', eventDefinition: 'timer' }));
const catchMessage: Scene = async (a) => void (await a.createShape({ type: 'intermediateCatchEvent', id: 'msg', eventDefinition: 'message' }));
const throwMessage: Scene = async (a) => void (await a.createShape({ type: 'intermediateThrowEvent', id: 'throwMsg', eventDefinition: 'message' }));
const catchSignal: Scene = async (a) => void (await a.createShape({ type: 'intermediateCatchEvent', id: 'sig', eventDefinition: 'signal' }));
const throwSignal: Scene = async (a) => void (await a.createShape({ type: 'intermediateThrowEvent', id: 'throwSig', eventDefinition: 'signal' }));
const errorEnd: Scene = async (a) => void (await a.createShape({ type: 'endEvent', id: 'errEnd', eventDefinition: 'error' }));

test.describe('Timer', () => {
  pickCase({ title: 'Timer: type date', scene: catchTimer, select: 'timer', id: 'timer.definition.type', value: 'date', xml: [] });

  test('Timer: duration', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    const before = await bpmn(api);
    await type(page, 'timer.definition.value', 'PT30M');
    expect(await bpmn(api)).toMatch(/<bpmn:timeDuration[^>]*>PT30M<\/bpmn:timeDuration>/);
    await expect(entry(page, 'timer.definition.preview')).toContainText('Fires once, 30 minutes after');
    await expectUndoRestores(api, before);
  });

  test('Timer: date', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    const before = await bpmn(api);
    await pick(page, 'timer.definition.type', 'date');
    await type(page, 'timer.definition.value', '2030-01-01T12:00:00Z');
    expect(await bpmn(api)).toMatch(/<bpmn:timeDate[^>]*>2030-01-01T12:00:00Z<\/bpmn:timeDate>/);
    await expect(entry(page, 'timer.definition.preview')).toContainText('Fires once on Tue, 1 Jan 2030, 12:00 UTC');
    await expectUndoRestores(api, before);
  });

  test('Timer: cycle as an ISO 8601 repeat, with an end date', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    const before = await bpmn(api);
    await pick(page, 'timer.definition.type', 'cycle');
    await type(page, 'timer.definition.value', 'R3/PT1H');
    expect(await bpmn(api)).toMatch(/<bpmn:timeCycle[^>]*>R3\/PT1H<\/bpmn:timeCycle>/);
    await type(page, 'timer.definition.endDate', '2030-01-01T11:30:00Z');
    expect(await bpmn(api)).toMatch(/<bpmn:timeCycle[^>]*activiti:endDate="2030-01-01T11:30:00Z"[^>]*>R3\/PT1H<\/bpmn:timeCycle>/);
    await expect(entry(page, 'timer.definition.preview')).toContainText('Repeats every 1 hour, 3 times, until Tue, 1 Jan 2030, 11:30 UTC');
    await expectUndoRestores(api, before);
  });

  test('Timer: cycle as a cron expression, with a human-readable preview', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    const before = await bpmn(api);
    await pick(page, 'timer.definition.type', 'cycle');
    await type(page, 'timer.definition.value', '0 0 12 * * ?');
    expect(await bpmn(api)).toMatch(/<bpmn:timeCycle[^>]*>0 0 12 \* \* \?<\/bpmn:timeCycle>/);
    await expect(entry(page, 'timer.definition.preview')).toContainText('At 12:00, every day.');
    await expectUndoRestores(api, before);
  });

  test('Timer: changing the type keeps the value and rewrites the definition', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await catchTimer(a);
      await a.setProperty('timer', 'timer.definition', { type: 'duration', value: 'PT10M' });
    }, 'timer');
    const before = await bpmn(api);
    await pick(page, 'timer.definition.type', 'cycle');
    const xml = await bpmn(api);
    expect(xml).toMatch(/<bpmn:timeCycle[^>]*>PT10M<\/bpmn:timeCycle>/);
    expect(xml).not.toContain('timeDuration');
    await expectUndoRestores(api, before);
  });

  test('Timer: invalid values are refused with a live message and written nowhere', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    const before = await bpmn(api);
    await type(page, 'timer.definition.value', '30 minutes');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('Not an ISO 8601 duration');
    await pick(page, 'timer.definition.type', 'date');
    await type(page, 'timer.definition.value', '2030-13-40');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('Month 13');
    await pick(page, 'timer.definition.type', 'cycle');
    await type(page, 'timer.definition.value', '0 0 12 * *');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('6 or 7 fields');
    await type(page, 'timer.definition.value', '0 0 12 * * *');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('Quartz needs "?"');
    await type(page, 'timer.definition.value', 'R3/PT1X');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('Not an ISO 8601 duration');
    expect(await bpmn(api)).toBe(before);
  });

  test('Timer: an expression is accepted and a broken expression refused', async ({ page }) => {
    const api = await openScene(page, catchTimer, 'timer');
    await type(page, 'timer.definition.value', '${reminderDelay}');
    expect(await bpmn(api)).toContain('${reminderDelay}');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('Evaluated when the process reaches the timer');
    await type(page, 'timer.definition.value', '${reminderDelay');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('never closed');
    expect(await bpmn(api)).toContain('${reminderDelay}');
  });

  test('Timer: an end date that is not a date-time is refused, and it needs a cycle first', async ({ page }) => {
    await openScene(page, async (a) => {
      await catchTimer(a);
      await a.setProperty('timer', 'timer.definition', { type: 'cycle', value: 'R3/PT1H' });
    }, 'timer');
    await type(page, 'timer.definition.endDate', 'soon');
    await expect(messageOf(page, 'timer.definition.endDate')).toContainText('Not an ISO 8601 date-time');
  });

  typeCase({
    title: 'Timer: business calendar',
    scene: async (a) => {
      await catchTimer(a);
      await a.setProperty('timer', 'timer.definition', { type: 'duration', value: 'PT30M' });
    },
    select: 'timer',
    id: 'timer.businessCalendarName',
    value: 'duration',
    xml: [/<bpmn:timerEventDefinition[^>]*activiti:businessCalendarName="duration"/],
  });

  test('Timer: a start event timer and a boundary timer show their own hints', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.createShape({ type: 'boundaryEvent', id: 'bt', eventDefinition: 'timer', attachedTo: 'u' });
      await a.setProperty('bt', 'timer.definition', { type: 'cycle', value: 'R3/PT1H' });
    }, 'bt');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('never repeats');
  });

  test('Timer: a cycle on an intermediate catch event fires only once, and the panel says so', async ({ page }) => {
    await openScene(page, async (a) => {
      await catchTimer(a);
      await a.setProperty('timer', 'timer.definition', { type: 'cycle', value: 'R3/PT1H' });
    }, 'timer');
    await expect(messageOf(page, 'timer.definition.value')).toContainText('fires only once');
  });

  test('Timer: a timer start event', async ({ page }) => {
    const api = await openScene(page, async (a) => void (await a.createShape({ type: 'startEvent', id: 'ts', eventDefinition: 'timer' })), 'ts');
    const before = await bpmn(api);
    await type(page, 'timer.definition.value', '2035-01-01T09:00:00Z');
    expect(await bpmn(api)).toMatch(/<bpmn:startEvent id="ts">[\s\S]*<bpmn:timeDate[^>]*>2035-01-01T09:00:00Z/);
    await expectUndoRestores(api, before);
  });
});

test.describe('Message / Signal / Error / Link / Compensation / Terminate', () => {
  // --- message
  test('Message / Signal / Error / Link / Compensation / Terminate: message picked from the declared messages', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await catchMessage(a);
      await a.setProperty('p', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }]);
    }, 'msg');
    const before = await bpmn(api);
    await pick(page, 'message.ref', 'approveOrder');
    expect(await bpmn(api)).toContain('messageRef="approveMessage"');
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: a new message is created from the event and registered at definitions level', async ({ page }) => {
    const api = await openScene(page, catchMessage, 'msg');
    const before = await bpmn(api);
    await pick(page, 'message.ref', '__new__');
    const xml = await bpmn(api);
    expect(xml).toMatch(/<bpmn:message id="Message_\w+" name="newMessage" \/>/);
    expect(xml).toMatch(/messageRef="Message_\w+"/);
    expect(await valueOf(page, 'message.ref')).toBe('newMessage');
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: message renamed from the event for every event that uses it', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await catchMessage(a);
      await a.setProperty('p', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }]);
      await a.setProperty('msg', 'message.ref', 'approveOrder');
    }, 'msg');
    const before = await bpmn(api);
    await type(page, 'message.ref.name', 'orderApproved');
    expect(await bpmn(api)).toContain('<bpmn:message id="approveMessage" name="orderApproved" />');
    await expectUndoRestores(api, before);
  });

  typeCase({ title: 'Message / Signal / Error / Link / Compensation / Terminate: message expression', scene: catchMessage, select: 'msg', id: 'message.expression', value: '${messageName}', xml: ['activiti:messageExpression="${messageName}"'] });
  typeCase({ title: 'Message / Signal / Error / Link / Compensation / Terminate: message correlation key', scene: catchMessage, select: 'msg', id: 'message.correlationKey', value: '${orderId}', xml: ['activiti:correlationKey="${orderId}"'] });
  typeCase({ title: 'Message / Signal / Error / Link / Compensation / Terminate: throw-message delegate class', scene: throwMessage, select: 'throwMsg', id: 'message.class', value: 'com.example.SendOrderMessage', xml: [/<bpmn:messageEventDefinition[^>]*activiti:class="com.example.SendOrderMessage"/] });
  typeCase({ title: 'Message / Signal / Error / Link / Compensation / Terminate: throw-message delegate expression', scene: throwMessage, select: 'throwMsg', id: 'message.delegateExpression', value: '${throwMessageDelegate}', xml: [/<bpmn:messageEventDefinition[^>]*activiti:delegateExpression="\$\{throwMessageDelegate\}"/] });

  test('Message / Signal / Error / Link / Compensation / Terminate: a message throw event without a delegate carries the warning, and the payload fields the note that they are never injected', async ({ page }) => {
    const api = await openScene(page, throwMessage, 'throwMsg');
    await expect(entry(page, 'message.delegate.hint')).toContainText('needs a delegate');
    const before = await bpmn(api);
    await addRow(page, 'message.fields');
    await type(page, 'message.fields[0].name', 'tag');
    await type(page, 'message.fields[0].value', 'tagged');
    expect(await bpmn(api)).toMatch(/<bpmn:messageEventDefinition[^>]*>\s*<bpmn:extensionElements>\s*<activiti:field name="tag">\s*<activiti:string>tagged/);
    await expect(entry(page, 'message.fields.hint')).toContainText('never injected');
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: a catch event has no throw delegate fields', async ({ page }) => {
    await openScene(page, catchMessage, 'msg');
    await expect(entry(page, 'message.class')).toHaveCount(0);
  });

  // --- signal
  test('Message / Signal / Error / Link / Compensation / Terminate: signal picked from the declared signals', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await catchSignal(a);
      await a.setProperty('p', 'definitions.signals', [{ id: 'stockSignal', name: 'stockLow' }]);
    }, 'sig');
    const before = await bpmn(api);
    await pick(page, 'signal.ref', 'stockLow');
    expect(await bpmn(api)).toContain('signalRef="stockSignal"');
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: a new signal is created from the event and renamed', async ({ page }) => {
    const api = await openScene(page, catchSignal, 'sig');
    const before = await bpmn(api);
    await pick(page, 'signal.ref', '__new__');
    expect(await bpmn(api)).toMatch(/<bpmn:signal id="Signal_\w+" name="newSignal" \/>/);
    await type(page, 'signal.ref.name', 'inventoryLow');
    expect(await bpmn(api)).toMatch(/<bpmn:signal id="Signal_\w+" name="inventoryLow" \/>/);
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: signal scope', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await catchSignal(a);
      await a.setProperty('sig', 'signal.ref', 'stockLow');
    }, 'sig');
    const before = await bpmn(api);
    await pick(page, 'signal.scope', 'processInstance');
    expect(await bpmn(api)).toMatch(/<bpmn:signal [^>]*activiti:scope="processInstance"/);
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: signal expression, with the trap of a file that declares signals', async ({ page }) => {
    const api = await openScene(page, catchSignal, 'sig');
    const before = await bpmn(api);
    await type(page, 'signal.expression', "${'go-'.concat(region)}");
    expect(await bpmn(api)).toContain('activiti:signalExpression="${&#39;go-&#39;.concat(region)}"');
    await expect(entry(page, 'signal.expression.leak.hint')).toContainText('keeps its subscription');
    await expectUndoRestores(api, before);
    // declaring a signal in the same file makes the engine fail to parse the expression-named event
    await api.setProperty('p', 'definitions.signals', [{ name: 'other' }]);
    await api.setProperty('sig', 'signal.expression', '${x}');
    await api.select('sig');
    await expect(entry(page, 'signal.expression.parse.hint')).toContainText('fails to parse');
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: asynchronous signal throw', async ({ page }) => {
    const api = await openScene(page, throwSignal, 'throwSig');
    const before = await bpmn(api);
    await check(page, 'signal.async');
    expect(await bpmn(api)).toMatch(/<bpmn:signalEventDefinition[^>]*activiti:async="true"/);
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: a signal catch event has no asynchronous flag', async ({ page }) => {
    await openScene(page, catchSignal, 'sig');
    await expect(entry(page, 'signal.async')).toHaveCount(0);
  });

  // --- error
  test('Message / Signal / Error / Link / Compensation / Terminate: error picked by its error code', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await errorEnd(a);
      await a.setProperty('p', 'definitions.errors', [{ id: 'guardError', name: 'Guard error', errorCode: 'GUARD' }]);
    }, 'errEnd');
    const before = await bpmn(api);
    await pick(page, 'error.ref', 'GUARD');
    expect(await bpmn(api)).toContain('errorRef="guardError"');
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: a new error is created from the event and its code renamed', async ({ page }) => {
    const api = await openScene(page, errorEnd, 'errEnd');
    const before = await bpmn(api);
    await pick(page, 'error.ref', '__new__');
    expect(await bpmn(api)).toMatch(/<bpmn:error id="Error_\w+" name="ERROR_CODE" errorCode="ERROR_CODE" \/>/);
    await type(page, 'error.ref.code', 'PAYMENT_FAILED');
    expect(await bpmn(api)).toMatch(/errorCode="PAYMENT_FAILED"/);
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: an error boundary event without an error catches every error', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.createShape({ type: 'boundaryEvent', id: 'be', eventDefinition: 'error', attachedTo: 'u' });
    }, 'be');
    expect(await entry(page, 'error.ref').locator('option').first().innerText()).toBe('(none: catches every error)');
    await expect(entry(page, 'error.boundary.hint')).toContainText('always interrupts');
  });

  // --- link
  typeCase({
    title: 'Message / Signal / Error / Link / Compensation / Terminate: link name',
    scene: async (a) => void (await a.createShape({ type: 'intermediateThrowEvent', id: 'jump', eventDefinition: 'link' })),
    select: 'jump',
    id: 'link.name',
    value: 'toReview',
    xml: [/<bpmn:linkEventDefinition[^>]* name="toReview"/],
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: link target chosen from the link catch events, and the catch event lists its sources', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'intermediateCatchEvent', id: 'land', name: 'Landing', eventDefinition: 'link' });
      await a.createShape({ type: 'intermediateThrowEvent', id: 'jump', eventDefinition: 'link' });
    }, 'jump');
    const before = await bpmn(api);
    await pick(page, 'link.target', 'land');
    const xml = await bpmn(api);
    expect(xml).toMatch(/<bpmn:target>LinkEventDefinition_\w+<\/bpmn:target>/);
    expect(xml).toMatch(/<bpmn:source>LinkEventDefinition_\w+<\/bpmn:source>/);
    await api.select('land');
    await expect(entry(page, 'link.sources.info')).toContainText('Reached from: jump');
    await api.select('jump');
    await expectUndoRestores(api, before);
  });

  // --- compensation
  test('Message / Signal / Error / Link / Compensation / Terminate: activity to compensate offers the handlers first', async ({ page }) => {
    const api = await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'book' });
      await a.createShape({ type: 'serviceTask', id: 'cancelBook', attrs: { isForCompensation: true } });
      await a.createShape({ type: 'intermediateThrowEvent', id: 'throwComp', eventDefinition: 'compensate' });
    }, 'throwComp');
    const before = await bpmn(api);
    const options = await entry(page, 'compensate.activityRef').locator('option').allInnerTexts();
    expect(options[0]).toBe('(everything completed in this scope)');
    expect(options[1]).toContain('cancelBook');
    await pick(page, 'compensate.activityRef', 'cancelBook');
    expect(await bpmn(api)).toMatch(/<bpmn:compensateEventDefinition[^>]*activityRef="cancelBook"/);
    await expectUndoRestores(api, before);
  });

  test('Message / Signal / Error / Link / Compensation / Terminate: naming a compensated task that has a compensation boundary event is flagged', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'book' });
      await a.createShape({ type: 'boundaryEvent', id: 'comp', eventDefinition: 'compensate', attachedTo: 'book' });
      await a.createShape({ type: 'intermediateThrowEvent', id: 'throwComp', eventDefinition: 'compensate' });
      await a.setProperty('throwComp', 'compensate.activityRef', 'book');
    }, 'throwComp');
    await expect(entry(page, 'compensate.target.hint')).toContainText('Name its handler instead');
  });

  checkCase({
    title: 'Message / Signal / Error / Link / Compensation / Terminate: compensation wait for completion',
    scene: async (a) => void (await a.createShape({ type: 'intermediateThrowEvent', id: 'throwComp', eventDefinition: 'compensate' })),
    select: 'throwComp',
    id: 'compensate.waitForCompletion',
    checked: false,
    xml: [/<bpmn:compensateEventDefinition[^>]*waitForCompletion="false"/],
  });

  // --- terminate
  checkCase({
    title: 'Message / Signal / Error / Link / Compensation / Terminate: terminate all',
    scene: async (a) => void (await a.createShape({ type: 'endEvent', id: 'term', eventDefinition: 'terminate' })),
    select: 'term',
    id: 'terminate.all',
    xml: [/<bpmn:terminateEventDefinition[^>]*activiti:terminateAll="true"/],
  });
  checkCase({
    title: 'Message / Signal / Error / Link / Compensation / Terminate: terminate multi-instance',
    scene: async (a) => void (await a.createShape({ type: 'endEvent', id: 'term', eventDefinition: 'terminate' })),
    select: 'term',
    id: 'terminate.multiInstance',
    xml: [/<bpmn:terminateEventDefinition[^>]*activiti:terminateMultiInstance="true"/],
  });
});
