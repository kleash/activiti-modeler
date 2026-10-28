import { assertValidPath } from '../project/paths';
import type { StorageAdapter, StorageKind } from './adapter';

/** Files in memory. Used for a project that was just imported from a zip and by tests. */
export class MemoryStorage implements StorageAdapter {
  readonly kind: StorageKind = 'memory';
  readonly label = 'Memory';
  private readonly files = new Map<string, string>();

  constructor(
    readonly name = 'project',
    files: Iterable<{ path: string; content: string }> = [],
  ) {
    for (const f of files) this.files.set(assertValidPath(f.path), f.content);
  }

  get key(): string {
    return `memory:${this.name}`;
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`No such file: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(assertValidPath(path), content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}
