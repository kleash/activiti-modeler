import { type Page, expect } from '@playwright/test';

import { test } from './support/test';
import { activePanel, element, processXml } from './support/app';
import { ModelerApi } from './support/modelerApi';

/** U5: the `N` and `A` menus of bpmn-js-create-append-anything, restricted to what Activiti 9 runs. */

const popup = (page: Page) => page.locator('.djs-popup');
const entry = (page: Page, id: string) => popup(page).locator(`.entry[data-id="${id}"]`);
const focusCanvas = (page: Page) => activePanel(page).locator('.djs-container > svg').click({ position: { x: 5, y: 5 } });

async function load(page: Page, shapes: Array<{ id: string; type: string; name?: string; x: number; y: number }> = [{ id: 'review', type: 'userTask', name: 'Review', x: 200, y: 100 }]): Promise<ModelerApi> {
  const api = await ModelerApi.open(page);
  await api.importXml(processXml('menus', shapes));
  await expect(element(page, shapes[0]!.id)).toBeVisible();
  await focusCanvas(page);
  return api;
}

/** The entry ids the popup lists after a search (empty search: the menu as it opens). */
async function entriesFor(page: Page, search = ''): Promise<string[]> {
  if (search) await page.keyboard.type(search);
  return popup(page).locator('.entry[data-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
}

test.describe('U5 create / append anything', () => {
  test('U5 N opens the create menu with categories, descriptions and a link to the guide; the Decision task is in it', async ({ page }) => {
    await load(page);
    await page.keyboard.press('n');
    await expect(popup(page)).toBeVisible();
    await expect(popup(page).locator('.djs-popup-title')).toHaveText('Create element');
    for (const group of ['Tasks', 'Gateways', 'Events', 'Sub-processes', 'Data', 'Participants']) {
      await expect(popup(page).locator('.entry-header', { hasText: group })).toBeVisible();
    }
    await expect(entry(page, 'create-user-task')).toContainText('A task a person completes');
    await expect(entry(page, 'create-user-task').locator('a.djs-popup-entry-docs')).toHaveAttribute('href', /docs\/user-guide\/properties\/user-assignment\.md$/);
    await expect(entry(page, 'create-decision-task')).toContainText('DMN');
    await expect(entry(page, 'create-service-task')).toBeVisible();
  });

  test('U5 the create menu has no conditional or escalation events and no complex gateway, in the list and in the search', async ({ page }) => {
    await load(page);
    await page.keyboard.press('n');
    const all = await entriesFor(page);
    expect(all.length).toBeGreaterThan(25);
    for (const hidden of ['create-complex-gateway', 'create-conditional-start', 'create-conditional-intermediate-catch', 'create-escalation-start', 'create-escalation-intermediate-throw', 'create-escalation-end', 'create-rule-task', 'create-signal-end', 'create-expanded-ad-hoc-subprocess']) {
      expect(all, hidden).not.toContain(hidden);
    }
    // the search covers the entries that are hidden until one searches (rank < 0) and still finds nothing hidden
    for (const word of ['complex', 'conditional', 'escalation', 'ad-hoc', 'business rule']) {
      await page.keyboard.press('Control+A');
      await page.keyboard.type(word);
      const found = await entriesFor(page);
      const labels = (await popup(page).locator('.entry .djs-popup-label').allInnerTexts()).join(' | ').toLowerCase();
      expect(labels, `search "${word}"`).not.toContain(word === 'business rule' ? 'business rule task' : word === 'ad-hoc' ? 'ad-hoc sub-process' : `${word} `);
      expect(found.filter((id) => /complex|conditional|escalation|ad-hoc|rule-task/.test(id)), `search "${word}"`).toEqual([]);
    }
    // an entry that is only found by searching is there
    await page.keyboard.press('Control+A');
    await page.keyboard.type('inclusive');
    expect(await entriesFor(page)).toContain('create-inclusive-gateway');
  });

  test('U5 an entry of the create menu starts the creation: the new user task lands where the pointer clicks', async ({ page }) => {
    await load(page);
    const before = await ModelerApi.attach(page).then((api) => api.elementIds());
    await page.keyboard.press('n');
    await entry(page, 'create-user-task').click();
    // the shape follows the pointer; a click on the canvas drops it
    await activePanel(page).locator('.djs-container > svg').click({ position: { x: 600, y: 300 } });
    const after = await ModelerApi.attach(page).then((api) => api.elementIds());
    const created = after.filter((id) => !before.includes(id) && /^Activity_/.test(id));
    expect(created).toHaveLength(1);
    await expect(element(page, created[0]!)).toBeVisible();
    const xml = await ModelerApi.attach(page).then((api) => api.currentXml());
    expect(xml).toMatch(new RegExp(`<bpmn:userTask id="${created[0]}"`));
  });

  test('U5 A on a selected task opens the append menu; appending an exclusive gateway connects it to the task', async ({ page }) => {
    const api = await load(page);
    await element(page, 'review').click();
    await page.keyboard.press('a');
    await expect(popup(page)).toBeVisible();
    await expect(popup(page).locator('.djs-popup-title')).toHaveText('Append element');
    const all = await entriesFor(page);
    // nothing that cannot follow a task, nothing that Activiti does not run
    expect(all).not.toContain('append-none-start-event');
    expect(all).not.toContain('append-expanded-pool');
    expect(all).not.toContain('append-complex-gateway');
    expect(all).not.toContain('append-escalation-end');
    expect(all).toContain('append-timer-boundary');
    expect(all).toContain('append-decision-task');
    await entry(page, 'append-exclusive-gateway').click();
    const xml = await api.currentXml();
    expect(xml).toMatch(/<bpmn:exclusiveGateway id="Gateway_/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="Flow_[^"]*" sourceRef="review" targetRef="Gateway_/);
  });

  test('U5 appending the Decision task after a task gives a connected service task that calls the DMN connector', async ({ page }) => {
    const api = await load(page);
    await element(page, 'review').click();
    await page.keyboard.press('a');
    await entry(page, 'append-decision-task').click();
    const xml = await api.currentXml();
    expect(xml).toMatch(/<bpmn:serviceTask id="Activity_[^"]*" name="Decision task" implementation="dmn-connector\.EXECUTE_TABLE"/);
    expect(xml).toMatch(/sourceRef="review" targetRef="Activity_/);
  });

  test('U5 a boundary event from the append menu attaches to the task; the cancel boundary event is not offered on a task', async ({ page }) => {
    const api = await load(page);
    await element(page, 'review').click();
    await page.keyboard.press('a');
    expect(await entriesFor(page)).not.toContain('append-cancel-boundary');
    await entry(page, 'append-timer-boundary').click();
    const xml = await api.currentXml();
    expect(xml).toMatch(/<bpmn:boundaryEvent id="Event_[^"]*" attachedToRef="review"/);
    expect(xml).toMatch(/<bpmn:timerEventDefinition/);
  });

  test('U5 behind an event-based gateway the append menu offers intermediate catch events only', async ({ page }) => {
    await load(page, [
      { id: 'wait', type: 'eventBasedGateway', x: 200, y: 100 },
    ]);
    await element(page, 'wait').click();
    await page.keyboard.press('a');
    const all = await entriesFor(page);
    expect(all.sort()).toEqual(['append-link-intermediate-catch', 'append-message-intermediate-catch', 'append-signal-intermediate-catch', 'append-timer-intermediate-catch']);
  });

  test('U5 A with nothing appendable selected falls back to the create menu (an end event has no append menu)', async ({ page }) => {
    await load(page, [{ id: 'done', type: 'endEvent', x: 200, y: 100 }]);
    await element(page, 'done').click();
    await page.keyboard.press('a');
    await expect(popup(page).locator('.djs-popup-title')).toHaveText('Create element');
  });
});
