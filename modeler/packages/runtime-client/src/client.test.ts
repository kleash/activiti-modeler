import { describe, expect, it, vi } from 'vitest';

import { RuntimeClient, type OperationId } from './index';

interface Sent {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function mockFetch(respond: (url: string, init: RequestInit) => Response = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, init: init as Sent['init'] });
    return respond(url, init ?? {});
  });
  return { fetchMock, sent };
}

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

const noContent = () => new Response(null, { status: 204 });

interface Case {
  /** what the client sends */
  expected: `${'GET' | 'POST' | 'PUT' | 'DELETE'} ${string}`;
  body?: unknown;
  call: (client: RuntimeClient) => Promise<unknown>;
  /** answer of the mock */
  answer?: () => Response;
}

/** One entry for every operation of the API: a missing or extra key is a type error. */
const CASES: Record<OperationId, Case> = {
  getEngine: { expected: 'GET /api/engine', call: (c) => c.getEngine() },
  getHealth: { expected: 'GET /api/health', call: (c) => c.getHealth() },
  listDeployments: { expected: 'GET /api/deployments?nameLike=ord&page=1&size=5', call: (c) => c.listDeployments({ page: 1, size: 5, nameLike: 'ord' }) },
  getDeployment: { expected: 'GET /api/deployments/d%201', call: (c) => c.getDeployment('d 1') },
  listDeploymentResources: { expected: 'GET /api/deployments/d1/resources', call: (c) => c.listDeploymentResources('d1') },
  getDeploymentResource: {
    expected: 'GET /api/deployments/d1/resource?name=a%2Fb.bpmn20.xml',
    call: (c) => c.getDeploymentResource('d1', 'a/b.bpmn20.xml'),
    answer: () => new Response('<definitions/>', { headers: { 'Content-Type': 'application/xml' } }),
  },
  listProcessDefinitions: {
    expected: 'GET /api/process-definitions?key=order&latest=true&includeCounts=true',
    call: (c) => c.listProcessDefinitions({ latest: true, key: 'order', includeCounts: true }),
  },
  getProcessDefinition: { expected: 'GET /api/process-definitions/order?includeCounts=true', call: (c) => c.getProcessDefinition('order', { includeCounts: true }) },
  getProcessDefinitionXml: {
    expected: 'GET /api/process-definitions/order/xml',
    call: (c) => c.getProcessDefinitionXml('order'),
    answer: () => new Response('<definitions/>', { headers: { 'Content-Type': 'application/xml' } }),
  },
  getProcessDefinitionExtensions: { expected: 'GET /api/process-definitions/order/extensions', call: (c) => c.getProcessDefinitionExtensions('order') },
  getProcessDefinitionDecisions: { expected: 'GET /api/process-definitions/order/decisions', call: (c) => c.getProcessDefinitionDecisions('order') },
  suspendProcessDefinition: { expected: 'POST /api/process-definitions/order/suspend', call: (c) => c.suspendProcessDefinition('order'), answer: noContent },
  activateProcessDefinition: { expected: 'POST /api/process-definitions/order/activate', call: (c) => c.activateProcessDefinition('order'), answer: noContent },
  startProcessInstance: {
    expected: 'POST /api/process-instances',
    body: { processKey: 'order', variables: { amount: 5000 } },
    call: (c) => c.startProcessInstance({ processKey: 'order', variables: { amount: 5000 } }),
  },
  listProcessInstances: {
    expected: 'GET /api/process-instances?state=running&definitionKey=order',
    call: (c) => c.listProcessInstances({ state: 'running', definitionKey: 'order' }),
  },
  getProcessInstance: { expected: 'GET /api/process-instances/i1', call: (c) => c.getProcessInstance('i1') },
  getProcessInstancePath: { expected: 'GET /api/process-instances/i1/path', call: (c) => c.getProcessInstancePath('i1') },
  getProcessInstanceVariables: { expected: 'GET /api/process-instances/i1/variables', call: (c) => c.getProcessInstanceVariables('i1') },
  getProcessInstanceVariableHistory: { expected: 'GET /api/process-instances/i1/variables/history', call: (c) => c.getProcessInstanceVariableHistory('i1') },
  setProcessInstanceVariables: {
    expected: 'PUT /api/process-instances/i1/variables',
    body: { variables: { a: 1 } },
    call: (c) => c.setProcessInstanceVariables('i1', { a: 1 }),
    answer: noContent,
  },
  removeProcessInstanceVariables: {
    expected: 'DELETE /api/process-instances/i1/variables?name=a&name=b%20c',
    call: (c) => c.removeProcessInstanceVariables('i1', ['a', 'b c']),
    answer: noContent,
  },
  suspendProcessInstance: { expected: 'POST /api/process-instances/i1/suspend', call: (c) => c.suspendProcessInstance('i1'), answer: noContent },
  activateProcessInstance: { expected: 'POST /api/process-instances/i1/activate', call: (c) => c.activateProcessInstance('i1'), answer: noContent },
  deleteProcessInstance: {
    expected: 'DELETE /api/process-instances/i1?reason=not%20needed&purgeHistory=true',
    call: (c) => c.deleteProcessInstance('i1', { reason: 'not needed', purgeHistory: true }),
    answer: noContent,
  },
  listTasks: { expected: 'GET /api/tasks?assignee=bob&mine=true', call: (c) => c.listTasks({ mine: true, assignee: 'bob' }) },
  getTask: { expected: 'GET /api/tasks/t1', call: (c) => c.getTask('t1') },
  claimTask: { expected: 'POST /api/tasks/t1/claim', call: (c) => c.claimTask('t1') },
  releaseTask: { expected: 'POST /api/tasks/t1/release', call: (c) => c.releaseTask('t1') },
  assignTask: { expected: 'POST /api/tasks/t1/assign', body: { assignee: 'bob' }, call: (c) => c.assignTask('t1', 'bob') },
  completeTask: {
    expected: 'POST /api/tasks/t1/complete',
    body: { variables: { approved: true } },
    call: (c) => c.completeTask('t1', { approved: true }),
    answer: noContent,
  },
  sendMessage: {
    expected: 'POST /api/messages',
    body: { name: 'paid', correlationKey: 'o-1' },
    call: (c) => c.sendMessage({ name: 'paid', correlationKey: 'o-1' }),
  },
  sendSignal: { expected: 'POST /api/signals', body: { name: 'go' }, call: (c) => c.sendSignal({ name: 'go' }) },
  triggerExecution: {
    expected: 'POST /api/executions/e1/trigger',
    body: { variables: { x: 1 } },
    call: (c) => c.triggerExecution('e1', { x: 1 }),
  },
  listJobs: { expected: 'GET /api/jobs?kind=DEADLETTER&withException=true', call: (c) => c.listJobs({ kind: 'DEADLETTER', withException: true }) },
  getJob: { expected: 'GET /api/jobs/j1', call: (c) => c.getJob('j1') },
  executeJob: { expected: 'POST /api/jobs/j1/execute', call: (c) => c.executeJob('j1'), answer: noContent },
  setJobRetries: { expected: 'POST /api/jobs/j1/retries', body: { retries: 3 }, call: (c) => c.setJobRetries('j1', 3), answer: noContent },
  fireTimer: { expected: 'POST /api/timers/t1/fire', call: (c) => c.fireTimer('t1') },
  retryDeadLetterJob: {
    expected: 'POST /api/deadletter/j1/retry',
    body: { execute: true },
    call: (c) => c.retryDeadLetterJob('j1', { execute: true }),
  },
  devValidate: {
    expected: 'POST /api/dev/validate',
    body: { files: [{ path: 'processes/a.bpmn20.xml', content: '<definitions/>' }] },
    call: (c) => c.devValidate([{ path: 'processes/a.bpmn20.xml', content: '<definitions/>' }]),
  },
  devDeploy: {
    expected: 'POST /api/dev/deployments',
    body: { name: 'mine', files: [{ path: 'a.bpmn20.xml', content: '<definitions/>' }] },
    call: (c) => c.devDeploy([{ path: 'a.bpmn20.xml', content: '<definitions/>' }], 'mine'),
  },
  devDeleteDeployment: { expected: 'DELETE /api/dev/deployments/d1?cascade=true', call: (c) => c.devDeleteDeployment('d1', { cascade: true }), answer: noContent },
  devRunScenario: {
    expected: 'POST /api/dev/scenarios/run',
    body: { files: [{ path: 'a.bpmn20.xml', content: '<definitions/>' }], scenario: { name: 's' } },
    call: (c) => c.devRunScenario([{ path: 'a.bpmn20.xml', content: '<definitions/>' }], { name: 's' }),
  },
  devEvaluateDecision: {
    expected: 'POST /api/dev/decisions/evaluate',
    body: { dmn: '<definitions/>', inputs: { age: 30 } },
    call: (c) => c.devEvaluateDecision({ dmn: '<definitions/>', inputs: { age: 30 } }),
  },
  devWorkspaceRoot: { expected: 'GET /api/dev/workspace?recursive=true', call: (c) => c.devWorkspaceRoot({ recursive: true }) },
  devWorkspaceGet: { expected: 'GET /api/dev/workspace/processes/my%20order', call: (c) => c.readWorkspaceDirectory('processes/my order') },
  devWorkspacePut: {
    expected: 'PUT /api/dev/workspace/processes/a.bpmn20.xml',
    body: '<definitions/>',
    call: (c) => c.writeWorkspaceFile('processes/a.bpmn20.xml', '<definitions/>'),
    answer: () => new Response(null, { status: 201 }),
  },
  devWorkspaceDelete: {
    expected: 'DELETE /api/dev/workspace/processes?recursive=true',
    call: (c) => c.deleteWorkspacePath('processes', { recursive: true }),
    answer: noContent,
  },
  devMailList: { expected: 'GET /api/dev/mail', call: (c) => c.devMailList() },
  devMailPurge: { expected: 'DELETE /api/dev/mail', call: (c) => c.devMailPurge(), answer: noContent },
};

describe('every operation of the API', () => {
  for (const [operation, testCase] of Object.entries(CASES)) {
    it(`${operation}: ${testCase.expected}`, async () => {
      const { fetchMock, sent } = mockFetch(testCase.answer ? () => testCase.answer!() : undefined);
      const client = new RuntimeClient({ baseUrl: 'http://host:8080', fetch: fetchMock });

      await testCase.call(client);

      expect(sent).toHaveLength(1);
      const [method, path] = testCase.expected.split(' ');
      expect(`${sent[0]!.init.method} ${sent[0]!.url}`).toBe(`${method} http://host:8080${path}`);
      if (testCase.body !== undefined) {
        const body = sent[0]!.init.body;
        expect(typeof body === 'string' && typeof testCase.body === 'object' ? JSON.parse(body) : body).toEqual(testCase.body);
      } else {
        expect(sent[0]!.init.body).toBeUndefined();
      }
    });
  }
});

describe('responses', () => {
  it('parses JSON', async () => {
    const { fetchMock } = mockFetch(() => json({ activitiVersion: '9.0.0' }));
    await expect(new RuntimeClient({ fetch: fetchMock }).getEngine()).resolves.toEqual({ activitiVersion: '9.0.0' });
  });

  it('returns text for BPMN XML and for a workspace file, whatever its content type', async () => {
    const { fetchMock } = mockFetch(() => new Response('{"a":1}', { headers: { 'Content-Type': 'application/json' } }));
    const client = new RuntimeClient({ fetch: fetchMock });

    await expect(client.getProcessDefinitionXml('order')).resolves.toBe('{"a":1}');
    await expect(client.readWorkspaceFile('x/y.json')).resolves.toBe('{"a":1}');
  });

  it('returns undefined for no content', async () => {
    const { fetchMock } = mockFetch(noContent);
    await expect(new RuntimeClient({ fetch: fetchMock }).suspendProcessInstance('i1')).resolves.toBeUndefined();
  });
});

describe('URL and options', () => {
  it('defaults to the page origin and /api', async () => {
    const { fetchMock, sent } = mockFetch();
    await new RuntimeClient({ fetch: fetchMock }).getEngine();
    expect(sent[0]!.url).toBe('/api/engine');
  });

  it('takes a base URL with a trailing slash and a custom base path', async () => {
    const { fetchMock, sent } = mockFetch();
    const client = new RuntimeClient({ baseUrl: 'https://host/app/', basePath: 'activiti/rest/', fetch: fetchMock });
    await client.getEngine();
    await client.getTask('a/b');
    expect(sent.map((s) => s.url)).toEqual(['https://host/app/activiti/rest/engine', 'https://host/app/activiti/rest/tasks/a%2Fb']);
  });

  it('leaves out undefined query values and sends an empty base path as none', async () => {
    const { fetchMock, sent } = mockFetch();
    await new RuntimeClient({ basePath: '', fetch: fetchMock }).listTasks({ assignee: undefined, size: 0 });
    expect(sent[0]!.url).toBe('/tasks?size=0');
  });

  it('refuses a call without its path parameter', () => {
    const client = new RuntimeClient();
    expect(() => client.urlOf('getTask')).toThrow(/path parameter "id"/);
  });

  it('adds the configured headers and an Accept header', async () => {
    const { fetchMock, sent } = mockFetch();
    await new RuntimeClient({ fetch: fetchMock, headers: { 'X-Trace': 't' } }).getEngine();
    expect(sent[0]!.init.headers).toEqual({ Accept: 'application/json', 'X-Trace': 't' });
  });

  it('sends the body as JSON with its content type, a workspace file as given', async () => {
    const { fetchMock, sent } = mockFetch(noContent);
    const client = new RuntimeClient({ fetch: fetchMock });
    await client.assignTask('t1', 'bob').catch(() => undefined);
    await client.writeWorkspaceFile('a.json', '{}');
    await client.writeWorkspaceFile('a.dmn', '<d/>');
    await client.writeWorkspaceFile('a.txt', 'x', { contentType: 'text/markdown' });

    expect(sent[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(sent.slice(1).map((s) => s.init.headers['Content-Type'])).toEqual(['application/json', 'application/xml', 'text/markdown']);
  });

  it('passes the abort signal on, and the timeout aborts a request that hangs', async () => {
    const controller = new AbortController();
    const { fetchMock, sent } = mockFetch();
    await new RuntimeClient({ fetch: fetchMock }).getEngine({ signal: controller.signal });
    expect(sent[0]!.init.signal).toBe(controller.signal);

    const hanging = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const error = await new RuntimeClient({ fetch: hanging, timeoutMs: 20 }).getEngine().catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'RuntimeNetworkError', aborted: true });
  });
});
