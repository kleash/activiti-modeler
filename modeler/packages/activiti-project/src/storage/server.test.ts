import { describe, expect, it } from 'vitest';

import { ServerWorkspaceStorage } from './server';

/** A mock of the server's `GET/PUT/DELETE /api/dev/workspace/**` (activiti-runtime-rest-dev): entries are relative to the workspace root. */
function mockServer(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const base = '/api/dev/workspace';
  const respond = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : status === 201 ? 'Created' : 'OK',
    text: async () => String(body),
    json: async () => body,
  });
  const directories = (): Set<string> => {
    const out = new Set<string>();
    for (const path of files.keys()) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i += 1) out.add(parts.slice(0, i).join('/'));
    }
    return out;
  };
  const fetch = async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const [rawPath = '', query = ''] = url.slice(base.length).split('?');
    const path = decodeURIComponent(rawPath.replace(/^\//, ''));
    const recursive = query.includes('recursive=true');
    if (method === 'PUT') {
      const created = !files.has(path);
      files.set(path, init!.body!);
      return respond(created ? 201 : 204, '');
    }
    if (method === 'DELETE') return files.delete(path) ? respond(204, '') : respond(404, 'missing');
    if (path === '' || directories().has(path)) {
      const prefix = path === '' ? '' : `${path}/`;
      const entries = [
        ...[...directories()].filter((d) => d.startsWith(prefix) && d !== path && (recursive || !d.slice(prefix.length).includes('/'))).map((d) => ({ path: d, type: 'directory' })),
        ...[...files.keys()].filter((f) => f.startsWith(prefix) && (recursive || !f.slice(prefix.length).includes('/'))).map((f) => ({ path: f, type: 'file', size: files.get(f)!.length })),
      ];
      return respond(200, { path, entries });
    }
    return files.has(path) ? respond(200, files.get(path)) : respond(404, 'missing');
  };
  return { files, calls, fetch };
}

const WORKSPACE = {
  'shop/project.json': '{"name":"shop"}',
  'shop/processes/order.bpmn20.xml': '<a/>',
  'shop/processes/a b.dmn': '<d/>',
  'other/project.json': '{}',
};

describe('ServerWorkspaceStorage', () => {
  it('lists the projects of the workspace: its top-level folders', async () => {
    const server = mockServer(WORKSPACE);
    expect(await ServerWorkspaceStorage.listProjects({ url: '/api/dev/workspace', fetch: server.fetch })).toEqual(['other', 'shop']);
  });

  it('lists, reads, writes and deletes the files of one project; paths are relative to the project folder', async () => {
    const server = mockServer(WORKSPACE);
    const storage = new ServerWorkspaceStorage({ url: '/api/dev/workspace/', project: 'shop', fetch: server.fetch });
    expect(storage.key).toBe('server:/api/dev/workspace/shop');
    expect(storage.name).toBe('shop');
    expect((await storage.list()).sort()).toEqual(['processes/a b.dmn', 'processes/order.bpmn20.xml', 'project.json']);
    expect(await storage.read('processes/a b.dmn')).toBe('<d/>');
    await storage.write('scenarios/x.scenario.json', '{"name":"x"}');
    expect(server.files.get('shop/scenarios/x.scenario.json')).toBe('{"name":"x"}');
    await storage.remove('project.json');
    expect(server.files.has('shop/project.json')).toBe(false);
    // the other project is never listed, folder separators stay, file names are encoded
    expect((await storage.list()).sort()).toEqual(['processes/a b.dmn', 'processes/order.bpmn20.xml', 'scenarios/x.scenario.json']);
    expect(server.calls).toContain('GET /api/dev/workspace/shop?recursive=true');
    expect(server.calls).toContain('GET /api/dev/workspace/shop/processes/a%20b.dmn');
    expect(server.calls).toContain('PUT /api/dev/workspace/shop/scenarios/x.scenario.json');
  });

  it('treats the whole workspace as the project when no folder is given', async () => {
    const server = mockServer({ 'project.json': '{}', 'processes/a.bpmn20.xml': '<a/>' });
    const storage = new ServerWorkspaceStorage({ url: '/api/dev/workspace', fetch: server.fetch });
    expect((await storage.list()).sort()).toEqual(['processes/a.bpmn20.xml', 'project.json']);
  });

  it('a project that does not exist yet is empty when allowed, and an error otherwise', async () => {
    const server = mockServer(WORKSPACE);
    const missing = new ServerWorkspaceStorage({ url: '/api/dev/workspace', project: 'new-one', fetch: server.fetch });
    await expect(missing.list()).rejects.toThrow('answered 404 Not Found');
    const allowed = new ServerWorkspaceStorage({ url: '/api/dev/workspace', project: 'new-one', allowMissing: true, fetch: server.fetch });
    expect(await allowed.list()).toEqual([]);
    await allowed.write('project.json', '{}');
    expect(await allowed.list()).toEqual(['project.json']);
  });

  it('accepts a plain array of paths and the { files } shape as a listing', async () => {
    const json = (body: unknown) => async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '', json: async () => body });
    expect(await new ServerWorkspaceStorage({ url: '/w', fetch: json(['a.json', 'b/c.dmn']) }).list()).toEqual(['a.json', 'b/c.dmn']);
    expect(await new ServerWorkspaceStorage({ url: '/w', fetch: json({ files: [{ path: 'a.json' }, 'b.json'] }) }).list()).toEqual(['a.json', 'b.json']);
    await expect(new ServerWorkspaceStorage({ url: '/w', fetch: json({ nope: 1 }) }).list()).rejects.toThrow('listing must be');
  });

  it('turns HTTP errors and network failures into readable errors', async () => {
    const server = mockServer();
    const storage = new ServerWorkspaceStorage({ url: '/api/dev/workspace', fetch: server.fetch });
    await expect(storage.read('nope.json')).rejects.toThrow('answered 404 Not Found for GET /api/dev/workspace/nope.json');
    const down = new ServerWorkspaceStorage({
      url: 'http://127.0.0.1:1/w',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(down.list()).rejects.toThrow(/not reachable.*Failed to fetch/);
  });

  it('sends the configured headers', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const storage = new ServerWorkspaceStorage({
      url: '/w',
      headers: { Authorization: 'Basic abc' },
      fetch: async (_url, init) => {
        seen.push(init?.headers);
        return { ok: true, status: 200, statusText: 'OK', text: async () => '', json: async () => [] };
      },
    });
    await storage.list();
    expect(seen[0]?.['Authorization']).toBe('Basic abc');
  });

  it('refuses paths that escape the project folder', async () => {
    const storage = new ServerWorkspaceStorage({ url: '/w', project: 'shop', fetch: mockServer().fetch });
    await expect(storage.read('../etc/passwd')).rejects.toThrow(/Invalid project path/);
  });
});
