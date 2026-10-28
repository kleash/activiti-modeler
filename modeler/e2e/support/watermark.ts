import { expect, type Page } from '@playwright/test';

/**
 * bpmn.io licence: the watermark must be fully visible and not overlapped by anything (palette, minimap, panels, status bar,
 * toasts). Checks the visible canvas: one watermark, inside the viewport, the topmost element at its centre and corners, and not
 * dimmed. `state` names the layout state in the failure message; `scope` is the container of the canvas (the editor panel by default, the run views pass their own).
 */
export async function expectWatermarkVisible(page: Page, state: string, scope = '.editor-panel.active'): Promise<void> {
  const watermark = page.locator(`${scope} .bjs-powered-by`);
  await expect(watermark, `watermark (${state})`).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await watermark.boundingBox())!;
  expect(box.width, `watermark width (${state})`).toBeGreaterThan(0);
  expect(box.x, `watermark left edge (${state})`).toBeGreaterThanOrEqual(0);
  expect(box.y, `watermark top edge (${state})`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `watermark right edge (${state})`).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, `watermark bottom edge (${state})`).toBeLessThanOrEqual(viewport.height);

  const covered = await watermark.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + 2, rect.top + 2],
      [rect.right - 2, rect.top + 2],
      [rect.left + 2, rect.bottom - 2],
      [rect.right - 2, rect.bottom - 2],
    ] as const;
    return points
      .map(([x, y]) => document.elementFromPoint(x, y))
      .map((top) => (top !== null && (top === el || el.contains(top)) ? null : `${top?.tagName}.${top?.className}`))
      .filter((c): c is string => c !== null);
  });
  expect(covered, `elements covering the watermark (${state})`).toEqual([]);

  const style = await watermark.evaluate((el) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    const computed = getComputedStyle(el);
    return { opacity, visibility: computed.visibility, display: computed.display };
  });
  expect(style, `watermark style (${state})`).toEqual({ opacity: 1, visibility: 'visible', display: expect.not.stringMatching(/none/) });
}
