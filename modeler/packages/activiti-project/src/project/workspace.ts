import { readAll, renameFile, type StorageAdapter } from '../storage/adapter';
import { bpmnPathForExtensions, classifyFile } from './kinds';
import { type ProjectFileData, ProjectModel } from './model';
import { assertValidPath } from './paths';

/** Where unsaved edits are kept so that a crash or reload loses nothing (IndexedDB in the app). */
export interface DraftStore {
  saveDraft(scope: string, path: string, content: string): Promise<void>;
  listDrafts(scope: string): Promise<Array<{ path: string; content: string; updated: number }>>;
  deleteDraft(scope: string, path: string): Promise<void>;
  clearDrafts(scope: string): Promise<void>;
}

export interface RecoverableDraft {
  path: string;
  content: string;
  updated: number;
}

/**
 * An open project: the storage it lives in, its files (`ProjectModel`) and the draft store. All operations that change the
 * storage go through here, so the model always mirrors what was really written.
 */
export class ProjectWorkspace {
  readonly model: ProjectModel;
  /** Files that could not be read when the project was opened. */
  loadFailures: Array<{ path: string; message: string }> = [];

  constructor(
    readonly adapter: StorageAdapter,
    readonly drafts?: DraftStore,
    files: Iterable<ProjectFileData> = [],
  ) {
    this.model = new ProjectModel(files);
  }

  /** Reads every file of the storage. */
  static async open(adapter: StorageAdapter, drafts?: DraftStore): Promise<ProjectWorkspace> {
    const { files, failures } = await readAll(adapter);
    const workspace = new ProjectWorkspace(adapter, drafts, files);
    workspace.loadFailures = failures;
    return workspace;
  }

  get key(): string {
    return this.adapter.key;
  }

  get name(): string {
    return this.adapter.name;
  }

  get label(): string {
    return this.adapter.label;
  }

  /** Reloads from the storage, e.g. after files changed outside the modeler. Unsaved edits are dropped. */
  async refresh(): Promise<void> {
    const { files, failures } = await readAll(this.adapter);
    this.loadFailures = failures;
    this.model.load(files);
  }

  // --- changing files -----------------------------------------------------------------------------------------------

  /** Creates a new file in the storage; fails when it exists. */
  async createFile(path: string, content: string): Promise<void> {
    assertValidPath(path);
    if (this.model.has(path)) throw new Error(`A file ${path} already exists`);
    await this.adapter.write(path, content);
    this.model.markSaved(path, content);
  }

  /** Writes `content` to the storage (creating the file if needed) and clears its draft. */
  async saveFile(path: string, content: string): Promise<void> {
    assertValidPath(path);
    await this.adapter.write(path, content);
    this.model.markSaved(path, content);
    await this.dropDraft(path);
  }

  async renameFile(from: string, to: string): Promise<void> {
    assertValidPath(to);
    if (!this.model.has(from)) throw new Error(`No such file: ${from}`);
    if (this.model.has(to)) throw new Error(`A file ${to} already exists`);
    await renameFile(this.adapter, from, to);
    const draft = this.model.isDirty(from) ? this.model.read(from) : undefined;
    this.model.markRenamed(from, to);
    await this.dropDraft(from);
    if (draft !== undefined) await this.drafts?.saveDraft(this.key, to, draft);
  }

  async deleteFile(path: string): Promise<void> {
    await this.adapter.remove(path);
    this.model.markDeleted(path);
    await this.dropDraft(path);
  }

  // --- unsaved edits and drafts ---------------------------------------------------------------------------------------

  /** Records the working copy of a file and keeps a draft of it. Setting the saved text again removes the draft. */
  async edit(path: string, content: string): Promise<void> {
    this.model.edit(path, content);
    if (this.model.isDirty(path)) await this.drafts?.saveDraft(this.key, path, content);
    else await this.dropDraft(path);
  }

  /** Throws away the working copy and the draft of a file. */
  async discard(path: string): Promise<void> {
    this.model.discard(path);
    await this.dropDraft(path);
  }

  private async dropDraft(path: string): Promise<void> {
    await this.drafts?.deleteDraft(this.key, path);
  }

  /** Drafts that differ from the saved files (stale ones are removed). Call after opening to offer recovery. */
  async pendingDrafts(): Promise<RecoverableDraft[]> {
    if (!this.drafts) return [];
    const result: RecoverableDraft[] = [];
    for (const draft of await this.drafts.listDrafts(this.key)) {
      // the extensions file of a process may not exist yet: its draft is kept as long as the process file is there
      const orphan = !this.model.has(draft.path) && !(classifyFile(draft.path) === 'extensions' && bpmnPathForExtensions(draft.path, this.model.paths()));
      if (orphan || this.model.saved(draft.path) === draft.content) {
        await this.drafts.deleteDraft(this.key, draft.path);
        continue;
      }
      result.push(draft);
    }
    return result;
  }

  /** Puts drafts back as working copies (the files are dirty until saved). */
  recover(drafts: readonly RecoverableDraft[]): void {
    for (const draft of drafts) this.model.edit(draft.path, draft.content);
  }

  async discardDrafts(): Promise<void> {
    await this.drafts?.clearDrafts(this.key);
  }
}
