import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryStorage } from '../storage/memory';
import { IndexedDbStorage } from '../storage/indexeddb';
import { ProjectWorkspace } from './workspace';

let n = 0;
let idb: IndexedDbStorage;

beforeEach(async () => {
  n += 1;
  idb = await IndexedDbStorage.open({ name: `workspace-test-${n}` });
});

async function openProject(files: Record<string, string>): Promise<ProjectWorkspace> {
  const adapter = await idb.createProject('demo');
  for (const [path, content] of Object.entries(files)) await adapter.write(path, content);
  return ProjectWorkspace.open(adapter, idb);
}

describe('ProjectWorkspace', () => {
  it('opens a storage and mirrors every change in the storage and the model', async () => {
    const ws = await openProject({ 'project.json': '{}' });
    expect(ws.model.paths()).toEqual(['project.json']);
    await ws.createFile('processes/a.bpmn20.xml', '<a/>');
    expect(await ws.adapter.read('processes/a.bpmn20.xml')).toBe('<a/>');
    await expect(ws.createFile('processes/a.bpmn20.xml', 'x')).rejects.toThrow(/already exists/);

    await ws.saveFile('processes/a.bpmn20.xml', '<b/>');
    expect(await ws.adapter.read('processes/a.bpmn20.xml')).toBe('<b/>');
    expect(ws.model.saved('processes/a.bpmn20.xml')).toBe('<b/>');

    await ws.renameFile('processes/a.bpmn20.xml', 'processes/c.bpmn20.xml');
    expect((await ws.adapter.list()).sort()).toEqual(['processes/c.bpmn20.xml', 'project.json']);
    expect(ws.model.paths()).toEqual(['processes/c.bpmn20.xml', 'project.json']);

    await ws.deleteFile('processes/c.bpmn20.xml');
    expect(await ws.adapter.list()).toEqual(['project.json']);
    expect(ws.model.paths()).toEqual(['project.json']);
  });

  it('keeps a draft of every unsaved edit and removes it when the file is saved', async () => {
    const ws = await openProject({ 'a.json': '1' });
    await ws.edit('a.json', '2');
    expect(ws.model.isDirty('a.json')).toBe(true);
    expect((await idb.listDrafts(ws.key)).map((d) => [d.path, d.content])).toEqual([['a.json', '2']]);
    await ws.saveFile('a.json', '2');
    expect(await idb.listDrafts(ws.key)).toEqual([]);
    expect(ws.model.isDirty('a.json')).toBe(false);
  });

  it('removes the draft when the edit goes back to the saved text', async () => {
    const ws = await openProject({ 'a.json': '1' });
    await ws.edit('a.json', '2');
    await ws.edit('a.json', '1');
    expect(await idb.listDrafts(ws.key)).toEqual([]);
  });

  it('offers drafts for recovery after a reload and drops stale ones', async () => {
    const first = await openProject({ 'a.json': '1', 'b.json': 'b' });
    await first.edit('a.json', 'edited');
    await idb.saveDraft(first.key, 'gone.json', 'for a deleted file');
    await idb.saveDraft(first.key, 'b.json', 'b'); // same as the saved file

    // "reload": a new workspace over the same storage
    const second = await ProjectWorkspace.open(await idb.openProject('demo'), idb);
    const drafts = await second.pendingDrafts();
    expect(drafts.map((d) => [d.path, d.content])).toEqual([['a.json', 'edited']]);
    expect(await idb.listDrafts(second.key)).toHaveLength(1);
    expect(second.model.isDirty('a.json')).toBe(false);
    second.recover(drafts);
    expect(second.model.read('a.json')).toBe('edited');
    expect(second.model.isDirty('a.json')).toBe(true);
    // the file on disk is untouched until saved
    expect(await second.adapter.read('a.json')).toBe('1');
  });

  it('keeps the draft of an extensions file that does not exist yet and recovers it', async () => {
    const first = await openProject({ 'processes/a.bpmn20.xml': '<a/>' });
    await first.edit('processes/a-extensions.json', '{"id":"x"}');
    expect(first.model.paths()).toEqual(['processes/a.bpmn20.xml']);
    const second = await ProjectWorkspace.open(await idb.openProject('demo'), idb);
    const drafts = await second.pendingDrafts();
    expect(drafts.map((d) => d.path)).toEqual(['processes/a-extensions.json']);
    second.recover(drafts);
    expect(second.model.read('processes/a-extensions.json')).toBe('{"id":"x"}');
    await second.saveFile('processes/a-extensions.json', '{"id":"x"}');
    expect(await second.adapter.list()).toContain('processes/a-extensions.json');
  });

  it('discards drafts', async () => {
    const ws = await openProject({ 'a.json': '1' });
    await ws.edit('a.json', '2');
    await ws.discardDrafts();
    expect(await idb.listDrafts(ws.key)).toEqual([]);
    await ws.edit('a.json', '3');
    await ws.discard('a.json');
    expect(ws.model.isDirty('a.json')).toBe(false);
    expect(await idb.listDrafts(ws.key)).toEqual([]);
  });

  it('moves a draft with a renamed file', async () => {
    const ws = await openProject({ 'a.json': '1' });
    await ws.edit('a.json', '2');
    await ws.renameFile('a.json', 'b.json');
    expect((await idb.listDrafts(ws.key)).map((d) => d.path)).toEqual(['b.json']);
  });

  it('works without a draft store and on any adapter', async () => {
    const ws = await ProjectWorkspace.open(new MemoryStorage('m', [{ path: 'a.json', content: '1' }]));
    await ws.edit('a.json', '2');
    expect(await ws.pendingDrafts()).toEqual([]);
    await ws.saveFile('a.json', '2');
    expect(await ws.adapter.read('a.json')).toBe('2');
  });

  it('reports files that cannot be read instead of dropping them silently', async () => {
    const adapter = new MemoryStorage('m', [{ path: 'a.json', content: '1' }]);
    adapter.read = async (path: string) => {
      throw new Error(`cannot read ${path}`);
    };
    const ws = await ProjectWorkspace.open(adapter);
    expect(ws.loadFailures).toEqual([{ path: 'a.json', message: 'cannot read a.json' }]);
    expect(ws.model.paths()).toEqual([]);
  });
});
