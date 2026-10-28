import { isProjectTextFile } from '../project/kinds';
import { assertValidPath } from '../project/paths';
import type { StorageAdapter, StorageKind } from './adapter';

/** The parts of the File System Access API handles that the adapter uses (so tests can pass a mock). */
export interface FsFileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string>; size: number }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export interface FsDirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterable<[string, FsFileHandleLike | FsDirectoryHandleLike]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

/** Folders that are never part of a project when the user opens a repository or a Maven module as a folder. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'target', 'build', 'dist', 'out']);
const MAX_FILES = 5000;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface PickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FsDirectoryHandleLike>;
}

/**
 * A local folder through the File System Access API (Chromium). The folder is the project root; files are read and
 * written in place. Where the API is missing (Firefox, Safari) use the browser workspace and the zip import / export.
 */
export class FsAccessStorage implements StorageAdapter {
  readonly kind: StorageKind = 'fs-access';
  readonly label = 'Local folder';

  constructor(readonly root: FsDirectoryHandleLike) {}

  get name(): string {
    return this.root.name;
  }

  get key(): string {
    return `fs:${this.root.name}`;
  }

  /** Whether this browser can open a local folder. */
  static isSupported(scope: PickerWindow = typeof window === 'undefined' ? {} : (window as PickerWindow)): boolean {
    return typeof scope.showDirectoryPicker === 'function';
  }

  /** Shows the folder picker; resolves to undefined when the user cancels. */
  static async pick(scope: PickerWindow = window as PickerWindow): Promise<FsAccessStorage | undefined> {
    if (!FsAccessStorage.isSupported(scope)) throw new Error('Opening a local folder is not supported by this browser. Use the browser workspace and the zip import / export instead.');
    try {
      return new FsAccessStorage(await scope.showDirectoryPicker!({ mode: 'readwrite', id: 'activiti-modeler' }));
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return undefined;
      throw e;
    }
  }

  /** Asks for read / write access to a handle that was stored earlier. Needs a user gesture. */
  async ensurePermission(): Promise<boolean> {
    const descriptor = { mode: 'readwrite' as const };
    if (!this.root.queryPermission) return true;
    if ((await this.root.queryPermission(descriptor)) === 'granted') return true;
    return (await this.root.requestPermission?.(descriptor)) === 'granted';
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: FsDirectoryHandleLike, prefix: string, depth: number): Promise<void> => {
      for await (const [name, handle] of dir.entries()) {
        if (out.length >= MAX_FILES) return;
        if (handle.kind === 'directory') {
          if (depth < MAX_DEPTH && !name.startsWith('.') && !SKIPPED_FOLDERS.has(name)) await walk(handle, `${prefix}${name}/`, depth + 1);
        } else if (isProjectTextFile(name) && !name.startsWith('.')) {
          out.push(`${prefix}${name}`);
        }
      }
    };
    await walk(this.root, '', 0);
    return out;
  }

  private async fileHandle(path: string, create: boolean): Promise<FsFileHandleLike> {
    assertValidPath(path);
    const segments = path.split('/');
    let dir = this.root;
    for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create });
    return dir.getFileHandle(segments[segments.length - 1]!, { create });
  }

  async read(path: string): Promise<string> {
    const file = await (await this.fileHandle(path, false)).getFile();
    if (file.size > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    return file.text();
  }

  async write(path: string, content: string): Promise<void> {
    const writable = await (await this.fileHandle(path, true)).createWritable();
    await writable.write(content);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    assertValidPath(path);
    const segments = path.split('/');
    let dir = this.root;
    for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
    await dir.removeEntry(segments[segments.length - 1]!);
  }
}
