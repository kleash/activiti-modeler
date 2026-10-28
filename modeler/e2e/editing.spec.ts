import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, canvasScale, centreOf, element, menu, pasteAt, processXml, selected, shapeBox, tab } from './support/app';
import { ModelerApi } from './support/modelerApi';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const ROW = [
  { id: 'a', type: 'task', name: 'Review', x: 200, y: 100 },
  { id: 'b', type: 'task', name: 'Approve', x: 420, y: 160 },
  { id: 'c', type: 'task', name: 'Archive', x: 700, y: 80 },
];

async function load(page: Page, shapes = ROW, id = 'edit'): Promise<ModelerApi> {
  const api = await ModelerApi.open(page);
  await api.importXml(processXml(id, shapes));
  await expect(element(page, shapes[0]!.id)).toBeVisible();
  // room for the canvas: the side panels are not needed here (and toggling them is part of the test)
  await page.keyboard.press('Control+P');
  await menu(page, 'View', 'Project explorer');
  await expect(page.getByTestId('explorer')).toBeHidden();
  await focusCanvas(page);
  // actual size, so that screen pixels are diagram units
  await page.keyboard.press('Control+0');
  await settle(page);
  return api;
}

/** Waits until the layout is final: both side panels are hidden (they have no transition) and the canvas shows the diagram at 100 %. */
async function settle(page: Page): Promise<void> {
  await expect(page.getByTestId('properties-panel')).toBeHidden();
  await expect(page.getByTestId('explorer')).toBeHidden();
  await expect.poll(() => canvasScale(page)).toBe(1);
}

const focusCanvas = (page: Page) => activePanel(page).locator('.djs-container > svg').click({ position: { x: 5, y: 5 } });

const blank = async (page: Page, dx = 0): Promise<{ x: number; y: number }> => {
  const box = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  return { x: box.x + box.width - 200 + dx, y: box.y + box.height - 120 };
};

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  // the editor handles every move as it comes (in order, before the button goes up); the marker says the drag is active
  await expect(activePanel(page).locator('.djs-drag-active').first()).toBeAttached();
  await page.mouse.up();
}

const shapes = (page: Page) => activePanel(page).locator('.djs-element.djs-shape');

test('U6 lasso tool (L) selects what the rectangle encloses', async ({ page }) => {
  await load(page);
  const a = await centreOf(page, 'a');
  const b = await centreOf(page, 'b');
  const from = { x: a.x - 90, y: a.y - 70 };
  // like a person: the pointer is where the rectangle starts before the key is pressed. The tool starts from the last pointer position,
  // and that was the focus click in the corner of the canvas, inside the border where dragging scrolls the canvas by itself, until the
  // first move of the pointer arrives (how long that takes is up to the machine): the shapes moved away from the rectangle.
  await page.mouse.move(from.x, from.y);
  await page.keyboard.press('l');
  // armed: the crosshair cursor is on while the lasso waits for the drag
  await expect(page.locator('body')).toHaveClass(/djs-cursor-crosshair/);
  await drag(page, from, { x: b.x + 90, y: b.y + 70 });
  await expect(selected(page)).toHaveCount(2);
  await expect(element(page, 'a')).toHaveClass(/selected/);
  await expect(element(page, 'b')).toHaveClass(/selected/);
  await expect(element(page, 'c')).not.toHaveClass(/selected/);
});

test('U6 hand tool (H) moves the canvas, space tool (S) makes room', async ({ page }) => {
  await load(page);
  const before = await centreOf(page, 'a');
  const free = await blank(page);
  // like a person: the pointer is on the canvas before the key is pressed (the tools start from the last pointer position)
  await page.mouse.move(free.x, free.y);
  await page.keyboard.press('h');
  await drag(page, free, { x: free.x + 60, y: free.y + 40 });
  const moved = await centreOf(page, 'a');
  expect(Math.round(moved.x - before.x)).toBe(60);
  expect(Math.round(moved.y - before.y)).toBe(40);
  // nothing in the model moved
  expect((await shapeBox(page, 'a')).x).toBe(200);

  // holding Space is the hand tool for as long as the key is down: the canvas follows the pointer, and stops when it is released
  await page.keyboard.press('Escape');
  const beforeSpace = await centreOf(page, 'a');
  await page.mouse.move(free.x, free.y);
  await page.keyboard.down('Space');
  await page.mouse.move(free.x - 50, free.y - 30, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(free.x - 80, free.y - 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const afterSpace = await centreOf(page, 'a');
  expect(afterSpace.x).toBeLessThan(beforeSpace.x - 20);
  expect((await shapeBox(page, 'a')).x).toBe(200);

  // space tool: cut between a and b, drag right: b and c move, a stays
  await page.keyboard.press('Escape');
  const a = await centreOf(page, 'a');
  const b = await centreOf(page, 'b');
  const cutX = (a.x + 50 + (b.x - 50)) / 2;
  const startBox = await shapeBox(page, 'b');
  await page.mouse.move(cutX, a.y - 20);
  await page.keyboard.press('s');
  await drag(page, { x: cutX, y: a.y - 20 }, { x: cutX + 100, y: a.y - 20 });
  const afterB = await shapeBox(page, 'b');
  expect(afterB.x - startBox.x).toBeGreaterThanOrEqual(90);
  expect((await shapeBox(page, 'c')).x - 700).toBeGreaterThanOrEqual(90);
  expect((await shapeBox(page, 'a')).x).toBe(200);
});

test('U6 global connect tool (C) connects any two elements with the right flow', async ({ page }) => {
  const api = await load(page);
  const before = await api.elementIds();
  const a = await centreOf(page, 'a');
  const b = await centreOf(page, 'b');
  // the pointer is over the canvas before the key is pressed, and it hovers each element before it is clicked
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.press('c');
  await page.mouse.move(a.x + 1, a.y + 1, { steps: 3 });
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.click(b.x, b.y);
  await expect(activePanel(page).locator('.djs-connection')).toHaveCount(1);
  const created = (await api.elementIds()).filter((id) => !before.includes(id));
  expect(created.length).toBeGreaterThan(0);
  expect(created.some((id) => id.startsWith('Flow_'))).toBe(true);
  await expect(activePanel(page).locator('.djs-connection')).toHaveCount(1);
});

test('U6 align and distribute through the Edit menu', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Control+A');
  await expect(selected(page)).toHaveCount(3);
  await menu(page, 'Edit', 'Align elements', 'Align top');
  const tops = [await shapeBox(page, 'a'), await shapeBox(page, 'b'), await shapeBox(page, 'c')].map((box) => box.y);
  expect(new Set(tops).size).toBe(1);

  // a is at 200..300, b at 420..520, c at 700..800: the gaps are 120 and 180 until distributed
  await menu(page, 'Edit', 'Distribute elements', 'Distribute horizontally');
  const [a, b, c] = [await shapeBox(page, 'a'), await shapeBox(page, 'b'), await shapeBox(page, 'c')];
  expect(Math.abs(b.x - (a.x + a.width) - (c.x - (b.x + b.width)))).toBeLessThanOrEqual(1);
  // the two submenus are only offered for a selection that makes sense
  await page.keyboard.press('Escape');
  await focusCanvas(page);
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Align elements' })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('U6 auto-place puts an appended element after its source and connects it', async ({ page }) => {
  await load(page);
  await page.mouse.click((await centreOf(page, 'a')).x, (await centreOf(page, 'a')).y);
  const pad = activePanel(page).locator('.djs-context-pad');
  await expect(pad).toBeVisible();
  const before = await shapes(page).count();
  await pad.locator('[data-action="append.append-task"]').click();
  await expect(shapes(page)).toHaveCount(before + 1);
  await expect(activePanel(page).locator('.djs-connection')).toHaveCount(1);
  const a = await shapeBox(page, 'a');
  const created = await activePanel(page).locator('.djs-element.djs-shape[data-element-id^="Activity_"]').first().getAttribute('data-element-id');
  const appended = await shapeBox(page, created!);
  expect(appended.x).toBeGreaterThan(a.x + a.width);
  expect(appended.y).toBe(a.y);
  // appending once more stacks below, so that nothing overlaps
  await page.keyboard.press('Escape');
});

test('U6 auto-resize grows an expanded sub-process when an element is moved out of its edge', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.importXml(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="resize" isExecutable="true">
    <bpmn:subProcess id="sp"><bpmn:task id="inner" /></bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="resize">
    <bpmndi:BPMNShape id="sp_di" bpmnElement="sp" isExpanded="true"><dc:Bounds x="150" y="100" width="300" height="220" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="inner_di" bpmnElement="inner"><dc:Bounds x="200" y="150" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`);
  await expect(element(page, 'sp')).toBeVisible();
  await focusCanvas(page);
  await page.keyboard.press('Control+0');
  const before = await shapeBox(page, 'sp');
  const inner = await centreOf(page, 'inner');
  // the pointer stays inside the sub-process, the task reaches over its right edge
  await drag(page, inner, { x: inner.x + 170, y: inner.y });
  const after = await shapeBox(page, 'sp');
  expect(after.width).toBeGreaterThan(before.width + 40);
  expect(after.x).toBe(before.x);
  // the task is still inside it
  const task = await shapeBox(page, 'inner');
  expect(task.x + task.width).toBeLessThanOrEqual(after.x + after.width);
});

test('U6 snapping: elements snap to the grid, and to the edges of other elements', async ({ page }) => {
  await load(page);
  const start = await shapeBox(page, 'a');
  const c = await centreOf(page, 'a');
  await drag(page, c, { x: c.x + 33, y: c.y + 17 });
  const snapped = await shapeBox(page, 'a');
  expect((snapped.x - start.x) % 10).toBe(0);
  expect((snapped.y - start.y) % 10).toBe(0);
  expect(snapped.x - start.x).not.toBe(33);
});

test('U6 with the grid off elements move freely, but still snap to the edges of other elements', async ({ page }) => {
  await load(page);
  await menu(page, 'View', 'Grid');
  await expect(activePanel(page).locator('.layer-djs-grid rect')).toHaveCount(0);
  // b (top 160) is dropped 4 px below the top of a (top 100): it snaps to a's top edge, and moves exactly 13 px sideways
  const before = await shapeBox(page, 'b');
  const b = await centreOf(page, 'b');
  await drag(page, b, { x: b.x + 13, y: b.y - 56 });
  const after = await shapeBox(page, 'b');
  expect(after.x - before.x).toBe(13);
  expect(after.y).toBe(100);
});

test('U6 label editing: double-click and the E key edit the name, and it is part of the model', async ({ page }) => {
  await load(page);
  const a = await centreOf(page, 'a');
  await page.mouse.dblclick(a.x, a.y);
  const editor = activePanel(page).locator('.djs-direct-editing-content');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Check the request');
  const free = await blank(page);
  await page.mouse.click(free.x, free.y);
  await expect(element(page, 'a')).toContainText('Check the request');

  // E edits the selected element
  await page.mouse.click((await centreOf(page, 'b')).x, (await centreOf(page, 'b')).y);
  await page.keyboard.press('e');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Decide');
  await page.mouse.click(free.x, free.y);
  await expect(element(page, 'b')).toContainText('Decide');
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
});

test('U6 undo and redo walk back and forth through edits', async ({ page }) => {
  const api = await load(page);
  const c = await centreOf(page, 'c');
  await drag(page, c, { x: c.x, y: c.y + 120 });
  const moved = await shapeBox(page, 'c');
  expect(moved.y).toBe(200);
  await page.keyboard.press('Control+Z');
  expect((await shapeBox(page, 'c')).y).toBe(80);
  await page.keyboard.press('Control+Y');
  expect((await shapeBox(page, 'c')).y).toBe(200);
  await page.keyboard.press('Control+Shift+Z');
  // redo when there is nothing to redo does nothing; undo twice more reaches the start
  expect((await shapeBox(page, 'c')).y).toBe(200);
  await page.keyboard.press('Control+Z');
  expect((await shapeBox(page, 'c')).y).toBe(80);
  await page.keyboard.press('Control+Shift+Z');
  expect((await shapeBox(page, 'c')).y).toBe(200);
  // the menu does the same, and a deletion is undone too
  await page.mouse.click((await centreOf(page, 'a')).x, (await centreOf(page, 'a')).y);
  await page.keyboard.press('Delete');
  await expect(element(page, 'a')).toHaveCount(0);
  await menu(page, 'Edit', 'Undo');
  await expect(element(page, 'a')).toBeVisible();
  expect(await api.elementIds()).toContain('a');
});

test('U6 copy, paste and duplicate create new elements that carry their name', async ({ page }) => {
  await load(page);
  await page.mouse.click((await centreOf(page, 'a')).x, (await centreOf(page, 'a')).y);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  const free = await blank(page);
  await page.mouse.move(free.x, free.y, { steps: 3 });
  await page.mouse.click(free.x, free.y);
  await expect(shapes(page)).toHaveCount(4);
  await expect(activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Review' })).toHaveCount(2);

  await page.mouse.click((await centreOf(page, 'b')).x, (await centreOf(page, 'b')).y);
  await page.keyboard.press('Control+D');
  await page.mouse.move(free.x - 150, free.y - 150, { steps: 3 });
  await page.mouse.click(free.x - 150, free.y - 150);
  await expect(shapes(page)).toHaveCount(5);
  await expect(activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Approve' })).toHaveCount(2);
});

test('U6 copy in one tab and paste in another', async ({ page }) => {
  await load(page);
  await page.mouse.click((await centreOf(page, 'b')).x, (await centreOf(page, 'b')).y);
  await page.keyboard.press('Control+C');
  await menu(page, 'File', 'New file', 'Empty process');
  await page.getByTestId('prompt-input').fill('target');
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, 'target.bpmn20.xml')).toHaveClass(/active/);
  await expect(element(page, 'StartEvent_target')).toBeVisible();
  await pasteAt(page, await blank(page));
  await expect(activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Approve' })).toHaveCount(1);
  await expect(tab(page, 'target.bpmn20.xml')).toHaveClass(/dirty/);
  // the first tab is untouched by it
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expect(activePanel(page).locator('.djs-element.djs-shape', { hasText: 'Approve' })).toHaveCount(1);
});

test('U6 zoom in, zoom out, actual size and fit', async ({ page }) => {
  await load(page, [
    { id: 'a', type: 'task', name: 'Left', x: 100, y: 100 },
    { id: 'z', type: 'task', name: 'Right', x: 3000, y: 900 },
  ]);
  expect(await canvasScale(page)).toBeCloseTo(1, 5);
  await page.keyboard.press('Control+=');
  const zoomedIn = await canvasScale(page);
  expect(zoomedIn).toBeGreaterThan(1);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  expect(await canvasScale(page)).toBeLessThan(1);
  await page.keyboard.press('Control+0');
  expect(await canvasScale(page)).toBeCloseTo(1, 5);
  // fit shows the whole diagram: both ends are inside the canvas
  await page.keyboard.press('Control+1');
  expect(await canvasScale(page)).toBeLessThan(0.6);
  const canvas = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  for (const id of ['a', 'z']) {
    const c = await centreOf(page, id);
    expect(c.x).toBeGreaterThan(canvas.x);
    expect(c.x).toBeLessThan(canvas.x + canvas.width);
    expect(c.y).toBeGreaterThan(canvas.y);
    expect(c.y).toBeLessThan(canvas.y + canvas.height);
  }
  // the View menu offers the same
  await menu(page, 'View', 'Actual size');
  expect(await canvasScale(page)).toBeCloseTo(1, 5);
});

test('U6 move to origin (Ctrl+Shift+O) brings the diagram to the top left corner of the coordinate system', async ({ page }) => {
  await load(page, [
    { id: 'a', type: 'task', name: 'A', x: 640, y: 420 },
    { id: 'b', type: 'task', name: 'B', x: 900, y: 500 },
  ]);
  await page.keyboard.press('Control+Shift+O');
  const [a, b] = [await shapeBox(page, 'a'), await shapeBox(page, 'b')];
  // the grid rounds the move to a multiple of 10
  expect(Math.min(a.x, b.x)).toBeLessThanOrEqual(5);
  expect(Math.min(a.y, b.y)).toBeLessThanOrEqual(5);
  expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(-5);
  // the relative layout is unchanged
  expect(b.x - a.x).toBe(260);
  expect(b.y - a.y).toBe(80);
  // it is one undoable step
  await page.keyboard.press('Control+Z');
  expect((await shapeBox(page, 'a')).x).toBe(640);
});

test('U7 search (Ctrl+F) finds elements by name and selects the match', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Control+F');
  const search = activePanel(page).locator('.djs-search-container');
  await expect(search).toBeVisible();
  await page.keyboard.type('Appr');
  const results = search.locator('.djs-search-result');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Approve');
  await page.keyboard.press('Enter');
  await expect(selected(page)).toHaveCount(1);
  await expect(element(page, 'b')).toHaveClass(/selected/);
  // an id matches too
  await page.keyboard.press('Control+F');
  await page.keyboard.type('c');
  await expect(search.locator('.djs-search-result').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
});

test('U4 the replace menu offers what Activiti runs and nothing it does not', async ({ page }) => {
  await load(page);
  await page.mouse.click((await centreOf(page, 'a')).x, (await centreOf(page, 'a')).y);
  await activePanel(page).locator('.djs-context-pad [data-action="replace"]').click();
  const menuEntries = page.locator('.djs-popup .entry, .djs-popup .djs-popup-entry');
  await expect(menuEntries.first()).toBeVisible();
  const labels = (await menuEntries.allInnerTexts()).map((t) => t.trim());
  expect(labels).toEqual(expect.arrayContaining(['User task', 'Service task', 'Script task']));
  expect(labels).not.toContain('Business rule task');
  await page.keyboard.press('Escape');
  // no group in the palette either: Activiti drops groups
  await expect(activePanel(page).locator('.djs-palette [data-action="create.group"]')).toHaveCount(0);
  await expect(activePanel(page).locator('.djs-palette [data-action="create.decision-task"]')).toHaveCount(1);
});
