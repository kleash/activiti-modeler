import { expect, type Locator, type Page } from '@playwright/test';

/** Opens the app and waits until the first diagram is on the canvas. */
export async function openApp(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
}

/**
 * Reloads the page and waits until the first diagram is on the canvas again. A key pressed before that is lost: the shortcuts are
 * registered when the shell mounts, which comes after the page has loaded and the workspace is read from IndexedDB.
 */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
}

/** The visible tab's editor panel. */
export const activePanel = (page: Page): Locator => page.locator('.editor-panel.active');

export const tab = (page: Page, title: string): Locator => page.getByTestId(`tab-${title}`);

export const activeTabTitle = async (page: Page): Promise<string> => (await page.locator('.tab.active .tab-label').innerText()).trim();

/** A BPMN element of the visible diagram. */
export const element = (page: Page, id: string): Locator => activePanel(page).locator(`.djs-element[data-element-id="${id}"]`);

export const selected = (page: Page): Locator => activePanel(page).locator('.djs-element.selected');

/**
 * Pastes the clipboard so that the elements land at `point` of the visible diagram (a blank spot), as a person does: the pointer
 * rests on that spot, then Ctrl+V, then a click drops the elements. The pointer must not rest in the border of the canvas (where the
 * click that focuses it would go): while elements are being placed the canvas scrolls by itself under a pointer there, by an amount
 * that depends on how long the machine takes to deliver the next mouse move, and the diagram then moves under the drop point. The
 * native paste reads the system clipboard first, so placing starts a moment after the key: the click waits for it.
 */
export async function pasteAt(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Control+V');
  await expect(activePanel(page).locator('.djs-drag-group').first()).toBeAttached();
  const drop = { x: point.x + 30, y: point.y + 20 };
  await page.mouse.move(drop.x, drop.y, { steps: 3 });
  await page.mouse.click(drop.x, drop.y);
}

export async function menu(page: Page, title: string, ...path: string[]): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: title, exact: true }).click();
  for (const [i, label] of path.entries()) {
    const item = page.getByRole('menu').getByRole(/^(Minimap|Grid|Project explorer|Properties panel|Bottom panel)$/.test(label) ? 'menuitemcheckbox' : 'menuitem', { name: label, exact: true });
    // a submenu opens when it is hovered; only the last entry is clicked
    if (i < path.length - 1) await item.hover();
    else await item.click();
  }
}

/** Reads the files of a project of the browser workspace straight from IndexedDB (not through the app). */
export async function idbFiles(page: Page, project?: string): Promise<Record<string, string>> {
  const name = project ?? (await page.getByTestId('project-name').innerText());
  return page.evaluate(
    (projectName) =>
      new Promise<Record<string, string>>((resolve, reject) => {
        const open = indexedDB.open('activiti-modeler');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('files').objectStore('files').index('byProject').getAll(projectName);
          request.onsuccess = () => {
            db.close();
            resolve(Object.fromEntries((request.result as Array<{ path: string; content: string }>).map((r) => [r.path, r.content])));
          };
          request.onerror = () => reject(request.error);
        };
      }),
    name,
  );
}

/** Waits until the session record of the app (the open tabs, written a moment after a tab changes) shows `path` as the active tab. */
export async function waitForSession(page: Page, path: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((resolve, reject) => {
            const open = indexedDB.open('activiti-modeler');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const request = db.transaction('meta').objectStore('meta').getAll();
              request.onsuccess = () => {
                db.close();
                const sessions = (request.result as Array<{ key: string; value: { active?: string } }>).filter((r) => r.key.startsWith('session:'));
                resolve(sessions[0]?.value.active);
              };
              request.onerror = () => reject(request.error);
            };
          }),
      ),
    )
    .toBe(path);
}

export async function idbProjects(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('activiti-modeler');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('projects').objectStore('projects').getAllKeys();
          request.onsuccess = () => {
            db.close();
            resolve(request.result as string[]);
          };
        };
      }),
  );
}

export async function idbDrafts(page: Page, project?: string): Promise<Record<string, string>> {
  const name = project ?? (await page.getByTestId('project-name').innerText());
  return page.evaluate(
    (projectName) =>
      new Promise<Record<string, string>>((resolve, reject) => {
        const open = indexedDB.open('activiti-modeler');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('drafts').objectStore('drafts').index('byScope').getAll(`idb:${projectName}`);
          request.onsuccess = () => {
            db.close();
            resolve(Object.fromEntries((request.result as Array<{ path: string; content: string }>).map((r) => [r.path, r.content])));
          };
          request.onerror = () => reject(request.error);
        };
      }),
    name,
  );
}

/** Replaces the whole text of a CodeMirror editor by typing into it (select all, then insert). */
export async function setEditorText(page: Page, testId: string, text: string): Promise<void> {
  const content = activePanel(page).getByTestId(testId).locator('.cm-content');
  await content.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

/** The text of a CodeMirror editor (the visible lines; the documents in these tests are short). */
export async function editorText(page: Page, testId: string): Promise<string> {
  return activePanel(page).getByTestId(testId).locator('.cm-content').evaluate((el) => Array.from(el.querySelectorAll('.cm-line')).map((l) => l.textContent ?? '').join('\n'));
}

/** Dispatches a `drop` of the given files on the page, like dragging them from the file manager. */
export async function dropFiles(page: Page, files: Array<{ name: string; content: string | Buffer; type?: string }>): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, base64: Buffer.from(f.content).toString('base64'), type: f.type ?? '' }));
  await page.evaluate((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type }));
    }
    const target = document.querySelector('.shell') ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
}

/** A BPMN document with the given process id and elements laid out left to right (ids `start`, `task1`, ..., `end`). */
export function processXml(id: string, shapes: Array<{ id: string; type: string; name?: string; x: number; y: number }>, extra = ''): string {
  const size = (type: string): [number, number] => (type.endsWith('Event') ? [36, 36] : type.endsWith('Gateway') ? [50, 50] : [100, 80]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_${id}" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="${id}" isExecutable="true">
${shapes.map((s) => `    <bpmn:${s.type} id="${s.id}"${s.name ? ` name="${s.name}"` : ''} />`).join('\n')}${extra}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${id}" bpmnElement="${id}">
${shapes.map((s) => `      <bpmndi:BPMNShape id="${s.id}_di" bpmnElement="${s.id}"><dc:Bounds x="${s.x}" y="${s.y}" width="${size(s.type)[0]}" height="${size(s.type)[1]}" /></bpmndi:BPMNShape>`).join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/** Waits until the draft autosave has written `path` (or, with `until`, until the draft satisfies it). */
export async function waitForDraft(page: Page, path: string, until: (content: string) => boolean = () => true): Promise<string> {
  let content = '';
  await expect
    .poll(async () => {
      content = (await idbDrafts(page))[path] ?? '';
      return content !== '' && until(content);
    }, { message: `a draft of ${path}`, timeout: 10_000 })
    .toBe(true);
  return content;
}

/** Smallest x and y of the shapes and waypoints in the BPMN diagram of an XML text. */
export function minCoordinates(xml: string): { x: number; y: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of xml.matchAll(/<(?:dc:Bounds|di:waypoint)\b[^>]*?\bx="(-?[\d.]+)"[^>]*?\by="(-?[\d.]+)"/g)) {
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position and size of a shape of the visible diagram in diagram coordinates (not screen pixels): from the shape's own transform. */
export async function shapeBox(page: Page, id: string): Promise<Box> {
  return element(page, id).evaluate((el) => {
    const match = /matrix\(1 0 0 1 (-?[\d.]+) (-?[\d.]+)\)/.exec(el.getAttribute('transform') ?? '');
    const hit = el.querySelector('.djs-hit');
    const rect = hit ? { width: Number(hit.getAttribute('width')), height: Number(hit.getAttribute('height')) } : { width: 0, height: 0 };
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0), ...rect };
  });
}

/** Screen centre of a shape of the visible diagram. */
export async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = (await element(page, id).locator('.djs-visual').first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Scale of the visible canvas (1 = 100 %). */
export async function canvasScale(page: Page): Promise<number> {
  return activePanel(page).locator('svg > .viewport, .djs-container svg > g.viewport').first().evaluate((el) => {
    const m = /matrix\(\s*([-\d.e]+)[ ,]/.exec(el.getAttribute('transform') ?? '');
    return Number(m?.[1] ?? 1);
  });
}
