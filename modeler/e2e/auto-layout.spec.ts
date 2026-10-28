import { expect, type Page } from '@playwright/test';

import { dropFiles, element, idbFiles, menu, openApp, processXml, tab, waitForDraft } from './support/app';
import { test } from './support/test';

/** U18: a BPMN file without a diagram gets a layout when it is opened (bpmn-auto-layout); saving keeps the diagram. */

const TITLE = 'hand-written.bpmn20.xml';
const PATH = 'processes/hand-written.bpmn20.xml';

/** A process written by hand: no diagram and no incoming / outgoing references. */
const HAND_WRITTEN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_hand" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="handWritten" name="Hand written" isExecutable="true" activiti:candidateStarterGroups="sales">
    <bpmn:startEvent id="start" name="Start" />
    <bpmn:userTask id="review" name="Review" activiti:assignee="alice" />
    <bpmn:exclusiveGateway id="approved" name="Approved?" default="rejected" />
    <bpmn:serviceTask id="ship" name="Ship" activiti:expression="\${shipper.ship(order)}" />
    <bpmn:endEvent id="done" name="Done" />
    <bpmn:endEvent id="refused" name="Refused" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review" />
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="approved" />
    <bpmn:sequenceFlow id="yes" name="yes" sourceRef="approved" targetRef="ship"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${ok}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="rejected" name="no" sourceRef="approved" targetRef="refused" />
    <bpmn:sequenceFlow id="f3" sourceRef="ship" targetRef="done" />
  </bpmn:process>
</bpmn:definitions>
`;

const toast = (page: Page) => page.getByTestId('toasts');

async function dropHandWritten(page: Page): Promise<void> {
  await openApp(page);
  await dropFiles(page, [{ name: 'hand-written.bpmn', content: HAND_WRITTEN }]);
  await expect(tab(page, TITLE)).toBeVisible();
}

test.describe('U18 auto-layout of a file without a diagram', () => {
  test('U18 a dropped file without a diagram opens drawn: every element and flow is on the canvas, the toast says so', async ({ page }) => {
    await dropHandWritten(page);
    for (const id of ['start', 'review', 'approved', 'ship', 'done', 'refused']) await expect(element(page, id), id).toBeVisible();
    for (const id of ['f1', 'f2', 'yes', 'rejected', 'f3']) await expect(element(page, id), id).toBeAttached();
    await expect(toast(page)).toContainText('had no diagram');
    await expect(toast(page)).toContainText('save the file to keep it');
    // the elements do not sit on top of each other
    const boxes = await Promise.all(['start', 'review', 'approved', 'ship', 'done', 'refused'].map(async (id) => (await element(page, id).boundingBox())!));
    const origins = new Set(boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`));
    expect(origins.size).toBe(6);
  });

  test('U18 the tab is unsaved until the file is saved; saving writes the diagram and keeps every activiti attribute', async ({ page }) => {
    await dropHandWritten(page);
    await expect(tab(page, TITLE)).toHaveClass(/dirty/);
    // the file on disk has no diagram yet
    expect((await idbFiles(page))[PATH]).not.toContain('BPMNShape');
    await page.keyboard.press('Control+S');
    await expect(tab(page, TITLE)).not.toHaveClass(/dirty/);
    const xml = (await idbFiles(page))[PATH]!;
    for (const id of ['start', 'review', 'approved', 'ship', 'done', 'refused']) expect(xml, id).toMatch(new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${id}"`));
    for (const id of ['f1', 'f2', 'yes', 'rejected', 'f3']) expect(xml, id).toMatch(new RegExp(`<bpmndi:BPMNEdge[^>]*bpmnElement="${id}"`));
    expect(xml).toContain('activiti:candidateStarterGroups="sales"');
    expect(xml).toContain('activiti:assignee="alice"');
    expect(xml).toContain('default="rejected"');
    expect(xml).toContain('${ok}');
  });

  test('U18 the saved file opens after a reload without another layout or toast', async ({ page }) => {
    await dropHandWritten(page);
    await page.keyboard.press('Control+S');
    await expect(tab(page, TITLE)).not.toHaveClass(/dirty/);
    const saved = (await idbFiles(page))[PATH]!;
    await page.reload();
    await expect(element(page, 'review')).toBeVisible();
    await expect(tab(page, TITLE)).not.toHaveClass(/dirty/);
    await expect(toast(page)).not.toContainText('had no diagram');
    expect((await idbFiles(page))[PATH]).toBe(saved);
  });

  test('U18 a reload before saving recovers the laid out diagram as unsaved work', async ({ page }) => {
    await dropHandWritten(page);
    await waitForDraft(page, PATH, (content) => content.includes('BPMNShape'));
    await page.reload();
    await expect(element(page, 'review')).toBeVisible();
    await expect(tab(page, TITLE)).toHaveClass(/dirty/);
  });

  test('U18 a file that has a diagram is opened as it is: nothing is drawn, no toast, the tab is not unsaved', async ({ page }) => {
    await openApp(page);
    await dropFiles(page, [{ name: 'drawn.bpmn', content: processXml('drawn', [{ id: 'a', type: 'task', x: 100, y: 100 }, { id: 'b', type: 'task', x: 400, y: 100 }]) }]);
    await expect(tab(page, 'drawn.bpmn20.xml')).toBeVisible();
    await expect(element(page, 'b')).toBeVisible();
    await expect(tab(page, 'drawn.bpmn20.xml')).not.toHaveClass(/dirty/);
    await expect(toast(page)).not.toContainText('had no diagram');
    expect((await idbFiles(page))['processes/drawn.bpmn20.xml']).toContain('x="400"');
  });

  test('U18 the Settings dialog switches the layout off: the file is then not drawn and the tab says why it cannot be shown', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-autoLayout').uncheck();
    await page.getByTestId('settings-dialog').getByRole('button', { name: 'Close' }).click();
    await dropFiles(page, [{ name: 'hand-written.bpmn', content: HAND_WRITTEN }]);
    await expect(tab(page, TITLE)).toBeVisible();
    await expect(page.getByTestId('error-tab')).toBeVisible();
    await expect(tab(page, TITLE)).not.toHaveClass(/dirty/);
    await menu(page, 'File', 'Settings…');
    await expect(page.getByTestId('setting-autoLayout')).not.toBeChecked();
  });
});
