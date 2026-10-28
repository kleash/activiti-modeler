import { expect, type Page } from '@playwright/test';

import { activePanel, idbFiles, openApp, selected, tab } from './support/app';
import { openProblems, problemIds } from './support/lint';
import { test } from './support/test';

/**
 * P3, D2, A1: the structure elements drawn the way a person draws them, with the palette, the context pad and the label editor (no test
 * API): two pools, two lanes from the context pad of a pool, a message flow between the pools, a data store reference connected to two
 * tasks by data associations, a text annotation on a task. The saved file has them where Activiti reads them, and the lint reports
 * nothing but the diagram warnings of the data references that the engine reports too (engine finding C18.2).
 */

test.use({ viewport: { width: 1600, height: 1000 } });
// one long scenario, about 60 canvas interactions: with 8 workers on a 6-core machine it takes about 40 s (every wait is for a state)
test.setTimeout(90_000);

const FILE = 'processes/process.bpmn20.xml';

const shape = (page: Page, id: string) => activePanel(page).locator(`.djs-element[data-element-id="${id}"]`);

async function box(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await shape(page, id).boundingBox();
  if (!found) throw new Error(`${id} is not on the canvas`);
  return found;
}

async function centre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = await box(page, id);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function selectedId(page: Page): Promise<string> {
  await expect(selected(page)).toHaveCount(1);
  return (await selected(page).getAttribute('data-element-id'))!;
}

/** A spot of the canvas outside the pools: a click there ends the label editing and clears the selection. */
async function blank(page: Page): Promise<{ x: number; y: number }> {
  const canvas = (await activePanel(page).locator('.djs-container').boundingBox())!;
  return { x: canvas.x + 150, y: canvas.y + canvas.height - 40 };
}

/** The label editor that opens on a new element: types the name and leaves the editor. */
async function name(page: Page, text: string): Promise<void> {
  const editor = activePanel(page).locator('.djs-direct-editing-content');
  await expect(editor).toBeVisible();
  await page.keyboard.type(text);
  const free = await blank(page);
  await page.mouse.click(free.x, free.y);
  await expect(editor).toBeHidden();
}

/**
 * Clears the selection with clicks on the empty canvas. Right after a drag in click mode (an element placed from the palette, a
 * connection drawn) diagram-js swallows the next click on the canvas, so the first click may be eaten; it eats one click at most, and two
 * clicks on two spots (not a double click) always end with nothing selected.
 */
async function clearSelection(page: Page): Promise<void> {
  const free = await blank(page);
  await page.mouse.click(free.x, free.y);
  await page.mouse.click(free.x + 40, free.y);
  await expect(selected(page)).toHaveCount(0);
}

/**
 * Selects an element with a click at a point of it (the centre, or the label band of a pool or lane). The selection is cleared first:
 * the context pad of a selected element can cover the point.
 */
async function select(page: Page, id: string, at?: { x: number; y: number }): Promise<void> {
  await clearSelection(page);
  const point = at ?? (await centre(page, id));
  await page.mouse.click(point.x, point.y);
  await expect(selected(page)).toHaveAttribute('data-element-id', id);
}

/** Creates an element from the palette at a point and returns its id; the label editor is open on it. */
async function create(page: Page, action: string, at: { x: number; y: number }): Promise<string> {
  await page.locator(`.djs-palette .entry[data-action="${action}"]`).click();
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
  return selectedId(page);
}

/** Runs an entry of the context pad of the selected element and returns the id of what is selected afterwards. */
async function pad(page: Page, action: string): Promise<string> {
  await activePanel(page).locator(`.djs-context-pad .entry[data-action="${action}"]`).click();
  return selectedId(page);
}

/** Draws a connection with the connect entry of the context pad (the modeling rules choose its type) and returns its id. */
async function connect(page: Page, source: string, target: string): Promise<string> {
  await select(page, source);
  await activePanel(page).locator('.djs-context-pad .entry[data-action="connect"]').click();
  const to = await centre(page, target);
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.click(to.x, to.y);
  // the new connection is selected
  await expect(selected(page)).not.toHaveAttribute('data-element-id', source);
  return selectedId(page);
}

/** The ids of the elements a lane of the XML lists, in order. */
function laneRefs(xml: string, laneId: string): string[] {
  const lane = new RegExp(`<bpmn:lane id="${laneId}"[^>]*>([\\s\\S]*?)</bpmn:lane>`).exec(xml)?.[1] ?? '';
  return [...lane.matchAll(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g)].map((m) => m[1]!);
}

/** The text of the element `<bpmn:<tag> id="<id>"...>...</bpmn:<tag>>` (or of the self-closing element). */
function elementXml(xml: string, tag: string, id: string): string {
  return new RegExp(`<bpmn:${tag} id="${id}"(?:[^>]*/>|[^>]*>[\\s\\S]*?</bpmn:${tag}>)`).exec(xml)?.[0] ?? '';
}

test('P3 D2 A1 pools, lanes from the context pad, a message flow, a data store with data associations and an annotation are saved where Activiti reads them, and the lint is clean', async ({ page }) => {
  await openApp(page);

  // --- the customer's pool, put around the start event of the new process, with two lanes from its context pad
  const start = await centre(page, 'StartEvent_1');
  const customer = await create(page, 'create.participant-expanded', { x: start.x + 100, y: start.y });
  await name(page, 'Customer');
  const customerBox = await box(page, customer);
  await select(page, customer, { x: customerBox.x + 12, y: customerBox.y + customerBox.height / 2 });
  await activePanel(page).locator('.djs-context-pad .entry[data-action="lane-insert-below"]').click();
  const lanes = activePanel(page).locator('.djs-element[data-element-id^="Lane_"]');
  await expect(lanes).toHaveCount(2);
  const [buyerLane, approverLane] = (await lanes.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-element-id')!, y: e.getBoundingClientRect().y }))))
    .sort((a, b) => a.y - b.y)
    .map((l) => l.id) as [string, string];
  for (const [lane, label] of [[buyerLane, 'Buyer'], [approverLane, 'Approver']] as const) {
    const laneBox = await box(page, lane);
    await select(page, lane, { x: laneBox.x + 12, y: laneBox.y + laneBox.height / 2 });
    await page.keyboard.press('e');
    await name(page, label);
  }

  // the flow of the customer: the start event and a task in the first lane, a task and the end event in the second
  await select(page, 'StartEvent_1');
  await page.keyboard.press('e');
  await name(page, 'Item needed');
  await select(page, 'StartEvent_1');
  const placeOrder = await pad(page, 'append.append-task');
  await name(page, 'Place order');
  const placeBox = await box(page, placeOrder);
  const approverBox = await box(page, approverLane);
  const approve = await create(page, 'create.task', { x: placeBox.x + placeBox.width / 2 + 160, y: approverBox.y + approverBox.height / 2 });
  await name(page, 'Approve delivery');
  const placeToApprove = await connect(page, placeOrder, approve);
  await select(page, approve);
  const customerEnd = await pad(page, 'append.end-event');
  await name(page, 'Delivery approved');

  // a data store reference in the first lane, written by the first task and read by the second
  const store = await create(page, 'create.data-store', { x: placeBox.x + placeBox.width + 70, y: placeBox.y - 20 });
  // (the label editor opens by itself on new activities, events, pools and annotations only; E needs the focus on the canvas)
  await select(page, store);
  await page.keyboard.press('e');
  await name(page, 'Orders');
  const written = await connect(page, placeOrder, store);
  const read = await connect(page, store, approve);

  // --- the supplier's pool above it, with its own process
  const supplier = await create(page, 'create.participant-expanded', { x: customerBox.x + customerBox.width / 2, y: customerBox.y - 150 });
  await name(page, 'Supplier');
  const supplierBox = await box(page, supplier);
  const supplierStart = await create(page, 'create.start-event', { x: supplierBox.x + 110, y: supplierBox.y + supplierBox.height / 2 });
  await name(page, 'Order arrives');
  await select(page, supplierStart);
  const confirm = await pad(page, 'append.append-task');
  await name(page, 'Confirm the order');
  await select(page, confirm);
  const supplierEnd = await pad(page, 'append.end-event');
  await name(page, 'Order confirmed');

  // a message flow from the customer's task to the supplier's task, and an annotation on the supplier's task
  const order = await connect(page, placeOrder, confirm);
  await select(page, confirm);
  const note = await pad(page, 'append.text-annotation');
  await name(page, 'Confirmed within a day');

  // --- the saved file
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  const xml = (await idbFiles(page))[FILE]!;
  const collaboration = /<bpmn:collaboration\b[\s\S]*?<\/bpmn:collaboration>/.exec(xml)![0];
  const customerProcess = new RegExp(`<bpmn:participant id="${customer}" name="Customer" processRef="([^"]+)"`).exec(collaboration)![1]!;
  const supplierProcess = new RegExp(`<bpmn:participant id="${supplier}" name="Supplier" processRef="([^"]+)"`).exec(collaboration)![1]!;
  expect(customerProcess).toBe('Process_1');
  expect(supplierProcess).not.toBe(customerProcess);
  const processOf = (id: string): string => new RegExp(`<bpmn:process id="${id}"[\\s\\S]*?</bpmn:process>`).exec(xml)![0];
  const customerXml = processOf(customerProcess);
  const supplierXml = processOf(supplierProcess);
  // both pools run: each process is executable
  expect(customerXml).toMatch(/^<bpmn:process id="Process_1" isExecutable="true">/);
  expect(supplierXml).toMatch(new RegExp(`^<bpmn:process id="${supplierProcess}" isExecutable="true">`));

  // P3: the lanes and the elements they hold, the message flow between the pools
  expect(customerXml).toMatch(new RegExp(`<bpmn:lane id="${buyerLane}" name="Buyer">`));
  expect(customerXml).toMatch(new RegExp(`<bpmn:lane id="${approverLane}" name="Approver">`));
  expect(laneRefs(customerXml, buyerLane)).toEqual(['StartEvent_1', placeOrder]);
  expect(laneRefs(customerXml, approverLane)).toEqual([approve, customerEnd]);
  expect(supplierXml).not.toContain('<bpmn:laneSet');
  expect(collaboration).toMatch(new RegExp(`<bpmn:messageFlow id="${order}" sourceRef="${placeOrder}" targetRef="${confirm}" />`));
  expect(customerXml + supplierXml).not.toContain('messageFlow');
  expect(customerXml).toMatch(new RegExp(`<bpmn:sequenceFlow id="${placeToApprove}" sourceRef="${placeOrder}" targetRef="${approve}" />`));
  for (const [process, from, to] of [[customerXml, 'StartEvent_1', placeOrder], [customerXml, approve, customerEnd], [supplierXml, supplierStart, confirm], [supplierXml, confirm, supplierEnd]] as const) {
    expect(process).toMatch(new RegExp(`<bpmn:sequenceFlow id="[^"]+" sourceRef="${from}" targetRef="${to}" />`));
  }

  // D2: the data store reference in the customer's process, a data output association of the first task and a data input association of the second
  expect(customerXml).toMatch(new RegExp(`<bpmn:dataStoreReference id="${store}" name="Orders" />`));
  expect(elementXml(customerXml, 'task', placeOrder)).toMatch(new RegExp(`<bpmn:dataOutputAssociation id="${written}">\\s*<bpmn:targetRef>${store}</bpmn:targetRef>\\s*</bpmn:dataOutputAssociation>`));
  expect(elementXml(customerXml, 'task', approve)).toMatch(new RegExp(`<bpmn:dataInputAssociation id="${read}">\\s*<bpmn:sourceRef>${store}</bpmn:sourceRef>`));

  // A1: the annotation and its association are in the supplier's process, where Activiti reads them (engine finding C18.7), not in the collaboration
  expect(supplierXml).toMatch(new RegExp(`<bpmn:textAnnotation id="${note}">\\s*<bpmn:text>Confirmed within a day</bpmn:text>\\s*</bpmn:textAnnotation>`));
  expect(supplierXml).toMatch(new RegExp(`<bpmn:association id="[^"]+" associationDirection="None" sourceRef="${confirm}" targetRef="${note}" />`));
  expect(collaboration).not.toMatch(/textAnnotation|<bpmn:association/);
  // the artifacts come after the flow elements of the process (engine finding C18.1)
  expect(supplierXml.indexOf('<bpmn:textAnnotation')).toBeGreaterThan(supplierXml.lastIndexOf('<bpmn:sequenceFlow'));

  // --- the lint: no error, and no warning but the diagram warnings of the data references that the engine reports as well
  await openProblems(page);
  await expect.poll(() => problemIds(page, FILE)).toEqual(
    [`activiti/di-does-not-reference-flownode@${store}`, `activiti/di-invalid-reference@${read}`, `activiti/di-invalid-reference@${written}`].sort(),
  );
});
