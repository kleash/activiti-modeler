import { describe, expect, it } from 'vitest';

import { FsAccessStorage, type FsDirectoryHandleLike, type FsFileHandleLike } from './fs-access';

/** In-memory stand-ins for the File System Access API handles. */
class MockFile implements FsFileHandleLike {
  readonly kind = 'file' as const;
  content = '';
  constructor(readonly name: string) {}
  async getFile() {
    const content = this.content;
    return { size: content.length, text: async () => content };
  }
  async createWritable() {
    let buffer = '';
    return {
      write: async (data: string) => void (buffer += data),
      close: async () => void (this.content = buffer),
    };
  }
}

class MockDir implements FsDirectoryHandleLike {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MockFile | MockDir>();
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  constructor(readonly name: string) {}
  async *entries(): AsyncIterable<[string, FsFileHandleLike | FsDirectoryHandleLike]> {
    for (const entry of this.children) yield entry;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) this.children.set(name, (child = new MockDir(name)));
    if (!(child instanceof MockDir)) throw new DOMException(`${name} not found`, 'NotFoundError');
    return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) this.children.set(name, (child = new MockFile(name)));
    if (!(child instanceof MockFile)) throw new DOMException(`${name} not found`, 'NotFoundError');
    return child;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException(`${name} not found`, 'NotFoundError');
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    this.permission = 'granted';
    return this.permission;
  }
}

async function seeded(): Promise<{ root: MockDir; storage: FsAccessStorage }> {
  const root = new MockDir('my-project');
  const storage = new FsAccessStorage(root);
  await storage.write('project.json', '{"name":"my-project"}');
  await storage.write('processes/a.bpmn20.xml', '<a/>');
  await storage.write('processes/a-extensions.json', '{}');
  return { root, storage };
}

describe('FsAccessStorage', () => {
  it('reads and writes in place, creating folders', async () => {
    const { root, storage } = await seeded();
    expect(storage.key).toBe('fs:my-project');
    expect(storage.name).toBe('my-project');
    expect(((root.children.get('processes') as MockDir).children.get('a.bpmn20.xml') as MockFile).content).toBe('<a/>');
    expect(await storage.read('processes/a.bpmn20.xml')).toBe('<a/>');
    await storage.write('processes/a.bpmn20.xml', '<changed/>');
    expect(await storage.read('processes/a.bpmn20.xml')).toBe('<changed/>');
  });

  it('lists text files recursively and skips hidden folders, build output and other file types', async () => {
    const { root, storage } = await seeded();
    const hidden = new MockDir('.git');
    hidden.children.set('config.json', new MockFile('config.json'));
    root.children.set('.git', hidden);
    const modules = new MockDir('node_modules');
    modules.children.set('x.json', new MockFile('x.json'));
    root.children.set('node_modules', modules);
    root.children.set('logo.png', new MockFile('logo.png'));
    root.children.set('.hidden.json', new MockFile('.hidden.json'));
    expect((await storage.list()).sort()).toEqual(['processes/a-extensions.json', 'processes/a.bpmn20.xml', 'project.json']);
  });

  it('removes a file and reports a missing one', async () => {
    const { storage } = await seeded();
    await storage.remove('project.json');
    expect(await storage.list()).not.toContain('project.json');
    await expect(storage.remove('project.json')).rejects.toThrow();
    await expect(storage.read('processes/missing.dmn')).rejects.toThrow();
  });

  it('refuses paths that escape the folder', async () => {
    const { storage } = await seeded();
    await expect(storage.read('../secret.json')).rejects.toThrow(/Invalid project path/);
    await expect(storage.write('/abs.json', '')).rejects.toThrow(/Invalid project path/);
  });

  it('asks for permission when it is not granted', async () => {
    const root = new MockDir('p');
    root.permission = 'prompt';
    const storage = new FsAccessStorage(root);
    expect(await storage.ensurePermission()).toBe(true);
    expect(root.permission).toBe('granted');
  });

  it('feature-detects the picker and returns undefined when the user cancels', async () => {
    expect(FsAccessStorage.isSupported({})).toBe(false);
    const root = new MockDir('picked');
    expect(FsAccessStorage.isSupported({ showDirectoryPicker: async () => root })).toBe(true);
    const picked = await FsAccessStorage.pick({ showDirectoryPicker: async () => root });
    expect(picked?.name).toBe('picked');
    const cancelled = await FsAccessStorage.pick({
      showDirectoryPicker: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      },
    });
    expect(cancelled).toBeUndefined();
    await expect(FsAccessStorage.pick({})).rejects.toThrow(/not supported/);
  });
});
