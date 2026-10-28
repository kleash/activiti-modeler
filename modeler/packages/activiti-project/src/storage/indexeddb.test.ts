import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renameFile } from './adapter';
import { IndexedDbStorage } from './indexeddb';

let storage: IndexedDbStorage;
let n = 0;

beforeEach(async () => {
  n += 1;
  storage = await IndexedDbStorage.open({ name: `test-db-${n}` });
});

afterEach(() => storage.close());

describe('IndexedDbStorage projects', () => {
  it('creates, lists and deletes projects', async () => {
    expect(await storage.listProjects()).toEqual([]);
    const a = await storage.createProject('alpha');
    await a.write('project.json', '{}');
    await storage.createProject('beta');
    expect((await storage.listProjects()).map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
    await expect(storage.createProject('alpha')).rejects.toThrow(/already exists/);
    await storage.deleteProject('alpha');
    expect((await storage.listProjects()).map((p) => p.name)).toEqual(['beta']);
    await expect(storage.openProject('alpha')).rejects.toThrow(/No project named/);
  });

  it('rejects bad project names and finds a free one', async () => {
    await expect(storage.createProject('../evil')).rejects.toThrow(/Invalid project name/);
    await storage.createProject('demo');
    await storage.createProject('demo-2');
    expect(await storage.uniqueProjectName('demo')).toBe('demo-3');
    expect(await storage.uniqueProjectName('fresh')).toBe('fresh');
  });

  it('keeps the files of each project apart', async () => {
    const a = await storage.createProject('a');
    const b = await storage.createProject('b');
    await a.write('processes/x.bpmn20.xml', '<a/>');
    await b.write('processes/x.bpmn20.xml', '<b/>');
    expect(await a.read('processes/x.bpmn20.xml')).toBe('<a/>');
    expect(await b.read('processes/x.bpmn20.xml')).toBe('<b/>');
    expect(await a.list()).toEqual(['processes/x.bpmn20.xml']);
  });
});

describe('IndexedDbProject (StorageAdapter)', () => {
  it('writes, reads, overwrites, removes and renames', async () => {
    const project = await storage.createProject('p');
    expect(project.key).toBe('idb:p');
    await project.write('a.json', '1');
    await project.write('a.json', '2');
    expect(await project.read('a.json')).toBe('2');
    await project.write('dir/b.json', 'b');
    expect((await project.list()).sort()).toEqual(['a.json', 'dir/b.json']);
    await renameFile(project, 'a.json', 'dir/c.json');
    expect((await project.list()).sort()).toEqual(['dir/b.json', 'dir/c.json']);
    await expect(renameFile(project, 'dir/b.json', 'dir/c.json')).rejects.toThrow(/already exists/);
    await project.remove('dir/b.json');
    await expect(project.read('dir/b.json')).rejects.toThrow(/No such file/);
  });

  it('refuses invalid paths', async () => {
    const project = await storage.createProject('p');
    await expect(project.write('../x', '')).rejects.toThrow(/Invalid project path/);
  });

  it('bumps the modified time of the project on a write', async () => {
    const project = await storage.createProject('p');
    const before = (await storage.listProjects())[0]!.modified;
    await new Promise((r) => setTimeout(r, 5));
    await project.write('a.json', '1');
    expect((await storage.listProjects())[0]!.modified).toBeGreaterThan(before);
  });
});

describe('drafts', () => {
  it('stores drafts per project key and removes them with the project', async () => {
    const project = await storage.createProject('p');
    await storage.saveDraft(project.key, 'a.json', 'draft 1');
    await storage.saveDraft(project.key, 'a.json', 'draft 2');
    await storage.saveDraft('idb:other', 'a.json', 'other');
    expect((await storage.listDrafts(project.key)).map((d) => [d.path, d.content])).toEqual([['a.json', 'draft 2']]);
    await storage.deleteDraft(project.key, 'a.json');
    expect(await storage.listDrafts(project.key)).toEqual([]);
    await storage.saveDraft(project.key, 'b.json', 'x');
    await storage.deleteProject('p');
    expect(await storage.listDrafts(project.key)).toEqual([]);
    expect(await storage.listDrafts('idb:other')).toHaveLength(1);
  });

  it('clears all drafts of a project', async () => {
    await storage.saveDraft('idb:p', 'a', '1');
    await storage.saveDraft('idb:p', 'b', '2');
    await storage.clearDrafts('idb:p');
    expect(await storage.listDrafts('idb:p')).toEqual([]);
  });
});

describe('recent projects and session state', () => {
  it('lists the most recently opened first, one entry per key, at most 12', async () => {
    for (let i = 0; i < 14; i += 1) await storage.addRecent({ key: `idb:p${i}`, kind: 'indexeddb', name: `p${i}`, openedAt: 1000 + i });
    await storage.addRecent({ key: 'idb:p5', kind: 'indexeddb', name: 'p5', openedAt: 5000 });
    const recent = await storage.listRecent();
    expect(recent).toHaveLength(12);
    expect(recent[0]!.key).toBe('idb:p5');
    expect(recent.map((r) => r.key)).not.toContain('idb:p0');
    await storage.removeRecent('idb:p5');
    expect((await storage.listRecent()).map((r) => r.key)).not.toContain('idb:p5');
  });

  it('keeps a handle for a local folder', async () => {
    await storage.addRecent({ key: 'fs:x', kind: 'fs-access', name: 'x', handle: { kind: 'directory', name: 'x' } });
    expect((await storage.listRecent())[0]!.handle).toEqual({ kind: 'directory', name: 'x' });
  });

  it('stores meta values', async () => {
    expect(await storage.getMeta('session')).toBeUndefined();
    await storage.setMeta('session', { tabs: ['a'] });
    expect(await storage.getMeta('session')).toEqual({ tabs: ['a'] });
  });
});
