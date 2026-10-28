import { describe, expect, it } from 'vitest';

import { CONNECTION_STORAGE_KEY, ConnectionService, defaultBaseUrl } from './connection';

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (key: string): string | null => this.data.get(key) ?? null;
  setItem = (key: string, value: string): void => void this.data.set(key, value);
  removeItem = (key: string): void => void this.data.delete(key);
}

const ENGINE = {
  activitiVersion: '9.0.0', springBootVersion: '3.5.16', javaVersion: '25', historyLevel: 'full', dbHistoryUsed: true,
  asyncExecutor: { active: true, configured: true }, dmn: { available: true, engine: 'operaton' }, basePath: '/api', beans: [], connectors: [], scriptEngines: [],
};

interface Call {
  url: string;
  authorization: string | undefined;
}

/** A fake server: /api/health is public, /api/engine needs `modeler:modeler`. */
function server(options: { down?: boolean } = {}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: input, authorization: headers['Authorization'] });
    if (options.down) throw new TypeError('Failed to fetch');
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' } });
    if (input.endsWith('/api/health')) return json(200, { app: 'activiti-modeler-server', status: 'UP' });
    if (input.endsWith('/api/engine')) {
      return headers['Authorization'] === `Basic ${btoa('modeler:modeler')}` ? json(200, ENGINE) : json(401, { status: 401, title: 'Authentication required' });
    }
    return json(404, { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const settings = { baseUrl: 'http://localhost:8080', username: 'modeler', rememberPassword: false };

describe('ConnectionService', () => {
  it('does not ask on load when the page was not served by the modeler server and nothing was stored', async () => {
    const fake = server();
    const connection = new ConnectionService(new MemoryStorage(), fake.fetch, async () => false);
    await connection.init();
    connection.stop();
    expect(fake.calls).toEqual([]);
    expect(connection.getSnapshot().status).toBe('unknown');
    expect(connection.summary()).toBe('Server: not connected');
  });

  it('asks on load when the page was served by the modeler server, or the user connected a server before', async () => {
    const served = server();
    const own = new ConnectionService(new MemoryStorage(), served.fetch, async () => true);
    await own.init();
    own.stop();
    expect(served.calls).toHaveLength(1);

    const storage = new MemoryStorage();
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ baseUrl: 'http://localhost:8080', username: 'modeler', rememberPassword: false }));
    const remembered = server();
    const again = new ConnectionService(storage, remembered.fetch, async () => false);
    await again.init();
    again.stop();
    expect(remembered.calls).toHaveLength(1);
  });

  it('asks the health endpoint without credentials and then waits for a sign-in', async () => {
    const fake = server();
    const connection = new ConnectionService(new MemoryStorage(), fake.fetch);
    await connection.probe();
    expect(connection.getSnapshot().status).toBe('signed-out');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.authorization).toBeUndefined();
    expect(connection.summary()).toContain('not signed in');
  });

  it('signs in with Basic credentials and reports the engine', async () => {
    const connection = new ConnectionService(new MemoryStorage(), server().fetch);
    expect(await connection.connect(settings, 'modeler')).toBe(true);
    const snapshot = connection.getSnapshot();
    expect(snapshot.status).toBe('connected');
    expect(snapshot.user).toBe('modeler');
    expect(connection.summary()).toBe('Server: modeler@localhost:8080 - Activiti 9.0.0 - DMN operaton - executor on');
    expect(connection.authHeaders()).toEqual({ Authorization: `Basic ${btoa('modeler:modeler')}` });
    expect(connection.require()).toBeDefined();
  });

  it('keeps the password out of storage unless the person asked for it', async () => {
    const storage = new MemoryStorage();
    const connection = new ConnectionService(storage, server().fetch);
    await connection.connect(settings, 'modeler');
    expect(JSON.parse(storage.data.get(CONNECTION_STORAGE_KEY)!)).toEqual(settings);

    const remembering = new MemoryStorage();
    await new ConnectionService(remembering, server().fetch).connect({ ...settings, rememberPassword: true }, 'modeler');
    expect(JSON.parse(remembering.data.get(CONNECTION_STORAGE_KEY)!)).toEqual({ ...settings, rememberPassword: true, password: 'modeler' });
  });

  it('signs in by itself at start when the password was remembered', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ ...settings, rememberPassword: true, password: 'modeler' }));
    const connection = new ConnectionService(storage, server().fetch);
    await connection.init();
    connection.stop();
    expect(connection.getSnapshot().status).toBe('connected');
  });

  it('does not remember a password that was stored without the opt-in', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ ...settings, rememberPassword: false, password: 'modeler' }));
    const connection = new ConnectionService(storage, server().fetch);
    await connection.init();
    connection.stop();
    expect(connection.getSnapshot().status).toBe('signed-out');
  });

  it('refuses wrong credentials with a clear message and stays signed out', async () => {
    const connection = new ConnectionService(new MemoryStorage(), server().fetch);
    expect(await connection.connect(settings, 'nope')).toBe(false);
    const snapshot = connection.getSnapshot();
    expect(snapshot.status).toBe('signed-out');
    expect(snapshot.error).toContain('does not accept this user name and password');
    expect(connection.authHeaders()).toEqual({});
    expect(() => connection.require()).toThrow('Not connected');
  });

  it('reports a server that does not answer', async () => {
    const connection = new ConnectionService(new MemoryStorage(), server({ down: true }).fetch);
    await connection.probe();
    expect(connection.getSnapshot().status).toBe('unreachable');
    expect(connection.summary()).toBe('Server: not connected');
    expect(await connection.connect(settings, 'modeler')).toBe(false);
    expect(connection.getSnapshot().status).toBe('unreachable');
  });

  it('signing out forgets the remembered password', async () => {
    const storage = new MemoryStorage();
    const connection = new ConnectionService(storage, server().fetch);
    await connection.connect({ ...settings, rememberPassword: true }, 'modeler');
    connection.disconnect();
    expect(connection.getSnapshot().status).toBe('signed-out');
    expect(JSON.parse(storage.data.get(CONNECTION_STORAGE_KEY)!)).toEqual(settings);
  });

  it('expects the server on its default port when the page comes from vite', () => {
    expect(defaultBaseUrl({ port: '5173' })).toBe('http://localhost:8080');
    expect(defaultBaseUrl({ port: '4173' })).toBe('http://localhost:8080');
    expect(defaultBaseUrl({ port: '8080' })).toBe('');
    expect(defaultBaseUrl(undefined)).toBe('');
  });
});
