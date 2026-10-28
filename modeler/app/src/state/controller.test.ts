// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { exportZip, importZip, IndexedDbStorage } from '@activiti-modeler/activiti-project';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppController } from './controller';
import { registerEditor, unregisterEditor } from './editorRegistry';
import type { EditorHandle } from './types';

const downloads: Array<{ name: string; blob: Blob }> = [];
vi.mock('./download', () => ({ downloadBlob: (blob: Blob, name: string) => void downloads.push({ name, blob }) }));

const stub = () => null;
registerEditor({ id: 'bpmn', label: 'diagram', accepts: (p) => (/\.bpmn20\.xml$|\.bpmn$/.test(p) ? 10 : false), Component: stub });
registerEditor({ id: 'text', label: 'text', accepts: () => 0, Component: stub });
// keeps the registry honest in this file: only the stubs above
void unregisterEditor;

let dbCounter = 0;
const realOpen = IndexedDbStorage.open.bind(IndexedDbStorage);

/** A controller on its own IndexedDB, as if it were a fresh browser profile; `reuse` opens the same profile again (a reload). */
async function start(reuse?: string): Promise<{ controller: AppController; db: string }> {
  const db = reuse ?? `profile-${(dbCounter += 1)}`;
  vi.mocked(IndexedDbStorage.open).mockImplementation((options) => realOpen({ ...options, name: db }));
  const controller = new AppController();
  await controller.init();
  return { controller, db };
}

/** Gives the open tab an editor handle like the real editors do: it serialises `content` as the files of the tab. */
function attach(controller: AppController, content: (target: string) => Array<{ path: string; content: string }>): EditorHandle {
  const tab = controller.activeTab!;
  const handle: EditorHandle = { serialize: async (target) => content(target), markSaved: vi.fn() };
  controller.hostFor(tab.id).setHandle(handle);
  return handle;
}

/** The bytes of a Blob (jsdom's Blob has no arrayBuffer()). */
const blobBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const nextDialog = async (controller: AppController) => {
  await vi.waitFor(() => expect(controller.getSnapshot().dialog).toBeDefined());
  return controller.getSnapshot().dialog!;
};

async function answer(controller: AppController, value: unknown): Promise<void> {
  const dialog = await nextDialog(controller);
  controller.answerDialog(dialog.id, value);
}

beforeEach(() => {
  downloads.length = 0;
  localStorage.clear();
  vi.spyOn(IndexedDbStorage, 'open');
});

describe('startup', () => {
  it('creates a default project with one process and opens it', async () => {
    const { controller } = await start();
    const state = controller.getSnapshot();
    expect(state.ready).toBe(true);
    expect(state.project?.name).toBe('my-project');
    expect(state.project?.paths).toEqual(['processes/process-extensions.json', 'processes/process.bpmn20.xml', 'project.json']);
    expect(state.tabs.map((t) => [t.path, t.editor, t.view])).toEqual([['processes/process.bpmn20.xml', 'bpmn', 'diagram']]);
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
    expect(JSON.parse(controller.workspace!.model.read('project.json')!)).toMatchObject({ name: 'my-project', activiti: '9.0.0' });
  });

  it('reopens the last project with its tabs after a reload, and lists it as recent', async () => {
    const { controller, db } = await start();
    controller.openTab('project.json');
    await new Promise((r) => setTimeout(r, 400));
    await controller.flushSession();
    const again = (await start(db)).controller;
    expect(again.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml', 'project.json']);
    expect(again.getSnapshot().activeTabId).toBe(again.getSnapshot().tabs[1]!.id);
    expect(again.getSnapshot().recent.map((r) => r.key)).toEqual(['idb:my-project']);
  });
});

describe('U19 settings and session restore', () => {
  it('keeps the settings in this browser: a change survives a reload, the editors are told, a bad stored value falls back', async () => {
    const { controller } = await start();
    const told: unknown[] = [];
    controller.hostFor(controller.getSnapshot().tabs[0]!.id).setHandle({ serialize: async () => [], markSaved: vi.fn(), settingsChanged: (settings) => void told.push(settings.defaultMappings) });
    expect(controller.getSnapshot().settings).toMatchObject({ defaultMappings: 'mapAll', autoLayout: true, restoreSession: true });
    controller.setSettings({ defaultMappings: 'none', autoLayout: false });
    expect(told).toEqual(['none']);
    expect(JSON.parse(localStorage.getItem('activiti-modeler.settings.v1')!)).toMatchObject({ defaultMappings: 'none', autoLayout: false });
    expect((await start()).controller.getSnapshot().settings).toMatchObject({ defaultMappings: 'none', autoLayout: false });
    localStorage.setItem('activiti-modeler.settings.v1', '{"defaultMappings":"sometimes","autoLayout":"yes"}');
    expect((await start()).controller.getSnapshot().settings).toMatchObject({ defaultMappings: 'mapAll', autoLayout: true });
    localStorage.setItem('activiti-modeler.settings.v1', 'not json');
    expect((await start()).controller.getSnapshot().settings.restoreSession).toBe(true);
  });

  it('restore defaults puts every setting back', async () => {
    const { controller } = await start();
    controller.setSettings({ defaultMappings: 'none', autoLayout: false, restoreSession: false, offerCamundaConversion: false });
    controller.restoreDefaultSettings();
    expect(controller.getSnapshot().settings).toEqual({ defaultMappings: 'mapAll', autoLayout: true, restoreSession: true, offerCamundaConversion: true, locale: 'en' });
  });

  it('with "reopen the tabs" switched off a reload opens the first process only', async () => {
    const { controller, db } = await start();
    controller.openTab('project.json');
    await new Promise((r) => setTimeout(r, 400));
    await controller.flushSession();
    controller.setSettings({ restoreSession: false });
    const again = (await start(db)).controller;
    expect(again.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml']);
    controller.setSettings({ restoreSession: true });
    expect((await start(db)).controller.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml', 'project.json']);
  });

  it('the settings command opens the dialog; reset layout restores the panels and keeps the minimap and the grid', async () => {
    const { controller } = await start();
    await controller.run('openSettings');
    expect(controller.getSnapshot().dialog?.kind).toBe('settings');
    controller.closeDialog();
    controller.setLayout({ explorerOpen: false, explorerWidth: 400, propertiesWidth: 500, bottomOpen: true, bottomHeight: 300, minimapOpen: true, gridVisible: false });
    await controller.run('resetLayout');
    expect(controller.getSnapshot().layout).toMatchObject({ explorerOpen: true, explorerWidth: 250, propertiesWidth: 320, bottomOpen: false, bottomHeight: 220, minimapOpen: true, gridVisible: false });
    expect(JSON.parse(localStorage.getItem('activiti-modeler.layout.v1')!)).toMatchObject({ explorerWidth: 250, minimapOpen: true });
  });
});

describe('U17 import of several files', () => {
  const CAMUNDA = (id: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="D" targetNamespace="x"><bpmn:process id="${id}" isExecutable="true" camunda:historyTimeToLive="P1D"><bpmn:startEvent id="s" /></bpmn:process></bpmn:definitions>`;

  it('says that the imported processes use Camunda 7 extensions when several come at once, and not when the setting is off', async () => {
    const { controller } = await start();
    await controller.importFiles([{ name: 'a.bpmn', text: CAMUNDA('a') }, { name: 'b.bpmn', text: CAMUNDA('b') }]);
    expect(controller.getSnapshot().toasts.map((x) => x.message)).toContain('2 of the imported files use Camunda 7 extensions. Open one and choose "Convert to Activiti".');
    controller.setSettings({ offerCamundaConversion: false });
    await controller.importFiles([{ name: 'c.bpmn', text: CAMUNDA('c') }, { name: 'd.bpmn', text: CAMUNDA('d') }]);
    expect(controller.getSnapshot().toasts.filter((x) => x.message.includes('Convert to Activiti'))).toHaveLength(1);
  });

  it('one file needs no toast: its own tab shows the offer', async () => {
    const { controller } = await start();
    await controller.importFiles([{ name: 'a.bpmn', text: CAMUNDA('a') }]);
    expect(controller.getSnapshot().toasts.map((x) => x.message).join('|')).not.toContain('Convert to Activiti');
  });
});

describe('tabs', () => {
  it('opens an extensions file in the JSON view of its process, and a stand-alone JSON in its own tab', async () => {
    const { controller } = await start();
    const tab = controller.openTab('processes/process-extensions.json')!;
    expect(tab.path).toBe('processes/process.bpmn20.xml');
    expect(tab.view).toBe('json');
    expect(controller.getSnapshot().tabs).toHaveLength(1);
    expect(controller.openTab('project.json')!.editor).toBe('text');
    expect(controller.getSnapshot().tabs).toHaveLength(2);
    // the same file again shows its tab
    expect(controller.openTab('project.json')!.id).toBe(controller.getSnapshot().activeTabId);
    expect(controller.getSnapshot().tabs).toHaveLength(2);
  });

  it('asks before closing a tab with unsaved changes: save, discard or cancel', async () => {
    const { controller } = await start();
    controller.openTab('project.json');
    const id = controller.getSnapshot().activeTabId!;
    attach(controller, (target) => [{ path: target, content: '{"changed":true}' }]);
    controller.hostFor(id).setDirty(true);
    expect(controller.getSnapshot().tabs.find((t) => t.id === id)!.dirty).toBe(true);
    expect(controller.getSnapshot().project!.dirtyPaths.has('project.json')).toBe(true);

    let closing = controller.closeTab(id);
    expect((await nextDialog(controller)).kind).toBe('choice');
    controller.answerDialog((await nextDialog(controller)).id, 'cancel');
    expect(await closing).toBe(false);
    expect(controller.getSnapshot().tabs).toHaveLength(2);

    closing = controller.closeTab(id);
    controller.answerDialog((await nextDialog(controller)).id, 'save');
    expect(await closing).toBe(true);
    expect(controller.workspace!.model.saved('project.json')).toBe('{"changed":true}');
    expect(controller.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml']);
  });

  it('discarding drops the working copy and the draft', async () => {
    const { controller } = await start();
    controller.openTab('project.json');
    const id = controller.getSnapshot().activeTabId!;
    await controller.workspace!.edit('project.json', 'unsaved');
    controller.hostFor(id).setDirty(true);
    const closing = controller.closeTab(id);
    controller.answerDialog((await nextDialog(controller)).id, 'discard');
    await closing;
    expect(controller.workspace!.model.isDirty('project.json')).toBe(false);
    expect(await controller.workspace!.drafts!.listDrafts('idb:my-project')).toEqual([]);
  });

  it('reopens closed tabs, most recent first, and steps through the tabs in a circle', async () => {
    const { controller } = await start();
    controller.openTab('project.json');
    const a = controller.getSnapshot().tabs[0]!.id;
    const b = controller.getSnapshot().tabs[1]!.id;
    controller.stepTab(1);
    expect(controller.getSnapshot().activeTabId).toBe(a);
    controller.stepTab(-1);
    expect(controller.getSnapshot().activeTabId).toBe(b);
    await controller.closeTab(b);
    expect(controller.getSnapshot().closedCount).toBe(1);
    controller.reopenClosed();
    expect(controller.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml', 'project.json']);
    expect(controller.getSnapshot().closedCount).toBe(0);
  });

  it('a failed editor turns the tab into the fail-safe error view, and the file can be opened as text', async () => {
    const { controller } = await start();
    const id = controller.getSnapshot().activeTabId!;
    controller.hostFor(id).fail('process.bpmn20.xml could not be opened', 'boom', ['processes/process.bpmn20.xml', 'processes/process-extensions.json']);
    const tab = controller.getSnapshot().tabs[0]!;
    expect(tab.error).toEqual({ message: 'process.bpmn20.xml could not be opened', detail: 'boom', textFiles: ['processes/process.bpmn20.xml', 'processes/process-extensions.json'] });
    controller.openAsText(id, 'processes/process-extensions.json');
    expect(controller.getSnapshot().tabs.map((t) => [t.path, t.editor])).toEqual([['processes/process.bpmn20.xml', 'bpmn'], ['processes/process-extensions.json', 'text']]);
    controller.openAsText(id);
    expect(controller.getSnapshot().tabs[0]).toMatchObject({ editor: 'text' });
    expect(controller.getSnapshot().tabs[0]!.error).toBeUndefined();
  });
});

describe('files and templates', () => {
  it('creates the files of a template, refuses a taken name and opens the main file', async () => {
    const { controller } = await start();
    await controller.newFromTemplate('decision-task', 'route');
    expect(controller.workspace!.model.paths()).toEqual(expect.arrayContaining(['processes/route.bpmn20.xml', 'processes/route-extensions.json', 'processes/route-rules.dmn']));
    expect(controller.activeTab!.path).toBe('processes/route.bpmn20.xml');

    const second = controller.newFromTemplate('empty-process');
    const dialog = await nextDialog(controller);
    expect(dialog).toMatchObject({ kind: 'prompt', initial: 'process-2' });
    if (dialog.kind === 'prompt') expect(dialog.validate!('route')).toContain('already exists');
    controller.answerDialog(dialog.id, 'second');
    await second;
    expect(controller.activeTab!.path).toBe('processes/second.bpmn20.xml');
    // unique process ids: the first process of the project is Process_1
    const ids = controller.workspace!.model.paths().filter((p) => p.endsWith('.bpmn20.xml')).map((p) => /<bpmn:process id="([^"]+)"/.exec(controller.workspace!.model.read(p)!)![1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renames a process together with its extensions file and follows the open tab', async () => {
    const { controller } = await start();
    const renaming = controller.renameFile('processes/process.bpmn20.xml');
    const dialog = await nextDialog(controller);
    if (dialog.kind === 'prompt') {
      expect(dialog.validate!('process.json')).toContain('keep the file type');
      expect(dialog.validate!('a/b.bpmn20.xml')).toContain('not a path');
    }
    controller.answerDialog(dialog.id, 'order.bpmn20.xml');
    await renaming;
    expect(controller.workspace!.model.paths()).toEqual(['processes/order-extensions.json', 'processes/order.bpmn20.xml', 'project.json']);
    expect(controller.getSnapshot().tabs[0]).toMatchObject({ path: 'processes/order.bpmn20.xml', title: 'order.bpmn20.xml' });
    expect(await controller.workspace!.adapter.list()).toHaveLength(3);
  });

  it('refuses to rename the extensions file on its own and files with unsaved changes', async () => {
    const { controller } = await start();
    await controller.renameFile('processes/process-extensions.json');
    expect(controller.getSnapshot().dialog).toMatchObject({ kind: 'alert', title: 'Rename the process file' });
    controller.closeDialog();
    controller.openTab('project.json');
    controller.hostFor(controller.getSnapshot().activeTabId!).setDirty(true);
    await controller.renameFile('project.json');
    expect(controller.getSnapshot().dialog).toMatchObject({ kind: 'alert', title: 'Save first' });
  });

  it('deletes a process with its extensions file and closes its tab', async () => {
    const { controller } = await start();
    const deleting = controller.deleteFile('processes/process.bpmn20.xml');
    expect((await nextDialog(controller)).kind).toBe('choice');
    await answer(controller, 'delete');
    await deleting;
    expect(controller.workspace!.model.paths()).toEqual(['project.json']);
    expect(controller.getSnapshot().tabs).toEqual([]);
    expect(await controller.workspace!.adapter.list()).toEqual(['project.json']);
  });

  it('imports dropped files into the folder of their kind and keeps a process and its extensions together under a free name', async () => {
    const { controller } = await start();
    await controller.importFiles([
      { name: 'process.bpmn', text: '<bpmn/>' },
      { name: 'process-extensions.json', text: '{"id":"x","extensions":{}}' },
      { name: 'rules.dmn', text: '<definitions/>' },
      { name: 'a.scenario.json', text: '{"name":"a"}' },
      { name: 'crm.json', text: '{}' },
    ]);
    expect(controller.workspace!.model.paths()).toEqual(
      expect.arrayContaining(['processes/process-2.bpmn20.xml', 'processes/process-2-extensions.json', 'processes/rules.dmn', 'scenarios/a.scenario.json', 'connectors/crm.json']),
    );
    expect(controller.workspace!.model.read('processes/process.bpmn20.xml')).not.toBe('<bpmn/>');
    expect(controller.activeTab!.path).toBe('processes/process-2.bpmn20.xml');
  });
});

describe('connector files (ADR 0003: only the runtime fields; the rest in project.json)', () => {
  const LEGACY = '{"id":"crm","name":"crm","version":"3","config":[{"name":"url","value":"u"}],"actions":{"GO":{"id":"GO","name":"Go","inputs":[],"outputs":[]}}}';
  const meta = (controller: AppController): Record<string, unknown> =>
    (JSON.parse(controller.workspace!.model.read('project.json')!) as { connectors?: Record<string, unknown> }).connectors ?? {};

  it('imports a descriptor with the modeler-only fields cleaned and the fields moved to project.json, and says so', async () => {
    const { controller } = await start();
    await controller.importFiles([{ name: 'crm.json', text: LEGACY }]);
    expect(Object.keys(JSON.parse(controller.workspace!.model.read('connectors/crm.json')!) as object)).toEqual(['id', 'name', 'actions']);
    expect(meta(controller)).toEqual({ crm: { version: '3', config: [{ name: 'url', value: 'u' }] } });
    expect(controller.getSnapshot().toasts.some((t) => t.message.includes('crm.json with changes') && (t.detail ?? '').includes('moved to project.json (connectors.crm)'))).toBe(true);
    // saved, not just edited
    expect(controller.workspace!.model.isDirty('project.json')).toBe(false);
  });

  it('moves the entry of a connector with the file when it is renamed and removes it when the file is deleted', async () => {
    const { controller } = await start();
    await controller.importFiles([{ name: 'crm.json', text: LEGACY }]);
    const renaming = controller.renameFile('connectors/crm.json');
    const dialog = await nextDialog(controller);
    controller.answerDialog(dialog.id, 'customers.json');
    await renaming;
    expect(Object.keys(meta(controller))).toEqual(['customers']);
    const deleting = controller.deleteFile('connectors/customers.json');
    await nextDialog(controller);
    await answer(controller, 'delete');
    await deleting;
    expect(meta(controller)).toEqual({});
    expect(JSON.parse(controller.workspace!.model.read('project.json')!)).not.toHaveProperty('connectors');
  });

  it('exports a zip whose connector files hold only the runtime fields, even for a file that still carries more', async () => {
    const { controller } = await start();
    await controller.workspace!.createFile('connectors/old.json', '{"id":"old","name":"old","version":"9","actions":{}}');
    await controller.exportProjectZip();
    const files = Object.fromEntries(importZip(await blobBytes(downloads[0]!.blob)).files.map((f) => [f.path, f.content]));
    expect(Object.keys(JSON.parse(files['connectors/old.json']!) as object)).toEqual(['id', 'name', 'actions']);
    expect((JSON.parse(files['project.json']!) as { connectors: Record<string, unknown> }).connectors).toEqual({ old: { version: '9' } });
    // the project itself is untouched
    expect(controller.workspace!.model.read('connectors/old.json')).toContain('"version":"9"');
  });
});

describe('saving', () => {
  it('saves a tab through its editor and clears the dirty state', async () => {
    const { controller } = await start();
    const handle = attach(controller, (target) => [{ path: target, content: '<saved/>' }, { path: 'processes/process-extensions.json', content: '{"id":"saved"}' }]);
    controller.hostFor(controller.activeTab!.id).setDirty(true);
    expect(await controller.save()).toBe(true);
    expect(controller.workspace!.model.saved('processes/process.bpmn20.xml')).toBe('<saved/>');
    expect(await controller.workspace!.adapter.read('processes/process.bpmn20.xml')).toBe('<saved/>');
    expect(handle.markSaved).toHaveBeenCalled();
    expect(controller.getSnapshot().tabs[0]!.dirty).toBe(false);
  });

  it('shows why a save failed and writes nothing', async () => {
    const { controller } = await start();
    const tab = controller.activeTab!;
    controller.hostFor(tab.id).setHandle({
      serialize: async () => {
        throw new Error('export refused: [NOT_EXECUTABLE] process "p"');
      },
    });
    controller.hostFor(tab.id).setDirty(true);
    expect(await controller.save()).toBe(false);
    expect(controller.getSnapshot().dialog).toMatchObject({ kind: 'alert', title: 'Cannot save process.bpmn20.xml' });
    expect(controller.getSnapshot().tabs[0]!.dirty).toBe(true);
    expect(await controller.workspace!.adapter.read('processes/process.bpmn20.xml')).toContain('<bpmn:process');
  });

  it('save as writes the new path (and sidecar), keeps the original and re-points the tab', async () => {
    const { controller } = await start();
    const original = controller.workspace!.model.read('processes/process.bpmn20.xml')!;
    attach(controller, (target) => [{ path: target, content: '<copy/>' }, { path: target.replace('.bpmn20.xml', '-extensions.json'), content: '{"id":"copy"}' }]);
    const saving = controller.saveAs();
    const dialog = await nextDialog(controller);
    expect(dialog).toMatchObject({ kind: 'prompt', initial: 'processes/process-copy.bpmn20.xml' });
    if (dialog.kind === 'prompt') {
      expect(dialog.validate!('processes/x.json')).toContain('same type');
      expect(dialog.validate!('../x.bpmn20.xml')).toBeDefined();
      expect(dialog.validate!('processes/y.bpmn20.xml')).toBeUndefined();
    }
    controller.answerDialog(dialog.id, 'processes/order.bpmn20.xml');
    expect(await saving).toBe(true);
    expect(controller.workspace!.model.read('processes/order.bpmn20.xml')).toBe('<copy/>');
    expect(controller.workspace!.model.read('processes/order-extensions.json')).toBe('{"id":"copy"}');
    expect(controller.workspace!.model.read('processes/process.bpmn20.xml')).toBe(original);
    expect(controller.getSnapshot().tabs[0]).toMatchObject({ path: 'processes/order.bpmn20.xml', title: 'order.bpmn20.xml' });
  });

  it('save all saves every dirty tab and recovered working copies of files without a tab', async () => {
    const { controller } = await start();
    attach(controller, (target) => [{ path: target, content: '<one/>' }]);
    controller.hostFor(controller.activeTab!.id).setDirty(true);
    controller.openTab('project.json');
    attach(controller, (target) => [{ path: target, content: '{"two":2}' }]);
    controller.hostFor(controller.activeTab!.id).setDirty(true);
    await controller.workspace!.edit('processes/process-extensions.json', '{"id":"recovered"}');
    expect(await controller.saveAll()).toBe(true);
    expect(controller.workspace!.model.dirtyPaths()).toEqual([]);
    expect(await controller.workspace!.adapter.read('processes/process.bpmn20.xml')).toBe('<one/>');
    expect(await controller.workspace!.adapter.read('project.json')).toBe('{"two":2}');
    expect(await controller.workspace!.adapter.read('processes/process-extensions.json')).toBe('{"id":"recovered"}');
    expect(controller.getSnapshot().tabs.every((t) => !t.dirty)).toBe(true);
  });
});

describe('drafts and recovery', () => {
  it('after a reload the unsaved edits come back as working copies in dirty tabs', async () => {
    const first = await start();
    await first.controller.workspace!.edit('project.json', '{"draft":true}');
    const again = (await start(first.db)).controller;
    expect(again.workspace!.model.read('project.json')).toBe('{"draft":true}');
    expect(again.workspace!.model.saved('project.json')).not.toBe('{"draft":true}');
    expect(again.getSnapshot().toasts.map((t) => t.message)).toContain('Recovered unsaved changes in 1 file(s) from your last session');
    const tab = again.getSnapshot().tabs.find((t) => t.path === 'project.json')!;
    expect(tab.dirty).toBe(true);
    // the (real) text editor serialises the working copy it was opened with
    again.activateTab(tab.id);
    attach(again, (target) => [{ path: target, content: again.workspace!.model.read(target)! }]);
    expect(await again.saveAll()).toBe(true);
    expect(await again.workspace!.adapter.read('project.json')).toBe('{"draft":true}');
  });
});

describe('projects and zip', () => {
  it('creates, switches and deletes browser projects', async () => {
    const { controller } = await start();
    await controller.newProject('second');
    expect(controller.getSnapshot().project!.name).toBe('second');
    expect(controller.getSnapshot().tabs.map((t) => t.path)).toEqual(['processes/process.bpmn20.xml']);
    await controller.refreshForTest();
    expect(controller.getSnapshot().projects.map((p) => p.name).sort()).toEqual(['my-project', 'second']);
    await controller.openProject('my-project');
    expect(controller.getSnapshot().project!.name).toBe('my-project');
    const deleting = controller.deleteProject('second');
    await answer(controller, 'delete');
    await deleting;
    expect(controller.getSnapshot().projects.map((p) => p.name)).toEqual(['my-project']);
  });

  it('exports the saved project as a zip with the files at the root, and imports a zip as a new project', async () => {
    const { controller } = await start();
    await controller.exportProjectZip();
    expect(downloads.map((d) => d.name)).toEqual(['my-project.zip']);
    const bytes = await blobBytes(downloads[0]!.blob);
    const unpacked = importZip(bytes);
    expect(unpacked.files).toEqual(controller.snapshotFiles());
    expect(unpacked.files.map((f) => f.path)).toEqual(['processes/process-extensions.json', 'processes/process.bpmn20.xml', 'project.json']);

    await controller.importZipData(exportZip(unpacked.files), 'my-project.zip');
    expect(controller.getSnapshot().project!.name).toBe('my-project-2');
    expect(controller.snapshotFiles()).toEqual(unpacked.files);
    expect(controller.getSnapshot().toasts.some((t) => t.message.startsWith('Imported 3 file(s)'))).toBe(true);
  });

  it('opening another project asks about unsaved changes first', async () => {
    const { controller } = await start();
    await controller.newProject('second');
    controller.hostFor(controller.activeTab!.id).setDirty(true);
    const opening = controller.openProject('my-project');
    const dialog = await nextDialog(controller);
    expect(dialog).toMatchObject({ kind: 'choice', title: 'Unsaved changes' });
    controller.answerDialog(dialog.id, 'cancel');
    await opening;
    expect(controller.getSnapshot().project!.name).toBe('second');
  });
});
