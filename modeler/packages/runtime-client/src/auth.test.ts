import { describe, expect, it } from 'vitest';

import { basicAuth, bearerAuth, cookieAuth, noAuth, RuntimeClient, type PreparedRequest } from './index';

function request(method = 'GET'): PreparedRequest {
  return { method, url: '/api/engine', headers: {} };
}

describe('basicAuth', () => {
  it('sends the user and password', async () => {
    const r = request();
    await basicAuth('modeler', 'secret').prepare(r);
    expect(r.headers['Authorization']).toBe(`Basic ${btoa('modeler:secret')}`);
  });

  it('encodes non-ASCII credentials as UTF-8 (RFC 7617)', async () => {
    const r = request();
    await basicAuth('zoë', 'pässword').prepare(r);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(r.headers['Authorization']!.slice(6)), (c) => c.charCodeAt(0)));
    expect(decoded).toBe('zoë:pässword');
  });

  it('is what the credentials shorthand uses', async () => {
    const seen: Record<string, string>[] = [];
    const client = new RuntimeClient({
      credentials: { username: 'u', password: 'p' },
      fetch: async (_url, init) => {
        seen.push(init?.headers as Record<string, string>);
        return new Response('{}');
      },
    });
    await client.getEngine();
    expect(seen[0]!['Authorization']).toBe(`Basic ${btoa('u:p')}`);
  });
});

describe('bearerAuth', () => {
  it('sends a fixed token', async () => {
    const r = request();
    await bearerAuth('abc').prepare(r);
    expect(r.headers['Authorization']).toBe('Bearer abc');
  });

  it('asks a token provider for every request, so a refreshed token is used', async () => {
    let n = 0;
    const auth = bearerAuth(async () => `t${++n}`);
    const first = request();
    const second = request();
    await auth.prepare(first);
    await auth.prepare(second);
    expect([first.headers['Authorization'], second.headers['Authorization']]).toEqual(['Bearer t1', 'Bearer t2']);
  });
});

describe('cookieAuth', () => {
  const cookies: Record<string, string> = { 'XSRF-TOKEN': 'csrf-1', 'MY-CSRF': 'csrf-2' };
  const readCookie = (name: string) => cookies[name];

  it('sends the session cookie of the page origin and no CSRF header for a read', async () => {
    const r = request('GET');
    await cookieAuth({ readCookie }).prepare(r);
    expect(r.credentials).toBe('same-origin');
    expect(r.headers).toEqual({});
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('puts the CSRF token from its cookie into the header of a %s', async (method) => {
    const r = request(method);
    await cookieAuth({ readCookie }).prepare(r);
    expect(r.headers['X-XSRF-TOKEN']).toBe('csrf-1');
  });

  it('knows other cookie and header names and cross-origin credentials', async () => {
    const r = request('POST');
    await cookieAuth({ readCookie, csrfCookie: 'MY-CSRF', csrfHeader: 'X-CSRF', credentials: 'include' }).prepare(r);
    expect(r.headers['X-CSRF']).toBe('csrf-2');
    expect(r.credentials).toBe('include');
  });

  it('sends no header when the cookie is absent', async () => {
    const r = request('POST');
    await cookieAuth({ readCookie: () => undefined }).prepare(r);
    expect(r.headers).toEqual({});
  });

  it('reaches fetch as credentials and header', async () => {
    const seen: RequestInit[] = [];
    const client = new RuntimeClient({
      auth: cookieAuth({ readCookie }),
      fetch: async (_url, init) => {
        seen.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    });
    await client.suspendProcessInstance('i1');
    expect(seen[0]!.credentials).toBe('same-origin');
    expect((seen[0]!.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('csrf-1');
  });
});

describe('noAuth', () => {
  it('adds nothing', async () => {
    const r = request();
    await noAuth.prepare(r);
    expect(r.headers).toEqual({});
    expect(r.credentials).toBeUndefined();
  });
});
