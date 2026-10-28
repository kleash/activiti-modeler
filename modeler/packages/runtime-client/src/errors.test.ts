import { describe, expect, it } from 'vitest';

import { RuntimeApiError, RuntimeClient, RuntimeNetworkError } from './index';

function clientAnswering(response: () => Response | Promise<Response>): RuntimeClient {
  return new RuntimeClient({ baseUrl: 'http://host', fetch: async () => response() });
}

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ status, ...body }), { status, headers: { 'Content-Type': 'application/problem+json' } });
}

describe('error mapping', () => {
  it('maps a problem document to a RuntimeApiError with its members', async () => {
    const client = clientAnswering(() =>
      problem(404, {
        title: 'Not found',
        detail: 'No process instance found for id i9',
        engineException: 'org.activiti.engine.ActivitiObjectNotFoundException',
        rootCause: 'java.lang.IllegalStateException: gone',
      }),
    );

    const error = await client.getProcessInstance('i9').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeApiError);
    const api = error as RuntimeApiError;
    expect(api.status).toBe(404);
    expect(api.isNotFound).toBe(true);
    expect(api.title).toBe('Not found');
    expect(api.detail).toBe('No process instance found for id i9');
    expect(api.engineException).toBe('org.activiti.engine.ActivitiObjectNotFoundException');
    expect(api.rootCause).toBe('java.lang.IllegalStateException: gone');
    expect(api.method).toBe('GET');
    expect(api.url).toBe('http://host/api/process-instances/i9');
    expect(api.message).toContain('404 Not found: No process instance found for id i9');
  });

  it('keeps the findings of a 422 from the dev endpoints', async () => {
    const problems = [{ file: 'a.bpmn20.xml', severity: 'ERROR', key: 'activiti-servicetask-missing-implementation', message: 'no implementation' }];
    const error = (await clientAnswering(() => problem(422, { title: 'Unprocessable', detail: 'invalid', problems }))
      .devDeploy([])
      .catch((e: unknown) => e)) as RuntimeApiError;
    expect(error.status).toBe(422);
    expect(error.problems).toEqual(problems);
  });

  it.each([
    [401, 'isUnauthorized'],
    [403, 'isForbidden'],
    [404, 'isNotFound'],
    [409, 'isConflict'],
  ] as const)('%i sets %s', async (status, flag) => {
    const error = (await clientAnswering(() => problem(status, {})).getEngine().catch((e: unknown) => e)) as RuntimeApiError;
    expect(error[flag]).toBe(true);
  });

  it('maps an answer that is not a problem document (a proxy, an old server) to an error with the text', async () => {
    const error = (await clientAnswering(() => new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }))
      .getEngine()
      .catch((e: unknown) => e)) as RuntimeApiError;
    expect(error).toBeInstanceOf(RuntimeApiError);
    expect(error.status).toBe(502);
    expect(error.title).toBe('Server error');
    expect(error.detail).toBe('Bad gateway');
    expect(error.problem).toBeUndefined();
  });

  it('maps a 401 with an empty body', async () => {
    const error = (await clientAnswering(() => new Response(null, { status: 401 })).getEngine().catch((e: unknown) => e)) as RuntimeApiError;
    expect(error.isUnauthorized).toBe(true);
    expect(error.title).toBe('Authentication required');
  });

  it('survives JSON that is not valid', async () => {
    const error = (await clientAnswering(() => new Response('{oops', { status: 500, headers: { 'Content-Type': 'application/json' } }))
      .getEngine()
      .catch((e: unknown) => e)) as RuntimeApiError;
    expect(error.status).toBe(500);
    expect(error.detail).toBe('{oops');
  });

  it('maps a failed fetch to a RuntimeNetworkError that keeps the cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const client = new RuntimeClient({
      baseUrl: 'http://host',
      fetch: async () => {
        throw cause;
      },
    });
    const error = (await client.getEngine().catch((e: unknown) => e)) as RuntimeNetworkError;
    expect(error).toBeInstanceOf(RuntimeNetworkError);
    expect(error.aborted).toBe(false);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('Failed to fetch');
  });

  it('does not map a network error to an API error', async () => {
    const client = new RuntimeClient({
      fetch: async () => {
        throw new Error('down');
      },
    });
    await expect(client.getEngine()).rejects.not.toBeInstanceOf(RuntimeApiError);
  });
});
