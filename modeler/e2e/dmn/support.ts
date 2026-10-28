import { expect, type Locator, type Page } from '@playwright/test';

import { activePanel, idbFiles, menu, openApp, tab } from '../support/app';

export { activePanel, idbFiles, menu, openApp, tab };

/** File > New file > a DMN template, named `name` (`processes/<name>.dmn`); waits until the editor shows the model. */
export async function newDmn(page: Page, template: 'dmn-decision-table' | 'dmn-drd', name: string): Promise<void> {
  await menu(page, 'File', 'New file', template === 'dmn-drd' ? 'DMN DRD' : 'DMN decision table');
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, `${name}.dmn`)).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('dmn-views')).toBeVisible();
  await expect(activePanel(page).locator('.dmn-canvas .djs-container, .dmn-canvas .tjs-container').first()).toBeVisible();
}

/** Opens a DMN file the way a user does: drops it on the page; the tab with the file opens. */
export const canvasOf = (page: Page): Locator => activePanel(page).getByTestId('dmn-canvas');

/** The view chip of a decision or business knowledge model (`drd` for the DRD). */
export const viewChip = (page: Page, id: string): Locator => activePanel(page).getByTestId(`dmn-view-${id}`);

export async function openView(page: Page, id: string): Promise<void> {
  await viewChip(page, id).click();
  await expect(viewChip(page, id)).toHaveAttribute('aria-selected', 'true');
}

// --- the DRD ------------------------------------------------------------------------------------------------------------------

export const drdElement = (page: Page, id: string): Locator => activePanel(page).locator(`.djs-element[data-element-id="${id}"]`);

/** Ids of the shapes (not connections) of the open DRD. */
export async function drdShapeIds(page: Page): Promise<string[]> {
  return activePanel(page).locator('.djs-element.djs-shape[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? ''));
}

export async function drdConnectionIds(page: Page): Promise<string[]> {
  return activePanel(page).locator('.djs-element.djs-connection[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? ''));
}

/**
 * A spot of the open DRD where a new element fits without touching another one, in canvas coordinates: the first free one, scanning rows
 * from the top left of the canvas (right of the palette). `skip` leaves out spots that were taken since (the DRD does not show them yet).
 */
export async function freeSpot(page: Page, skip: Array<{ x: number; y: number }> = []): Promise<{ x: number; y: number }> {
  const box = (await canvasOf(page).boundingBox())!;
  const spot = await page.evaluate(
    ({ left, top, width, height, taken }) => {
      const occupied = (x: number, y: number): boolean => {
        for (const dx of [-110, -55, 0, 55, 110]) {
          for (const dy of [-60, -30, 0, 30, 60]) {
            const px = left + x + dx;
            const py = top + y + dy;
            if (document.elementsFromPoint(px, py).some((el) => el.closest('.djs-element, .djs-palette, .dmn-js-parent .djs-container > svg ~ *, .definitions') && !el.closest('.djs-container > svg > defs'))) return true;
          }
        }
        return false;
      };
      for (let y = 110; y < height - 80; y += 70) {
        for (let x = 190; x < width - 130; x += 70) {
          if (taken.some((t) => Math.abs(t.x - x) < 190 && Math.abs(t.y - y) < 110)) continue;
          if (!occupied(x, y)) return { x, y };
        }
      }
      return undefined;
    },
    { left: box.x, top: box.y, width: box.width, height: box.height, taken: skip },
  );
  if (!spot) throw new Error('no free spot on the DRD');
  return spot;
}

/** Spots taken per page: a test gets a new page, and the worker keeps this module between tests. */
const placedByPage = new WeakMap<Page, Array<{ x: number; y: number }>>();

/** diagram-js swallows the first click after a create or connect gesture: a click on an empty spot at the top right of the canvas takes it. */
export async function swallowClick(page: Page): Promise<void> {
  const box = (await canvasOf(page).boundingBox())!;
  await page.mouse.click(box.x + box.width - 40, box.y + 30);
}

/** Palette tool (`create.decision`, `create.input-data`, ...), then a click on a free spot of the canvas; returns the id of the new shape. */
export async function placeShape(page: Page, tool: string, at?: { x: number; y: number }): Promise<string> {
  const before = new Set(await drdShapeIds(page));
  const placed = placedByPage.get(page) ?? [];
  placedByPage.set(page, placed);
  const { x, y } = at ?? (await freeSpot(page, placed));
  placed.push({ x, y });
  await activePanel(page).locator(`.djs-palette [data-action="${tool}"]`).click();
  const box = (await canvasOf(page).boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await page.mouse.click(box.x + x, box.y + y);
  await expect.poll(async () => (await drdShapeIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  await swallowClick(page);
  return (await drdShapeIds(page)).find((id) => !before.has(id))!;
}

/** Selects a shape of the DRD so that its context pad shows (a click on a selected shape would deselect it). */
export async function selectShape(page: Page, id: string): Promise<void> {
  if (!/\bselected\b/.test((await drdElement(page, id).getAttribute('class')) ?? '')) await drdElement(page, id).locator('.djs-hit').first().click();
  await expect(drdElement(page, id)).toHaveClass(/\bselected\b/);
  await expect(activePanel(page).locator('.djs-context-pad.open')).toBeVisible();
}

/** Selects an element of the open view through the editor's selection service (for a connection, whose click point is hard to find). */
export async function selectById(page: Page, path: string, id: string): Promise<void> {
  await page.evaluate(
    ([file, elementId]) => {
      const modeler = (window as unknown as { __dmnEditors: Map<string, { getActiveViewer(): { get(name: string): { get(id: string): unknown; select(el: unknown): void } } }> }).__dmnEditors.get(file as string)!;
      const viewer = modeler.getActiveViewer();
      viewer.get('selection').select(viewer.get('elementRegistry').get(elementId as string));
      // the keys of the DRD (Delete, Ctrl+Z) work while the canvas has the focus
      (viewer.get('canvas') as unknown as { focus(): void }).focus();
    },
    [path, id],
  );
  await expect(drdElement(page, id)).toHaveClass(/\bselected\b/);
}

export const padEntry = (page: Page, action: string): Locator => activePanel(page).locator(`.djs-context-pad [data-action="${action}"]`);

/** Draws a connection with the context pad of the source: connect, then click the target. Returns the id of the new connection. */
export async function connect(page: Page, source: string, target: string): Promise<string> {
  const before = new Set(await drdConnectionIds(page));
  await selectShape(page, source);
  await padEntry(page, 'connect').click();
  const box = (await drdElement(page, target).locator('.djs-hit').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await drdConnectionIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  await swallowClick(page);
  return (await drdConnectionIds(page)).find((id) => !before.has(id))!;
}

/** Names a shape: double click, type, click on an empty spot of the canvas. */
export async function renameShape(page: Page, id: string, name: string): Promise<void> {
  await drdElement(page, id).locator('.djs-hit').first().dblclick();
  await expect(activePanel(page).locator('.djs-direct-editing-parent')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name);
  const box = (await canvasOf(page).boundingBox())!;
  await page.mouse.click(box.x + box.width - 60, box.y + box.height - 120);
  await expect(activePanel(page).locator('.djs-direct-editing-parent')).toHaveCount(0);
}

/** The Replace entry of the context pad: the decision becomes a decision table or a literal expression. */
export async function replaceDecisionWith(page: Page, id: string, kind: 'decision-table' | 'literal-expression'): Promise<void> {
  await selectShape(page, id);
  await padEntry(page, 'replace').click();
  await page.locator(`.djs-popup .entry[data-id="replace-with-${kind}"]`).click();
}

// --- the decision table -------------------------------------------------------------------------------------------------------

/** The cell of a rule and a column: row id is the rule id, col id the id of the input or output column. */
export const cellEditor = (page: Page, rule: string, column: string): Locator => activePanel(page).locator(`td[data-row-id="${rule}"][data-col-id="${column}"]`);

/** Clicks a cell, which focuses its editor (an empty one has no size to click), and replaces its text. */
export async function typeInto(page: Page, cell: Locator, text: string): Promise<void> {
  await cell.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
}

/** Waits until dmn-js has executed every edit typed so far: it executes an edit a short moment after the last key (its input delay). */
export async function inputSettled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dmnPendingInput(): number }).__dmnPendingInput())).toBe(0);
}

/** Leaves the cell that is being edited, and waits until dmn-js has executed the edit. */
export async function leaveCell(page: Page): Promise<void> {
  await activePanel(page).locator('.tjs-table thead .index-column').first().click();
  await inputSettled(page);
}

export async function selectHitPolicy(page: Page, label: string): Promise<void> {
  await activePanel(page).locator('.hit-policy-edit-policy-select .dms-input').click();
  await activePanel(page).locator('.dms-select-options, .dms-input-select').getByText(label, { exact: true }).last().click();
}

export const hitPolicyText = (page: Page): Promise<string> => activePanel(page).locator('.hit-policy-edit-policy-select .dms-input').innerText();

// --- saving -------------------------------------------------------------------------------------------------------------------

/** Ctrl+S, then the text of the file as it is stored in the browser workspace. */
export async function saveAndRead(page: Page, title: string, path: string): Promise<string> {
  await page.keyboard.press('Control+S');
  await expect(tab(page, title), `the tab after Save (toasts: ${await page.getByTestId('toasts').innerText().catch(() => '')})`).not.toHaveClass(/dirty/);
  return (await idbFiles(page))[path]!;
}

/** Every `attr="value"` of `name` elements in an XML text: `attrs(xml, 'rule', 'id')`. */
export function attrs(xml: string, element: string, attribute: string): string[] {
  return [...xml.matchAll(new RegExp(`<${element}\\b[^>]*?\\b${attribute}="([^"]*)"`, 'g'))].map((m) => m[1]!);
}

// --- column and rule editing --------------------------------------------------------------------------------------------------

/** The header cell of the n-th input (0 based) or output of the open decision table. */
export const inputHeader = (page: Page, index: number): Locator => activePanel(page).locator('th.input-cell').nth(index);
export const outputHeader = (page: Page, index: number): Locator => activePanel(page).locator('th.output-cell').nth(index);

/** The hover-only edit button sits under the drag handle: it is clicked by dispatching the event. */
export async function openColumnEditor(header: Locator): Promise<void> {
  await header.locator('.edit-button').dispatchEvent('click');
}

/** The popup of the column editor (label, expression or name, type, allowed values). */
export const columnPopup = (page: Page): Locator => page.locator('.context-menu').first();

export async function addInputRight(page: Page, index: number): Promise<void> {
  const before = await activePanel(page).locator('th.input-cell').count();
  await inputHeader(page, index).locator('.add-input button').dispatchEvent('click');
  await expect(activePanel(page).locator('th.input-cell')).toHaveCount(before + 1);
}

export async function addOutputRight(page: Page, index: number): Promise<void> {
  const before = await activePanel(page).locator('th.output-cell').count();
  await outputHeader(page, index).locator('.add-output button').dispatchEvent('click');
  await expect(activePanel(page).locator('th.output-cell')).toHaveCount(before + 1);
}

export async function addRuleAtEnd(page: Page): Promise<void> {
  const before = await activePanel(page).locator('td.rule-index').count();
  await activePanel(page).locator('.add-rule-add button').click();
  await expect(activePanel(page).locator('td.rule-index')).toHaveCount(before + 1);
}

/** The ids of the rules of the open table, in row order. */
export async function ruleIds(page: Page): Promise<string[]> {
  return activePanel(page).locator('td.rule-index').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
}

export async function ruleMenu(page: Page, ruleIndex: number, entry: 'copy-rule' | 'cut-rule' | 'paste-rule-above' | 'paste-rule-below' | 'add-rule-above' | 'add-rule-below' | 'remove-rule'): Promise<void> {
  await activePanel(page).locator('td.rule-index').nth(ruleIndex).click({ button: 'right' });
  await page.locator(`.context-menu-entry-${entry}`).click();
}

/** The texts of the cells of a rule, input cells first. */
export async function ruleCells(page: Page, ruleId: string): Promise<string[]> {
  return activePanel(page).locator(`td.cell[data-row-id="${ruleId}"]:not(.annotation) .content-editable`).evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
}
