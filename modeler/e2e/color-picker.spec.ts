import { type Page, expect } from '@playwright/test';

import { test } from './support/test';
import { activePanel, element, idbFiles, openApp, tab } from './support/app';
import { ModelerApi } from './support/modelerApi';

/** U9: the colour picker (bpmn-js-color-picker) in the context pad. It writes bioc: / color: attributes on the diagram elements only. */

const popup = (page: Page) => page.locator('.djs-popup.color-picker');
const strokeOf = (page: Page, id: string) => element(page, id).locator('.djs-visual > :first-child').first().evaluate((el) => getComputedStyle(el).stroke);
const fillOf = (page: Page, id: string) => element(page, id).locator('.djs-visual > :first-child').first().evaluate((el) => getComputedStyle(el).fill);

async function twoTasks(page: Page): Promise<ModelerApi> {
  await openApp(page);
  const api = await ModelerApi.attach(page);
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review', at: { x: 300, y: 200 } });
  await api.createShape({ type: 'userTask', id: 'approve', name: 'Approve', at: { x: 500, y: 200 } });
  await expect(element(page, 'review')).toBeVisible();
  return api;
}

test('U9 the context pad has a colour button; choosing Blue colours the task, Default takes the colour away', async ({ page }) => {
  await twoTasks(page);
  await element(page, 'review').click();
  const button = activePanel(page).locator('.djs-context-pad .entry[data-action="set-color"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('title', 'Set color');
  await button.click();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.entry')).toHaveCount(6);
  await popup(page).locator('.entry[data-id="blue-color"]').click();
  await expect(popup(page)).toBeHidden();
  expect(await strokeOf(page, 'review')).toBe('rgb(13, 67, 114)');
  expect(await fillOf(page, 'review')).toBe('rgb(187, 222, 251)');
  // the other task keeps the default
  expect(await strokeOf(page, 'approve')).not.toBe('rgb(13, 67, 114)');

  // select it again (click elsewhere first): the pad of a selected element opens on selection
  await element(page, 'approve').click();
  await element(page, 'review').click();
  await button.click();
  await popup(page).locator('.entry[data-id="default-color"]').click();
  expect(await strokeOf(page, 'review')).not.toBe('rgb(13, 67, 114)');
});

test('U9 a coloured diagram is saved with bioc: and color: attributes on the shapes only, and the model has no problems', async ({ page }) => {
  await twoTasks(page);
  // two elements at once: the multi-selection has the colour button too
  await page.keyboard.press('Control+A');
  const button = activePanel(page).locator('.djs-context-pad .entry[data-action="set-color"]');
  await expect(button).toBeVisible();
  await button.click();
  await popup(page).locator('.entry[data-id="green-color"]').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);

  const xml = (await idbFiles(page))['processes/process.bpmn20.xml']!;
  expect(xml).toContain('xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"');
  const shapes = xml.match(/<bpmndi:BPMNShape id="(review|approve)_di"[^>]*>/g)!;
  expect(shapes).toHaveLength(2);
  for (const shape of shapes) {
    expect(shape).toContain('bioc:stroke="#205022"');
    expect(shape).toContain('bioc:fill="#c8e6c9"');
    expect(shape).toContain('color:border-color="#205022"');
    expect(shape).toContain('color:background-color="#c8e6c9"');
  }
  // only the diagram carries colours; nothing is added to the semantic elements
  expect(/<bpmn:userTask id="review"[^>]*>/.exec(xml)![0]).not.toMatch(/bioc:|color:/);
  expect(xml).not.toMatch(/camunda|zeebe/i);

  // the lint accepts it: no foreign attribute problem, nothing at error level for the colours
  const problems = await page.evaluate(() => window.__modelerLint!.problems());
  expect(problems.map((p) => p.rule)).not.toContain('activiti/foreign-attribute-namespace');
  expect(problems.map((p) => p.rule)).not.toContain('activiti/no-camunda-extensions');
  const gate = await page.evaluate(() => window.__modelerLint!.checkDeployable());
  expect(gate.counts.error).toBe(0);
});

test('U9 the colours survive a reload: they are read back from the saved file', async ({ page }) => {
  await twoTasks(page);
  await element(page, 'approve').click();
  await activePanel(page).locator('.djs-context-pad .entry[data-action="set-color"]').click();
  await popup(page).locator('.entry[data-id="red-color"]').click();
  await page.keyboard.press('Control+S');
  await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  await page.reload();
  await element(page, 'approve').waitFor();
  expect(await strokeOf(page, 'approve')).toBe('rgb(131, 19, 17)');
});
