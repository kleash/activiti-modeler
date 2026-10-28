import { expect, type Page } from '@playwright/test';

import { activePanel, element, menu, openApp, processXml, reloadApp, tab, waitForSession } from './support/app';
import { ModelerApi } from './support/modelerApi';
import { test } from './support/test';

/** U19: the settings dialog, the persisted panel layout, resizable panels and the restored session. */

const treeItem = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const dialog = (page: Page) => page.getByTestId('settings-dialog');
const stored = (page: Page, key: string): Promise<Record<string, unknown> | null> =>
  page.evaluate((k) => {
    const text = localStorage.getItem(k);
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  }, key);
const SETTINGS = 'activiti-modeler.settings.v1';
const LAYOUT = 'activiti-modeler.layout.v1';

async function mappingOfNewUserTask(page: Page, id: string): Promise<unknown> {
  const api = await ModelerApi.attach(page);
  await api.createShape({ type: 'userTask', id });
  const { files } = await api.exportProject();
  const json = JSON.parse(files.find((f) => f.path.endsWith('-extensions.json'))!.content) as { extensions: Record<string, { mappings: Record<string, unknown> }> };
  return Object.values(json.extensions)[0]!.mappings[id];
}

test.describe('U19 settings dialog', () => {
  test('U19 Ctrl+, and File > Settings open the dialog with every setting at its default; Escape closes it', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('kept in this browser');
    await expect(page.getByTestId('setting-defaultMappings-mapAll')).toBeChecked();
    await expect(page.getByTestId('setting-autoLayout')).toBeChecked();
    await expect(page.getByTestId('setting-restoreSession')).toBeChecked();
    await expect(page.getByTestId('setting-offerCamundaConversion')).toBeChecked();
    await expect(page.getByTestId('setting-explainExport')).toBeChecked();
    await expect(page.getByTestId('setting-locale')).toHaveValue('en');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await menu(page, 'File', 'Settings…');
    await expect(dialog(page)).toBeVisible();
  });

  test('U19 the dialog is operable with the keyboard alone: Tab reaches every control, Space toggles a checkbox', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-defaultMappings-mapAll').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('setting-defaultMappings-none')).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('setting-autoLayout')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('setting-autoLayout')).not.toBeChecked();
    await expect.poll(async () => await stored(page, SETTINGS)).toMatchObject({ defaultMappings: 'none', autoLayout: false });
  });

  test('U19 settings are remembered after a reload, and "Restore defaults" puts them back', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-offerCamundaConversion').uncheck();
    await page.getByTestId('setting-restoreSession').uncheck();
    await page.keyboard.press('Escape');
    await reloadApp(page);
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('setting-offerCamundaConversion')).not.toBeChecked();
    await expect(page.getByTestId('setting-restoreSession')).not.toBeChecked();
    await page.getByTestId('setting-restore-defaults').click();
    await expect(page.getByTestId('setting-offerCamundaConversion')).toBeChecked();
    await expect(page.getByTestId('setting-restoreSession')).toBeChecked();
    expect(await stored(page, SETTINGS)).toMatchObject({ defaultMappings: 'mapAll', autoLayout: true, restoreSession: true, offerCamundaConversion: true });
  });

  test('U19 the default mapping setting decides whether a new user task passes all variables (MAP_ALL), and takes effect at once', async ({ page }) => {
    await openApp(page);
    const api = await ModelerApi.open(page);
    await api.importXml(processXml('settingsFlow', [{ id: 'first', type: 'task', x: 150, y: 100 }]));
    expect(await mappingOfNewUserTask(page, 'withDefault')).toEqual({ mappingType: 'MAP_ALL' });
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-defaultMappings-none').check();
    await page.keyboard.press('Escape');
    expect(await mappingOfNewUserTask(page, 'withoutDefault')).toBeUndefined();
  });

  test('U19 "Reset panel layout" brings the panels back to their default sizes and shows them; the minimap choice stays', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+B');
    await expect(page.getByTestId('bottom-panel')).toBeVisible();
    await page.keyboard.press('Control+P');
    await expect(page.getByTestId('properties-panel')).toHaveCount(0);
    await menu(page, 'View', 'Minimap');
    await expect.poll(async () => await stored(page, LAYOUT)).toMatchObject({ bottomOpen: true, propertiesOpen: false, minimapOpen: true });
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-reset-layout').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('properties-panel')).toBeVisible();
    await expect(page.getByTestId('bottom-panel')).toHaveCount(0);
    expect(await stored(page, LAYOUT)).toMatchObject({ propertiesOpen: true, bottomOpen: false, explorerWidth: 250, propertiesWidth: 320, minimapOpen: true });
  });
});

test.describe('U19 properties panel layout', () => {
  const group = (page: Page, id: string) => page.locator('#properties-panel-slot').locator(`[data-group-id="group-${id}"]`);
  const header = (page: Page, id: string) => group(page, id).locator('.bio-properties-panel-group-header');
  const OPEN = /(^|\s)open(\s|$)/;
  const PANEL_LAYOUT = 'activiti-modeler.properties-layout.v1';

  test('U19 a group opened or closed in the properties panel stays so for the next element and after a reload', async ({ page }) => {
    await openApp(page);
    // the process of the new project: General is open by default, Documentation closed
    await expect(group(page, 'starters')).toBeVisible();
    await expect(header(page, 'general')).toHaveClass(OPEN);
    await expect(header(page, 'documentation')).not.toHaveClass(OPEN);
    await header(page, 'general').click();
    await expect(header(page, 'general')).not.toHaveClass(OPEN);
    await header(page, 'documentation').click();
    await expect(header(page, 'documentation')).toHaveClass(OPEN);

    // the start event has the same two groups, in the state they were left in
    await element(page, 'StartEvent_1').click();
    await expect(group(page, 'startInitiator')).toBeVisible();
    await expect(group(page, 'starters')).toHaveCount(0);
    await expect(header(page, 'general')).not.toHaveClass(OPEN);
    await expect(header(page, 'documentation')).toHaveClass(OPEN);
    // a group the process does not have, open by default
    await expect(header(page, 'startInitiator')).toHaveClass(OPEN);
    await header(page, 'startInitiator').click();
    await expect(header(page, 'startInitiator')).not.toHaveClass(OPEN);
    await expect.poll(() => stored(page, PANEL_LAYOUT)).toMatchObject({ groups: { general: { open: false }, documentation: { open: true }, startInitiator: { open: false } } });

    // after a reload the panel opens the groups as they were left
    await reloadApp(page);
    await expect(group(page, 'starters')).toBeVisible();
    await expect(header(page, 'general')).not.toHaveClass(OPEN);
    await expect(header(page, 'documentation')).toHaveClass(OPEN);
    await element(page, 'StartEvent_1').click();
    await expect(group(page, 'startInitiator')).toBeVisible();
    await expect(header(page, 'general')).not.toHaveClass(OPEN);
    await expect(header(page, 'documentation')).toHaveClass(OPEN);
    await expect(header(page, 'startInitiator')).not.toHaveClass(OPEN);
  });
});

test.describe('U19 session restore', () => {
  test('U19 the tabs, their views and the active tab come back after a reload', async ({ page }) => {
    await openApp(page);
    await treeItem(page, 'project.json').dblclick();
    await expect(tab(page, 'project.json')).toHaveClass(/active/);
    await waitForSession(page, 'project.json');
    await page.reload();
    await expect(tab(page, 'project.json')).toHaveClass(/active/);
    await expect(tab(page, 'process.bpmn20.xml')).toBeVisible();
    await tab(page, 'process.bpmn20.xml').click();
    await expect(activePanel(page).locator('.djs-element').first()).toBeVisible();
  });

  test('U19 with "Reopen the tabs of the last session" off, a reload opens the first process only', async ({ page }) => {
    await openApp(page);
    await treeItem(page, 'project.json').dblclick();
    await expect(tab(page, 'project.json')).toHaveClass(/active/);
    await waitForSession(page, 'project.json');
    await page.keyboard.press('Control+,');
    await page.getByTestId('setting-restoreSession').uncheck();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/active/);
    await expect(tab(page, 'project.json')).toHaveCount(0);
  });
});
