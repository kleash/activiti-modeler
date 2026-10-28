import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import { assertValidPath } from '../project/paths';
import type { StorageAdapter, StorageKind } from './adapter';

export const DEFAULT_DB_NAME = 'activiti-modeler';
const DB_VERSION = 1;

export interface ProjectRecord {
  name: string;
  created: number;
  modified: number;
}

interface FileRecord {
  project: string;
  path: string;
  content: string;
}

export interface DraftRecord {
  /** Project key (`idb:<name>`, `fs:<name>`, ...). */
  scope: string;
  path: string;
  content: string;
  updated: number;
}

export type RecentKind = 'indexeddb' | 'fs-access' | 'server';

export interface RecentProject {
  /** The project key (`idb:<name>`); one entry per key. */
  key: string;
  kind: RecentKind;
  name: string;
  openedAt: number;
  /** FileSystemDirectoryHandle for `fs-access` (structured clone), base URL for `server`. */
  handle?: unknown;
  url?: string;
  /** For `server`: the project folder inside the workspace at `url`. */
  project?: string;
}

interface ModelerDb extends DBSchema {
  projects: { key: string; value: ProjectRecord };
  files: { key: [string, string]; value: FileRecord; indexes: { byProject: string } };
  drafts: { key: [string, string]; value: DraftRecord; indexes: { byScope: string } };
  recent: { key: string; value: RecentProject; indexes: { byOpened: number } };
  meta: { key: string; value: { key: string; value: unknown } };
}

export interface IndexedDbOptions {
  /** Database name; tests use their own. */
  name?: string;
}

/** Whether the browser offers IndexedDB at all (it can be blocked, e.g. by site settings). */
export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * The browser workspace: every project is a set of files in IndexedDB, together with unsaved drafts, the recent
 * projects list and small pieces of session state.
 */
export class IndexedDbStorage {
  private constructor(private readonly db: IDBPDatabase<ModelerDb>) {}

  static async open(options: IndexedDbOptions = {}): Promise<IndexedDbStorage> {
    if (!indexedDbAvailable()) throw new Error('IndexedDB is not available in this browser');
    const db = await openDB<ModelerDb>(options.name ?? DEFAULT_DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('projects', { keyPath: 'name' });
        database.createObjectStore('files', { keyPath: ['project', 'path'] }).createIndex('byProject', 'project');
        database.createObjectStore('drafts', { keyPath: ['scope', 'path'] }).createIndex('byScope', 'scope');
        database.createObjectStore('recent', { keyPath: 'key' }).createIndex('byOpened', 'openedAt');
        database.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    return new IndexedDbStorage(db);
  }

  close(): void {
    this.db.close();
  }

  // --- projects ---------------------------------------------------------------------------------------------------

  async listProjects(): Promise<ProjectRecord[]> {
    return (await this.db.getAll('projects')).sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  }

  async hasProject(name: string): Promise<boolean> {
    return (await this.db.get('projects', name)) !== undefined;
  }

  /** Creates an empty project; fails when the name is taken. */
  async createProject(name: string): Promise<IndexedDbProject> {
    assertProjectName(name);
    if (await this.hasProject(name)) throw new Error(`A project named "${name}" already exists`);
    const now = Date.now();
    await this.db.put('projects', { name, created: now, modified: now });
    return new IndexedDbProject(this, name);
  }

  /** The adapter of an existing project. */
  async openProject(name: string): Promise<IndexedDbProject> {
    if (!(await this.hasProject(name))) throw new Error(`No project named "${name}" in the browser workspace`);
    return new IndexedDbProject(this, name);
  }

  /** A project name that is free: `name`, `name-2`, `name-3`, ... */
  async uniqueProjectName(name: string): Promise<string> {
    if (!(await this.hasProject(name))) return name;
    for (let n = 2; ; n += 1) if (!(await this.hasProject(`${name}-${n}`))) return `${name}-${n}`;
  }

  async deleteProject(name: string): Promise<void> {
    const tx = this.db.transaction(['projects', 'files', 'drafts', 'recent'], 'readwrite');
    await tx.objectStore('projects').delete(name);
    for (const key of await tx.objectStore('files').index('byProject').getAllKeys(name)) await tx.objectStore('files').delete(key);
    for (const key of await tx.objectStore('drafts').index('byScope').getAllKeys(`idb:${name}`)) await tx.objectStore('drafts').delete(key);
    await tx.objectStore('recent').delete(`idb:${name}`);
    await tx.done;
  }

  /** @internal used by `IndexedDbProject` */
  get database(): IDBPDatabase<ModelerDb> {
    return this.db;
  }

  // --- drafts ----------------------------------------------------------------------------------------------------

  async saveDraft(scope: string, path: string, content: string): Promise<void> {
    await this.db.put('drafts', { scope, path, content, updated: Date.now() });
  }

  async listDrafts(scope: string): Promise<DraftRecord[]> {
    return (await this.db.getAllFromIndex('drafts', 'byScope', scope)).sort((a, b) => a.path.localeCompare(b.path));
  }

  async deleteDraft(scope: string, path: string): Promise<void> {
    await this.db.delete('drafts', [scope, path]);
  }

  async clearDrafts(scope: string): Promise<void> {
    const tx = this.db.transaction('drafts', 'readwrite');
    for (const key of await tx.store.index('byScope').getAllKeys(scope)) await tx.store.delete(key);
    await tx.done;
  }

  // --- recent projects ----------------------------------------------------------------------------------------------

  async addRecent(entry: Omit<RecentProject, 'openedAt'> & { openedAt?: number }): Promise<void> {
    await this.db.put('recent', { ...entry, openedAt: entry.openedAt ?? Date.now() });
    const all = await this.db.getAllFromIndex('recent', 'byOpened');
    // keep the 12 most recent
    for (const old of all.slice(0, Math.max(0, all.length - 12))) await this.db.delete('recent', old.key);
  }

  /** Most recently opened first. */
  async listRecent(): Promise<RecentProject[]> {
    return (await this.db.getAllFromIndex('recent', 'byOpened')).reverse();
  }

  async removeRecent(key: string): Promise<void> {
    await this.db.delete('recent', key);
  }

  // --- session -------------------------------------------------------------------------------------------------------

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', { key, value });
  }
}

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

export function assertProjectName(name: string): void {
  if (!PROJECT_NAME.test(name) || name.endsWith('.') || name.endsWith(' ')) {
    throw new Error(`Invalid project name "${name}": use letters, digits, ".", "_", "-" and spaces (at most 64 characters)`);
  }
}

/** One project of the browser workspace as a storage adapter. */
export class IndexedDbProject implements StorageAdapter {
  readonly kind: StorageKind = 'indexeddb';
  readonly label = 'Browser workspace';

  constructor(
    private readonly storage: IndexedDbStorage,
    readonly name: string,
  ) {}

  get key(): string {
    return `idb:${this.name}`;
  }

  async list(): Promise<string[]> {
    return (await this.storage.database.getAllKeysFromIndex('files', 'byProject', this.name)).map((k) => k[1]);
  }

  async read(path: string): Promise<string> {
    const record = await this.storage.database.get('files', [this.name, path]);
    if (!record) throw new Error(`No such file: ${path}`);
    return record.content;
  }

  async write(path: string, content: string): Promise<void> {
    assertValidPath(path);
    const tx = this.storage.database.transaction(['files', 'projects'], 'readwrite');
    await tx.objectStore('files').put({ project: this.name, path, content });
    const project = await tx.objectStore('projects').get(this.name);
    if (project) await tx.objectStore('projects').put({ ...project, modified: Date.now() });
    await tx.done;
  }

  async remove(path: string): Promise<void> {
    await this.storage.database.delete('files', [this.name, path]);
  }

  async rename(from: string, to: string): Promise<void> {
    assertValidPath(to);
    const tx = this.storage.database.transaction('files', 'readwrite');
    const record = await tx.store.get([this.name, from]);
    if (!record) throw new Error(`No such file: ${from}`);
    await tx.store.put({ ...record, path: to });
    await tx.store.delete([this.name, from]);
    await tx.done;
  }
}
