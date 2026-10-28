import { assertValidPath } from '../project/paths';

export type StorageKind = 'indexeddb' | 'fs-access' | 'server' | 'memory';

/**
 * Where the files of one project live. Paths are project-relative (`processes/a.bpmn20.xml`), contents are UTF-8 text.
 * Implementations: IndexedDB (default, offline), File System Access API (a local folder, Chromium), the modeler server's
 * workspace and an in-memory store (used by the zip import and by tests).
 */
export interface StorageAdapter {
  readonly kind: StorageKind;
  /** Stable key of the project, used for recent projects and drafts: `idb:<name>`, `fs:<folder>`, `server:<url>`. */
  readonly key: string;
  /** Project (folder) name. */
  readonly name: string;
  /** Short human text for the status bar: "Browser workspace", "Local folder", "Server workspace". */
  readonly label: string;
  /** Paths of all files (text files only), in no particular order. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  /** Creates or replaces a file (and its folders). */
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Optional native rename; the default is read, write, remove (see `renameFile`). */
  rename?(from: string, to: string): Promise<void>;
}

/** Moves a file within a storage; fails when the target exists. */
export async function renameFile(adapter: StorageAdapter, from: string, to: string): Promise<void> {
  assertValidPath(to);
  if (from === to) return;
  if ((await adapter.list()).includes(to)) throw new Error(`A file ${to} already exists`);
  if (adapter.rename) {
    await adapter.rename(from, to);
    return;
  }
  const content = await adapter.read(from);
  await adapter.write(to, content);
  await adapter.remove(from);
}

/** Reads every file of a storage; files that cannot be read are reported, not skipped silently. */
export async function readAll(adapter: StorageAdapter): Promise<{ files: Array<{ path: string; content: string }>; failures: Array<{ path: string; message: string }> }> {
  const files: Array<{ path: string; content: string }> = [];
  const failures: Array<{ path: string; message: string }> = [];
  for (const path of (await adapter.list()).sort()) {
    try {
      files.push({ path, content: await adapter.read(path) });
    } catch (e) {
      failures.push({ path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { files, failures };
}
