import { assertValidPath } from '../project/paths';
import type { StorageAdapter, StorageKind } from './adapter';

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: 'include' | 'same-origin' | 'omit' }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface ServerWorkspaceOptions {
  /** URL of the workspace resource, e.g. `/api/dev/workspace` or `http://127.0.0.1:8080/api/dev/workspace`. */
  url: string;
  /** The project folder inside the workspace (`shop` for `<workspace>/shop/processes/...`); empty: the workspace root itself. */
  project?: string;
  /** A project that does not exist yet is then an empty project (it is created by its first file). */
  allowMissing?: boolean;
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Extra headers, e.g. `Authorization: Basic ...` for the dev security chain. */
  headers?: Record<string, string>;
}

interface WorkspaceEntry {
  path: string;
  type?: string;
}

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/**
 * The modeler server's workspace: project files on the server's disk, below the folder the server is configured with
 * (`activiti-runtime-rest-dev`, `/api/dev/workspace`). Every top-level folder of the workspace is a project.
 *
 * - `GET <url>?recursive=true` lists the tree: `{ path, entries: [{ path, type: "file" | "directory", size, modified }] }`; entry
 *   paths are relative to the workspace root
 * - `GET <url>/<path>`   the text of a file
 * - `PUT <url>/<path>`   creates or replaces a file with the request body (and its folders): 201 or 204
 * - `DELETE <url>/<path>` deletes a file: 204
 *
 * A plain array of paths, or `{ files: [...] }`, is accepted as a listing too.
 */
export class ServerWorkspaceStorage implements StorageAdapter {
  readonly kind: StorageKind = 'server';
  readonly label = 'Server workspace';
  private readonly base: string;
  private readonly project: string;
  private readonly allowMissing: boolean;
  private readonly doFetch: FetchLike;
  private readonly headers: Record<string, string>;

  constructor(options: ServerWorkspaceOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.project = (options.project ?? '').replace(/^\/+|\/+$/g, '');
    this.allowMissing = options.allowMissing ?? false;
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init as RequestInit));
    this.headers = options.headers ?? {};
  }

  get name(): string {
    return this.project || this.base.replace(/^https?:\/\//, '');
  }

  get key(): string {
    return `server:${this.base}${this.project ? `/${this.project}` : ''}`;
  }

  /** The workspace URL (without the project). */
  get url(): string {
    return this.base;
  }

  get projectFolder(): string {
    return this.project;
  }

  /** The names of the projects (top-level folders) of a workspace. */
  static async listProjects(options: Pick<ServerWorkspaceOptions, 'url' | 'fetch' | 'headers'>): Promise<string[]> {
    const root = new ServerWorkspaceStorage({ ...options, project: '' });
    const entries = await root.entries(root.base);
    return entries
      .filter((e) => e.type === 'directory' && !e.path.includes('/'))
      .map((e) => e.path)
      .sort();
  }

  private fileUrl(path: string): string {
    assertValidPath(path);
    return `${this.base}/${encodePath(this.project ? `${this.project}/${path}` : path)}`;
  }

  private async request(url: string, method: string, body?: string): Promise<Awaited<ReturnType<FetchLike>>> {
    let response;
    try {
      response = await this.doFetch(url, {
        method,
        headers: { ...this.headers, ...(body !== undefined ? { 'Content-Type': 'text/plain; charset=utf-8' } : { Accept: 'application/json, text/plain' }) },
        ...(body !== undefined ? { body } : {}),
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new Error(`The modeler server is not reachable (${method} ${url}): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    if (!response.ok) throw Object.assign(new Error(`The modeler server answered ${response.status} ${response.statusText} for ${method} ${url}`), { status: response.status });
    return response;
  }

  /** The entries of a listing, whichever of the accepted shapes the server answers with. */
  private async entries(url: string): Promise<WorkspaceEntry[]> {
    const body = (await (await this.request(url, 'GET')).json()) as unknown;
    const list = Array.isArray(body) ? body : ((body as { entries?: unknown; files?: unknown } | null)?.entries ?? (body as { files?: unknown } | null)?.files);
    if (!Array.isArray(list)) throw new Error('The workspace listing must be { "entries": [...] }, { "files": [...] } or an array of paths');
    return list.map((e): WorkspaceEntry => (typeof e === 'string' ? { path: e, type: 'file' } : { path: String((e as { path?: unknown }).path), type: (e as { type?: string }).type ?? 'file' }));
  }

  async list(): Promise<string[]> {
    const url = `${this.base}${this.project ? `/${encodePath(this.project)}` : ''}?recursive=true`;
    let entries: WorkspaceEntry[];
    try {
      entries = await this.entries(url);
    } catch (e) {
      if (this.allowMissing && (e as { status?: number }).status === 404) return [];
      throw e;
    }
    const prefix = this.project ? `${this.project}/` : '';
    return entries.filter((e) => e.type !== 'directory' && e.path.startsWith(prefix)).map((e) => e.path.slice(prefix.length));
  }

  async read(path: string): Promise<string> {
    return (await this.request(this.fileUrl(path), 'GET')).text();
  }

  async write(path: string, content: string): Promise<void> {
    await this.request(this.fileUrl(path), 'PUT', content);
  }

  async remove(path: string): Promise<void> {
    await this.request(this.fileUrl(path), 'DELETE');
  }
}
