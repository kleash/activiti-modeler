import { readFile } from 'node:fs/promises';

import { type Page, expect } from '@playwright/test';
import { test } from './support/test';
import { strFromU8, unzipSync } from 'fflate';

import { activePanel, editorText, element, idbDrafts, idbFiles, idbProjects, menu, openApp, reloadApp, tab, waitForDraft, waitForSession } from './support/app';

const treeItem = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });

async function palettePlaceTask(page: Page, at: { x: number; y: number }): Promise<void> {
  await activePanel(page).locator('.djs-palette [data-action="create.task"]').click();
  const canvas = (await activePanel(page).getByTestId('bpmn-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + at.x, canvas.y + at.y, { steps: 4 });
  await page.mouse.click(canvas.x + at.x, canvas.y + at.y);
  // a new element opens its label for editing; leave that mode so that keys reach the shell again
  await page.keyboard.press('Escape');
}

test.describe('U3 browser workspace (IndexedDB)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('U3 the project is stored in IndexedDB and is there after a reload, with its open tabs', async ({ page }) => {
    expect(await idbProjects(page)).toEqual(['my-project']);
    const files = await idbFiles(page);
    expect(Object.keys(files).sort()).toEqual(['processes/process-extensions.json', 'processes/process.bpmn20.xml', 'project.json']);
    expect(JSON.parse(files['project.json']!)).toMatchObject({ name: 'my-project', activiti: '9.0.0' });

    await treeItem(page, 'project.json').dblclick();
    await expect(tab(page, 'project.json')).toHaveClass(/active/);
    // the session is written a moment after the last tab change
    await waitForSession(page, 'project.json');
    await page.reload();
    await expect(page.getByTestId('project-name')).toHaveText('my-project');
    await expect(tab(page, 'project.json')).toHaveClass(/active/);
    await expect(tab(page, 'process.bpmn20.xml')).toBeVisible();
    expect(await idbProjects(page)).toEqual(['my-project']);
  });

  test('U3 new projects, switching between them and the recent projects list', async ({ page }) => {
    await menu(page, 'File', 'New project…');
    await page.getByTestId('prompt-input').fill('second');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('project-name')).toHaveText('second');
    expect(await idbProjects(page)).toEqual(['my-project', 'second']);
    await expect(page.getByTestId('status-storage')).toHaveText('Browser workspace: second');

    // the last project is the one that opens after a reload
    await reloadApp(page);
    await expect(page.getByTestId('project-name')).toHaveText('second');

    await page.keyboard.press('Control+O');
    const list = page.getByTestId('project-list');
    await expect(list.getByRole('button', { name: /^my-project/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /^second/ })).toContainText('open');
    // the recent projects: the last opened first
    // the dialog opens after the lists are read from IndexedDB, a moment after the key
    const recent = page.getByTestId('recent-list').getByRole('button');
    const recentNames = async () => (await recent.allInnerTexts()).map((t) => t.split('\n')[0]);
    await expect.poll(recentNames).toEqual(['second', 'my-project']);
    await recent.nth(1).click();
    await expect(page.getByTestId('project-name')).toHaveText('my-project');
    await expect(element(page, 'StartEvent_1')).toBeVisible();
    await page.keyboard.press('Control+O');
    await expect.poll(recentNames).toEqual(['my-project', 'second']);
    await page.keyboard.press('Escape');

    // a project name that exists is refused
    await menu(page, 'File', 'New project…');
    await page.getByTestId('prompt-input').fill('bad/name');
    await expect(page.getByTestId('prompt-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('U3 deleting a project removes its files', async ({ page }) => {
    await menu(page, 'File', 'New project…');
    await page.getByTestId('prompt-input').fill('scratch');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('project-name')).toHaveText('scratch');
    await page.keyboard.press('Control+O');
    await page.getByRole('button', { name: 'Delete project scratch' }).click();
    await page.getByTestId('choice-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => idbProjects(page)).toEqual(['my-project']);
    await expect(page.getByTestId('project-name')).toHaveText('my-project');
    expect(Object.keys(await idbFiles(page, 'scratch'))).toEqual([]);
  });

  test('U3 autosave keeps a draft of unsaved text and the reload recovers it', async ({ page }) => {
    await treeItem(page, 'project.json').dblclick();
    await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n\n');
    const draft = await waitForDraft(page, 'project.json');
    expect(draft.endsWith('\n\n\n\n')).toBe(true);
    // the file itself is untouched until it is saved
    expect((await idbFiles(page))['project.json']!.endsWith('}\n')).toBe(true);
    await waitForSession(page, 'project.json');

    await page.reload();
    await expect(page.getByTestId('toasts')).toContainText('Recovered unsaved changes in 1 file(s)');
    await expect(tab(page, 'project.json')).toHaveClass(/dirty/);
    await tab(page, 'project.json').getByRole('tab').click();
    expect((await editorText(page, 'text-editor')).split('\n').length).toBeGreaterThan(5);

    // saving writes the recovered text and removes the draft
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'project.json')).not.toHaveClass(/dirty/);
    expect((await idbFiles(page))['project.json']).toBe(draft);
    expect(await idbDrafts(page)).toEqual({});
  });

  test('U3 autosave keeps a draft of an unsaved diagram and the reload recovers it', async ({ page }) => {
    await palettePlaceTask(page, { x: 400, y: 250 });
    await expect(activePanel(page).locator('.djs-element[data-element-id^="Activity_"]')).toHaveCount(1);
    await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);
    const draft = await waitForDraft(page, 'processes/process.bpmn20.xml', (xml) => xml.includes('bpmn:task'));
    expect(draft).toContain('<bpmn:task id="Activity_');
    expect((await idbFiles(page))['processes/process.bpmn20.xml']).not.toContain('bpmn:task');
    await waitForSession(page, 'processes/process.bpmn20.xml');

    await page.reload();
    await expect(page.getByTestId('toasts')).toContainText('Recovered unsaved changes');
    await expect(activePanel(page).locator('.djs-element[data-element-id^="Activity_"]')).toHaveCount(1);
    await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);

    // undoing back to the saved state is possible only in the session that made the change; saving now keeps the task
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
    expect((await idbFiles(page))['processes/process.bpmn20.xml']).toContain('<bpmn:task id="Activity_');
    expect(await idbDrafts(page)).toEqual({});
  });

  test('U3 discarding a tab removes its draft, so nothing comes back after a reload', async ({ page }) => {
    await palettePlaceTask(page, { x: 400, y: 250 });
    await waitForDraft(page, 'processes/process.bpmn20.xml', (xml) => xml.includes('bpmn:task'));
    await page.keyboard.press('Control+W');
    await page.getByTestId('choice-dialog').getByRole('button', { name: "Don't save" }).click();
    expect(await idbDrafts(page)).toEqual({});
    await page.reload();
    await expect(page.getByTestId('toasts').getByText('Recovered')).toHaveCount(0);
  });

  test('U3 zip export equals the project, and the zip imports as a new project', async ({ page }, testInfo) => {
    // make the project a bit richer: a template with companion files
    await menu(page, 'File', 'New file', 'Decision task');
    await page.getByTestId('prompt-input').fill('route');
    await page.getByTestId('prompt-confirm').click();
    await expect(tab(page, 'route.bpmn20.xml')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await menu(page, 'File', 'Export project as zip');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('my-project.zip');
    const zipPath = testInfo.outputPath('export.zip');
    await download.saveAs(zipPath);

    const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
    const zipped = Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, strFromU8(bytes)]));
    // the zip holds exactly the files of the project, byte for byte, at the root (ADR 0003 layout)
    expect(zipped).toEqual(await idbFiles(page));
    expect(Object.keys(zipped)).toEqual(expect.arrayContaining(['project.json', 'processes/route.bpmn20.xml', 'processes/route-extensions.json', 'processes/route-rules.dmn']));

    // import it through the projects dialog
    await page.keyboard.press('Control+O');
    await page.getByTestId('projects-zip-input').setInputFiles(zipPath);
    await expect(page.getByTestId('project-name')).toHaveText('my-project-2');
    await expect(page.getByTestId('toasts')).toContainText('Imported 6 file(s) as project "my-project-2"');
    expect(await idbFiles(page)).toEqual(zipped);
    expect(await idbProjects(page)).toEqual(['my-project', 'my-project-2']);
  });

  test('U3 export saves unsaved edits first, so the zip is what is on the screen', async ({ page }, testInfo) => {
    await palettePlaceTask(page, { x: 400, y: 250 });
    await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/dirty/);
    const downloadPromise = page.waitForEvent('download');
    await menu(page, 'File', 'Export project as zip');
    const download = await downloadPromise;
    await download.saveAs(testInfo.outputPath('export.zip'));
    const entries = unzipSync(new Uint8Array(await readFile(testInfo.outputPath('export.zip'))));
    expect(strFromU8(entries['processes/process.bpmn20.xml']!)).toContain('<bpmn:task id="Activity_');
    await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
  });
});

test.describe('U3 browser without IndexedDB', () => {
  test.use({ allowedErrors: [/IndexedDB|indexedDB/] });

  test('U3 the project then lives in memory with a warning, and can still be edited, saved and exported', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    await page.goto('/');
    await page.locator('.editor-panel.active .djs-container svg .djs-element').first().waitFor();
    await expect(page.getByTestId('toasts')).toContainText('Browser storage is not available');
    await expect(page.getByTestId('status-storage')).toHaveText('Memory: my-project');

    await palettePlaceTask(page, { x: 420, y: 250 });
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'process.bpmn20.xml')).not.toHaveClass(/dirty/);
    const downloadPromise = page.waitForEvent('download');
    await menu(page, 'File', 'Export project as zip');
    const download = await downloadPromise;
    await download.saveAs(testInfo.outputPath('memory.zip'));
    const zipped = unzipSync(new Uint8Array(await readFile(testInfo.outputPath('memory.zip'))));
    expect(strFromU8(zipped['processes/process.bpmn20.xml']!)).toContain('<bpmn:task id="Activity_');
    // the projects dialog explains that nothing can be created
    await menu(page, 'File', 'New project…');
    await expect(page.getByTestId('alert-dialog')).toContainText('Browser storage is not available');
  });
});

test.describe('U3 local folder (File System Access API)', () => {
  test.beforeEach(async ({ page }) => {
    // The picker needs a person, so the test hands over a folder of the origin private file system: real handles with the real
    // read / write semantics, wrapped in plain objects (headless Chromium crashes when a handle of that file system is read back
    // from IndexedDB, so the app must cope with a handle it cannot store; it does, see "recent" below).
    await page.addInitScript(() => {
      const wrap = (h: FileSystemHandle & Record<string, never>): unknown => ({
        kind: h.kind,
        name: h.name,
        entries: async function* () {
          for await (const [name, child] of (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) yield [name, wrap(child as never)];
        },
        getDirectoryHandle: async (name: string, options?: unknown) => wrap((await (h as unknown as FileSystemDirectoryHandle).getDirectoryHandle(name, options as never)) as never),
        getFileHandle: async (name: string, options?: unknown) => wrap((await (h as unknown as FileSystemDirectoryHandle).getFileHandle(name, options as never)) as never),
        removeEntry: (name: string, options?: unknown) => (h as unknown as FileSystemDirectoryHandle).removeEntry(name, options as never),
        queryPermission: (d: unknown) => (h as unknown as { queryPermission(d: unknown): Promise<string> }).queryPermission(d),
        requestPermission: (d: unknown) => (h as unknown as { requestPermission(d: unknown): Promise<string> }).requestPermission(d),
        getFile: () => (h as unknown as FileSystemFileHandle).getFile(),
        createWritable: () => (h as unknown as FileSystemFileHandle).createWritable(),
      });
      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return wrap((await root.getDirectoryHandle('local-demo', { create: true })) as never);
      };
    });
    await openApp(page);
  });

  const writeLocal = (page: Page, files: Record<string, string>) =>
    page.evaluate(async (entries) => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('local-demo', { create: true });
      for (const [path, content] of Object.entries(entries)) {
        const segments = path.split('/');
        let dir = root;
        for (const s of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
        const writable = await (await dir.getFileHandle(segments[segments.length - 1]!, { create: true })).createWritable();
        await writable.write(content);
        await writable.close();
      }
    }, files);

  /**
   * The text files of the folder, read straight from the origin private file system. The app writes and deletes in the same folder
   * while the tests poll it (a new file appears, a deleted one goes), so an entry can vanish between listing it and reading it: that
   * is a NotFoundError of getFile() / entries(), and it means "not there (yet / any more)", not a failure of the read.
   */
  const readLocal = (page: Page): Promise<Record<string, string>> =>
    page.evaluate(async () => {
      const out: Record<string, string> = {};
      const gone = (e: unknown): boolean => e instanceof DOMException && e.name === 'NotFoundError';
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        try {
          for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
            if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
            else {
              try {
                out[`${prefix}${name}`] = await (await (handle as FileSystemFileHandle).getFile()).text();
              } catch (e) {
                if (!gone(e)) throw e;
              }
            }
          }
        } catch (e) {
          if (!gone(e)) throw e;
        }
      };
      await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('local-demo', { create: true }), '');
      return out;
    });

  test('U3 opens a local folder, edits and saves files in place, and creates files in it', async ({ page }) => {
    await writeLocal(page, {
      'project.json': '{"name":"local-demo"}\n',
      'notes/readme.md': '# hello\n',
      'processes/hello.bpmn20.xml': (await idbFiles(page))['processes/process.bpmn20.xml']!.replaceAll('Process_1', 'hello'),
      'logo.png': 'not text',
    });
    await menu(page, 'File', 'Open local folder…');
    await expect(page.getByTestId('project-name')).toHaveText('local-demo');
    await expect(page.getByTestId('status-storage')).toHaveText('Local folder: local-demo');
    await expect(treeItem(page, 'hello.bpmn20.xml')).toBeVisible();
    await expect(treeItem(page, 'readme.md')).toBeVisible();
    // only text files are part of a project
    await expect(treeItem(page, 'logo.png')).toHaveCount(0);

    // edit a file and save: the folder changes in place
    await treeItem(page, 'project.json').dblclick();
    await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n');
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'project.json')).not.toHaveClass(/dirty/);
    expect((await readLocal(page))['project.json']).toBe('{"name":"local-demo"}\n\n');

    // the diagram saves its process and the extensions file next to it
    await treeItem(page, 'hello.bpmn20.xml').dblclick();
    await expect(tab(page, 'hello.bpmn20.xml')).toHaveClass(/active/);
    // the diagram is imported asynchronously: a task placed before that is wiped by the import and the tab never gets dirty
    await expect(activePanel(page).locator('.djs-element').first()).toBeAttached();
    await palettePlaceTask(page, { x: 420, y: 260 });
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'hello.bpmn20.xml')).not.toHaveClass(/dirty/);
    const local = await readLocal(page);
    expect(local['processes/hello.bpmn20.xml']).toContain('<bpmn:task id="Activity_');
    expect(JSON.parse(local['processes/hello-extensions.json']!).extensions).toHaveProperty('hello');
    expect(local['notes/readme.md']).toBe('# hello\n');

    // a new file lands in the folder
    await menu(page, 'File', 'New file', 'Scenario file');
    await page.getByTestId('prompt-input').fill('check');
    await page.getByTestId('prompt-confirm').click();
    await expect.poll(async () => Object.keys(await readLocal(page))).toContain('scenarios/check.scenario.json');
    // renaming and deleting go to the folder too
    await treeItem(page, 'check.scenario.json').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByTestId('choice-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => Object.keys(await readLocal(page))).not.toContain('scenarios/check.scenario.json');
    // the browser workspace is untouched
    expect(await idbProjects(page)).toEqual(['my-project']);
  });
});

test.describe('U3 browser without the File System Access API', () => {
  test('U3 the local folder entry is disabled and the browser workspace and zip stay available', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });
    await openApp(page);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Open local folder…' })).toBeDisabled();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Import project zip…' })).toBeEnabled();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Export project as zip' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+O');
    await expect(page.getByRole('button', { name: 'Open local folder…' })).toBeDisabled();
  });
});

test.describe('U3 server workspace', () => {
  // the unreachable server is on purpose: the browser logs the refused connection
  test.use({ allowedErrors: [/Failed to load resource/] });

  test('U3 opens a project of the modeler server workspace, saves files back through PUT, and reports an unreachable server', async ({ page }) => {
    // a mock of GET/PUT/DELETE /api/dev/workspace/** as activiti-runtime-rest-dev serves it: a workspace of project folders, entry paths
    // relative to the workspace root
    const files = new Map<string, string>([
      ['shop/project.json', '{"name":"shop"}\n'],
      ['shop/processes/remote.dmn', '<definitions/>\n'],
      ['shop/connectors/crm.json', '{"name":"crm"}\n'],
      ['other/project.json', '{}\n'],
    ]);
    const requests: string[] = [];
    await page.route('**/api/dev/workspace**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = decodeURIComponent(url.pathname.replace(/^\/api\/dev\/workspace\/?/, ''));
      requests.push(`${request.method()} /${path}${url.search}`);
      if (request.method() === 'PUT') {
        const created = !files.has(path);
        files.set(path, request.postData() ?? '');
        return route.fulfill({ status: created ? 201 : 204 });
      }
      if (request.method() === 'DELETE') {
        files.delete(path);
        return route.fulfill({ status: 204 });
      }
      const dirs = new Set<string>();
      for (const f of files.keys()) {
        const parts = f.split('/');
        for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
      }
      if (path === '' || dirs.has(path)) {
        const prefix = path === '' ? '' : `${path}/`;
        const recursive = url.searchParams.get('recursive') === 'true';
        const inside = (p: string) => p.startsWith(prefix) && p !== path && (recursive || !p.slice(prefix.length).includes('/'));
        const entries = [
          ...[...dirs].filter(inside).sort().map((p) => ({ path: p, type: 'directory' })),
          ...[...files.keys()].filter(inside).sort().map((p) => ({ path: p, type: 'file', size: files.get(p)!.length })),
        ];
        return route.fulfill({ json: { path, entries } });
      }
      const content = files.get(path);
      return content === undefined ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ body: content, contentType: 'text/plain' });
    });
    await openApp(page);
    await menu(page, 'File', 'Open server workspace…');
    await page.getByTestId('prompt-input').fill('/api/dev/workspace');
    await page.getByTestId('prompt-confirm').click();
    // the workspace's projects are its top-level folders
    await expect(page.getByTestId('prompt-help')).toContainText('Projects in this workspace: other, shop');
    await page.getByTestId('prompt-input').fill('shop');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('status-storage')).toHaveText('Server workspace: shop');
    await expect(page.getByTestId('project-name')).toHaveText('shop');
    await expect(treeItem(page, 'remote.dmn')).toBeVisible();
    await expect(treeItem(page, 'crm.json')).toBeVisible();
    // only the files of this project: paths are relative to its folder
    await expect(page.getByTestId('file-tree').getByRole('treeitem', { name: 'processes', exact: true })).toBeVisible();
    await expect(page.getByTestId('file-tree').getByRole('treeitem', { name: 'shop', exact: true })).toHaveCount(0);
    expect(requests).toContain('GET /shop?recursive=true');

    await treeItem(page, 'remote.dmn').dblclick();
    await activePanel(page).getByTestId('text-editor').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('<!-- edited -->');
    await page.keyboard.press('Control+S');
    await expect(tab(page, 'remote.dmn')).not.toHaveClass(/dirty/);
    expect(files.get('shop/processes/remote.dmn')).toContain('<!-- edited -->');
    expect(requests).toContain('PUT /shop/processes/remote.dmn');
    // a template creates its files on the server; deleting removes them
    await menu(page, 'File', 'New file', 'Scenario file');
    await page.getByTestId('prompt-input').fill('check');
    await page.getByTestId('prompt-confirm').click();
    await expect.poll(() => [...files.keys()]).toContain('shop/scenarios/check.scenario.json');
    await treeItem(page, 'check.scenario.json').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByTestId('choice-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => [...files.keys()]).not.toContain('shop/scenarios/check.scenario.json');
    expect(requests).toContain('DELETE /shop/scenarios/check.scenario.json');

    // a name that does not exist starts a new project in the workspace, with its first files
    await menu(page, 'File', 'Open server workspace…');
    await page.getByTestId('prompt-input').fill('/api/dev/workspace');
    await page.getByTestId('prompt-confirm').click();
    await page.getByTestId('prompt-input').fill('fresh');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('project-name')).toHaveText('fresh');
    await expect.poll(() => [...files.keys()].filter((k) => k.startsWith('fresh/')).sort()).toEqual(['fresh/processes/process-extensions.json', 'fresh/processes/process.bpmn20.xml', 'fresh/project.json']);
    expect(files.has('other/project.json')).toBe(true);

    // a server that is not there: a clear message, the open project stays
    await menu(page, 'File', 'Open server workspace…');
    await page.getByTestId('prompt-input').fill('http://127.0.0.1:9/elsewhere');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('alert-dialog')).toContainText('Cannot open the server workspace');
    await expect(page.getByTestId('alert-dialog')).toContainText('not reachable');
    await page.getByTestId('alert-dialog').getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('status-storage')).toHaveText('Server workspace: fresh');
  });
});
