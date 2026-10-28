import type { ProjectFile } from '../assemble';
import { assertValidPath, comparePaths } from './paths';

/** A file of a modeler project, addressed by its project-relative path (the same shape the project assembler uses). */
export type ProjectFileData = ProjectFile;

export type ProjectChange =
  | { type: 'loaded' }
  | { type: 'created' | 'saved' | 'deleted' | 'edited' | 'reverted'; path: string }
  | { type: 'renamed'; path: string; from: string };

/**
 * The files of an open project: what is saved in the storage and, for files with unsaved edits, the working copy.
 * Pure state; the storage is written by `ProjectWorkspace`. Dirty means "the working copy differs from the saved text".
 */
export class ProjectModel {
  private readonly savedFiles = new Map<string, string>();
  private readonly working = new Map<string, string>();
  private readonly listeners = new Set<(change: ProjectChange) => void>();
  private version = 0;

  constructor(files: Iterable<ProjectFileData> = []) {
    for (const file of files) this.savedFiles.set(assertValidPath(file.path), file.content);
  }

  /** Changes on every modification; for `useSyncExternalStore`. */
  get revision(): number {
    return this.version;
  }

  onChange(listener: (change: ProjectChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: ProjectChange): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener(change);
  }

  /** All file paths, folders first, alphabetical. */
  paths(): string[] {
    return [...this.savedFiles.keys()].sort(comparePaths);
  }

  has(path: string): boolean {
    return this.savedFiles.has(path);
  }

  /** The text as saved in the storage. */
  saved(path: string): string | undefined {
    return this.savedFiles.get(path);
  }

  /** The text to show: the working copy if there is one, otherwise the saved text. */
  read(path: string): string | undefined {
    return this.working.get(path) ?? this.savedFiles.get(path);
  }

  isDirty(path: string): boolean {
    return this.working.has(path);
  }

  dirtyPaths(): string[] {
    return [...this.working.keys()].sort(comparePaths);
  }

  /**
   * Replaces the working copy. Setting the saved text again clears the dirty state. A path that is not saved yet gets a
   * working copy of its own (it does not show up in `paths()` until it is saved): a process whose extensions file does not
   * exist yet keeps its unsaved extensions that way.
   */
  edit(path: string, content: string): void {
    assertValidPath(path);
    const wasDirty = this.working.has(path);
    if (content === this.savedFiles.get(path)) {
      if (wasDirty) {
        this.working.delete(path);
        this.emit({ type: 'reverted', path });
      }
      return;
    }
    if (this.working.get(path) === content) return;
    this.working.set(path, content);
    this.emit({ type: 'edited', path });
  }

  /** Drops the working copy of a file. */
  discard(path: string): void {
    if (this.working.delete(path)) this.emit({ type: 'reverted', path });
  }

  /** Records that `content` is now what the storage holds (after a successful write). */
  markSaved(path: string, content: string): void {
    assertValidPath(path);
    const existed = this.savedFiles.has(path);
    this.savedFiles.set(path, content);
    this.working.delete(path);
    this.emit({ type: existed ? 'saved' : 'created', path });
  }

  /** Mirrors a rename in the storage. The working copy moves with the file. */
  markRenamed(from: string, to: string): void {
    assertValidPath(to);
    const saved = this.savedFiles.get(from);
    if (saved === undefined) throw new Error(`No such project file: ${from}`);
    if (this.savedFiles.has(to)) throw new Error(`A file ${to} already exists`);
    this.savedFiles.delete(from);
    this.savedFiles.set(to, saved);
    const edit = this.working.get(from);
    if (edit !== undefined) {
      this.working.delete(from);
      this.working.set(to, edit);
    }
    this.emit({ type: 'renamed', path: to, from });
  }

  markDeleted(path: string): void {
    if (!this.savedFiles.delete(path)) return;
    this.working.delete(path);
    this.emit({ type: 'deleted', path });
  }

  /** Replaces everything (after opening a project). */
  load(files: Iterable<ProjectFileData>): void {
    this.savedFiles.clear();
    this.working.clear();
    for (const file of files) this.savedFiles.set(assertValidPath(file.path), file.content);
    this.emit({ type: 'loaded' });
  }

  /** The saved files, e.g. for a zip export. */
  snapshot(): ProjectFileData[] {
    return this.paths().map((path) => ({ path, content: this.savedFiles.get(path) as string }));
  }
}
