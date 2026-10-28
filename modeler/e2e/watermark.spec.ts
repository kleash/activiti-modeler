import { type Page, expect } from '@playwright/test';
import { test } from './support/test';

import { activePanel, menu, openApp, tab } from './support/app';
import { placeShape, replaceDecisionWith } from './dmn/support';
import { expectWatermarkVisible } from './support/watermark';

/**
 * U20: the bpmn.io watermark is visible and not overlapped on every canvas, in every layout state: the project explorer, the
 * properties panel, the bottom panel and the minimap open or closed, other tabs, the XML and JSON views, toasts, small windows.
 */

const visible = (page: Page, testId: string) => page.getByTestId(testId).isVisible();
const minimapOpen = (page: Page) => activePanel(page).locator('.djs-minimap.open').count().then((n) => n > 0);

interface LayoutState {
  explorer: boolean;
  properties: boolean;
  bottom: boolean;
  minimap: boolean;
}

async function setLayout(page: Page, want: LayoutState): Promise<void> {
  if ((await visible(page, 'explorer')) !== want.explorer) await menu(page, 'View', 'Project explorer');
  if ((await visible(page, 'properties-panel')) !== want.properties) await page.keyboard.press('Control+P');
  if ((await visible(page, 'bottom-panel')) !== want.bottom) await page.keyboard.press('Control+B');
  if ((await minimapOpen(page)) !== want.minimap) await menu(page, 'View', 'Minimap');
  await expect(page.getByTestId('explorer')).toBeVisible({ visible: want.explorer });
  await expect(page.getByTestId('properties-panel')).toBeVisible({ visible: want.properties });
  await expect(page.getByTestId('bottom-panel')).toBeVisible({ visible: want.bottom });
  expect(await minimapOpen(page)).toBe(want.minimap);
}

const label = (s: LayoutState): string => `explorer ${s.explorer ? 'open' : 'closed'}, properties ${s.properties ? 'open' : 'closed'}, bottom ${s.bottom ? 'open' : 'closed'}, minimap ${s.minimap ? 'open' : 'closed'}`;

/** All 16 combinations, each one toggle away from the previous (a Gray code). */
function* grayStates(): Generator<LayoutState> {
  for (let i = 0; i < 16; i += 1) {
    const g = i ^ (i >> 1);
    yield { explorer: !!(g & 1), properties: !!(g & 2), bottom: !!(g & 4), minimap: !!(g & 8) };
  }
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('U20 the watermark is visible in all 16 layouts of explorer, properties panel, bottom panel and minimap', async ({ page }) => {
  for (const state of grayStates()) {
    await setLayout(page, state);
    await expectWatermarkVisible(page, label(state));
  }
});

test('U20 the watermark is visible on every canvas: other tabs, and after switching views', async ({ page }) => {
  await setLayout(page, { explorer: true, properties: true, bottom: true, minimap: true });
  for (const [name, title] of [['user-task-approval', 'approval'], ['connector-call', 'mail'], ['empty-process', 'blank']] as const) {
    await menu(page, 'File', 'New file', { 'user-task-approval': 'User task approval', 'connector-call': 'Connector call', 'empty-process': 'Empty process' }[name]);
    await page.getByTestId('prompt-input').fill(title);
    await page.getByTestId('prompt-confirm').click();
    await expect(tab(page, `${title}.bpmn20.xml`)).toHaveClass(/active/);
    await expect(activePanel(page).locator('.djs-container svg .djs-element').first()).toBeVisible();
    // the minimap is a per-diagram setting: open it here as well
    if (!(await minimapOpen(page))) await menu(page, 'View', 'Minimap');
    await expectWatermarkVisible(page, `tab ${title}, everything open`);
  }
  // exactly one watermark is visible at a time: the hidden canvases do not show theirs
  await expect(page.locator('.bjs-powered-by:visible')).toHaveCount(1);

  // through the tabs
  for (const title of ['process', 'approval', 'mail', 'blank']) {
    await tab(page, `${title}.bpmn20.xml`).getByRole('tab').click();
    await expectWatermarkVisible(page, `switched to ${title}`);
  }
  // XML view and back
  const views = page.getByRole('tablist', { name: 'Show the process as' });
  await views.getByRole('tab', { name: 'XML' }).click();
  await expect(page.locator('.bjs-powered-by:visible')).toHaveCount(0);
  await views.getByRole('tab', { name: 'Extensions JSON' }).click();
  await views.getByRole('tab', { name: 'Diagram' }).click();
  await expectWatermarkVisible(page, 'back from the JSON view');
  // a text tab has no canvas, and none of the others shines through
  await page.getByRole('treeitem', { name: 'project.json', exact: true }).dblclick();
  await expect(page.locator('.bjs-powered-by:visible')).toHaveCount(0);
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expectWatermarkVisible(page, 'back from a text tab');
});

test('U20 toasts and menus do not cover the watermark', async ({ page }) => {
  await setLayout(page, { explorer: true, properties: false, bottom: false, minimap: true });
  // a toast appears bottom left
  await menu(page, 'File', 'New file', 'Scenario file');
  await page.getByTestId('prompt-input').fill('smoke');
  await page.getByTestId('prompt-confirm').click();
  await expect(page.getByTestId('toasts')).toContainText('Created scenarios/smoke.scenario.json');
  await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  await expect(page.getByTestId('toasts')).toBeVisible();
  await expectWatermarkVisible(page, 'a toast is showing');
  // stack several: errors are the longest-lived
  for (let i = 0; i < 3; i += 1) {
    await menu(page, 'File', 'New file', 'Connector definition');
    await page.getByTestId('prompt-input').fill(`conn${i}`);
    await page.getByTestId('prompt-confirm').click();
    await tab(page, 'process.bpmn20.xml').getByRole('tab').click();
  }
  await expect(page.getByTestId('toasts').locator('.toast')).toHaveCount(4);
  await expectWatermarkVisible(page, 'four toasts are showing');
  // an open menu
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await expectWatermarkVisible(page, 'the View menu is open');
  await page.keyboard.press('Escape');
});

test('U20 the watermark stays clear in small windows, where the minimap would otherwise reach it', async ({ page }) => {
  for (const [width, height] of [[900, 560], [760, 480], [1280, 560]] as const) {
    await page.setViewportSize({ width, height });
    for (const state of [
      { explorer: false, properties: false, bottom: true, minimap: true },
      { explorer: true, properties: true, bottom: true, minimap: true },
      { explorer: false, properties: false, bottom: false, minimap: true },
    ]) {
      await setLayout(page, state);
      await expectWatermarkVisible(page, `${width}x${height}, ${label(state)}`);
    }
  }
});

test('U20 in a very narrow window the side panels give way, and the watermark is still clear', async ({ page }) => {
  await setLayout(page, { explorer: true, properties: true, bottom: false, minimap: false });
  await page.setViewportSize({ width: 560, height: 420 });
  await expect(page.getByTestId('explorer')).toBeHidden();
  await expect(page.getByTestId('properties-panel')).toBeHidden();
  await page.keyboard.press('Control+B');
  await menu(page, 'View', 'Minimap');
  await expectWatermarkVisible(page, '560x420, bottom panel and minimap open');
  await page.keyboard.press('Control+B');
  await expectWatermarkVisible(page, '560x420, minimap open');
  // wider again: the panels are back as they were
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('explorer')).toBeVisible();
  await expect(page.getByTestId('properties-panel')).toBeVisible();
  await expectWatermarkVisible(page, 'back at 1280x720');
});

// --- DMN: every view of dmn-js carries the watermark of its own viewer ---------------------------------------------------------

async function newDmnFile(page: Page, template: 'DMN decision table' | 'DMN DRD', name: string): Promise<void> {
  await menu(page, 'File', 'New file', template);
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, `${name}.dmn`)).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('dmn-views')).toBeVisible();
}

const dmnView = (page: Page, id: string) => activePanel(page).getByTestId(`dmn-view-${id}`);

test.describe('DMN', () => {
  // the connection probe of the run feature asks for a modeler server that these tests do not start
  test.use({ allowedErrors: [/Failed to load resource/] });

  test('U20 the watermark is visible on every view of a DMN file (DRD, decision table, literal expression, boxed expression) in every layout', async ({ page }) => {
    await newDmnFile(page, 'DMN DRD', 'marks');
    // a literal expression decision and a business knowledge model next to the two decision tables of the template
    const decision = await placeShape(page, 'create.decision');
    await replaceDecisionWith(page, decision, 'literal-expression');
    const bkm = await placeShape(page, 'create.business-knowledge-model');
    await replaceDecisionWith(page, bkm, 'literal-expression');
    await expect(activePanel(page).getByTestId('dmn-views').locator('button')).toHaveCount(5);
    const chips = await activePanel(page).getByTestId('dmn-views').locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    for (const state of [
      { explorer: true, properties: true, bottom: true },
      { explorer: false, properties: false, bottom: false },
      { explorer: true, properties: false, bottom: true },
      { explorer: false, properties: true, bottom: false },
    ]) {
      await setLayout(page, { ...state, minimap: false });
      for (const chip of chips) {
        await activePanel(page).getByTestId(chip).click();
        await expect(activePanel(page).getByTestId(chip)).toHaveAttribute('aria-selected', 'true');
        await expectWatermarkVisible(page, `${chip}, explorer ${state.explorer ? 'open' : 'closed'}, properties ${state.properties ? 'open' : 'closed'}, bottom ${state.bottom ? 'open' : 'closed'}`);
      }
    }
    // the XML view has no canvas, and the other tabs do not shine through
    await activePanel(page).getByRole('tablist', { name: 'Show the decision model as' }).getByRole('tab', { name: 'XML' }).click();
    await expect(page.locator('.bjs-powered-by:visible')).toHaveCount(0);
    await activePanel(page).getByRole('tablist', { name: 'Show the decision model as' }).getByRole('tab', { name: 'Model' }).click();
    await expectWatermarkVisible(page, 'back from the XML view');
  });

  test('U20 the watermark of a DMN view stays clear with the decision tester open, a toast showing and a small window', async ({ page }) => {
    await newDmnFile(page, 'DMN decision table', 'tested');
    await dmnView(page, 'tested').click();
    await setLayout(page, { explorer: true, properties: true, bottom: true, minimap: false });
    await activePanel(page).getByTestId('dmn-test-decision').click();
    await expect(activePanel(page).getByTestId('decision-tester')).toBeVisible();
    await expectWatermarkVisible(page, 'decision table, tester open');
    await dmnView(page, 'drd').click();
    await expectWatermarkVisible(page, 'DRD, tester open');
    // a toast bottom left
    await menu(page, 'File', 'New file', 'Scenario file');
    await page.getByTestId('prompt-input').fill('smoke');
    await page.getByTestId('prompt-confirm').click();
    await tab(page, 'tested.dmn').getByRole('tab').click();
    await expect(page.getByTestId('toasts')).toBeVisible();
    await expectWatermarkVisible(page, 'a toast is showing');
    for (const [width, height] of [[900, 560], [760, 480]] as const) {
      await page.setViewportSize({ width, height });
      await expectWatermarkVisible(page, `${width}x${height}, tester open`);
    }
  });
});
