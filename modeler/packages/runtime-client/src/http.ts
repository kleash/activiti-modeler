import type { Auth, PreparedRequest } from './auth';
import { noAuth } from './auth';
import { RuntimeApiError, RuntimeNetworkError, type ProblemDocument } from './errors';
import type { OperationId, OperationSpec } from './generated/operations';
import { operations } from './generated/operations';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RuntimeClientOptions {
  /** Origin of the server, for example `http://localhost:8080`. Empty (default) means the page's own origin. */
  baseUrl?: string;
  /** Prefix of the API (`activiti.rest.base-path` on the server). Default `/api`. */
  basePath?: string;
  /** How to authenticate: {@link basicAuth}, {@link bearerAuth}, {@link cookieAuth}. Default none. */
  auth?: Auth;
  /** Shorthand for `auth: basicAuth(username, password)`. */
  credentials?: { username: string; password: string };
  /** The `fetch` to use; default the global one. Tests pass a mock. */
  fetch?: Fetch;
  /** Headers added to every request. */
  headers?: Record<string, string>;
  /** Give up on a request after this many milliseconds (0: never). */
  timeoutMs?: number;
}

/** Arguments of one call. */
export interface CallArguments {
  path?: Record<string, string>;
  query?: object;
  /** JSON-encoded as the request body. */
  body?: unknown;
  /** Sent as the request body as it is, with this content type. */
  raw?: { content: string | Uint8Array; contentType: string };
  signal?: AbortSignal;
  /** Read the response as text although the operation returns JSON (a workspace file). */
  asText?: boolean;
}

/** Sends the calls: URL building, authentication, JSON, error mapping. */
export class Transport {
  readonly baseUrl: string;
  readonly basePath: string;
  private readonly auth: Auth;
  private readonly fetchImpl: Fetch;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: RuntimeClientOptions, basicAuthFactory: (user: string, password: string) => Auth) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.basePath = normalizeBasePath(options.basePath ?? '/api');
    this.auth = options.auth ?? (options.credentials ? basicAuthFactory(options.credentials.username, options.credentials.password) : noAuth);
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 0;
  }

  /** The URL of an operation with its arguments filled in. */
  urlOf(operation: OperationId, args: CallArguments = {}): string {
    const spec: OperationSpec = operations[operation];
    let path = spec.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = args.path?.[name];
      if (value === undefined) {
        throw new Error(`${operation} needs the path parameter "${name}"`);
      }
      // the workspace path is a path: its slashes stay
      return name === 'path' ? value.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(value);
    });
    path = `${this.baseUrl}${this.basePath}${path}`;
    const query = queryString(spec, args.query);
    return query ? `${path}?${query}` : path;
  }

  async call(operation: OperationId, args: CallArguments = {}): Promise<unknown> {
    const spec: OperationSpec = operations[operation];
    const url = this.urlOf(operation, args);
    const request: PreparedRequest = { method: spec.method, url, headers: { Accept: 'application/json', ...this.headers } };
    let body: BodyInit | undefined;
    if (args.raw) {
      request.headers['Content-Type'] = args.raw.contentType;
      body = args.raw.content as BodyInit;
    } else if (args.body !== undefined) {
      request.headers['Content-Type'] = 'application/json';
      body = JSON.stringify(args.body);
    }
    if (spec.response === 'text' || args.asText) {
      request.headers['Accept'] = '*/*';
    }
    await this.auth.prepare(request);

    const init: RequestInit = { method: request.method, headers: request.headers };
    if (body !== undefined) {
      init.body = body;
    }
    if (request.credentials) {
      init.credentials = request.credentials;
    }
    const timeout = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
    const signal = args.signal && timeout ? AbortSignal.any([args.signal, timeout]) : (args.signal ?? timeout);
    if (signal) {
      init.signal = signal;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new RuntimeNetworkError(request.method, url, error, signal?.aborted === true);
    }
    if (!response.ok) {
      throw await apiError(response, request.method, url);
    }
    if (spec.response === 'none' || response.status === 204) {
      return undefined;
    }
    if (spec.response === 'text' || args.asText) {
      return response.text();
    }
    const text = await response.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  }
}

async function apiError(response: Response, method: string, url: string): Promise<RuntimeApiError> {
  const text = await response.text().catch(() => '');
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json') && text) {
    try {
      const problem = JSON.parse(text) as ProblemDocument;
      if (problem && typeof problem === 'object') {
        return new RuntimeApiError(response.status, method, url, problem, text);
      }
    } catch {
      // not JSON after all
    }
  }
  return new RuntimeApiError(response.status, method, url, undefined, text.slice(0, 500));
}

function normalizeBasePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function queryString(spec: OperationSpec, query: object | undefined): string {
  if (!query) {
    return '';
  }
  const parts: string[] = [];
  for (const parameter of spec.queryParams) {
    const value = (query as Record<string, unknown>)[parameter.name];
    if (value === undefined || value === null) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      parts.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(item))}`);
    }
  }
  return parts.join('&');
}
