import type { Problem as DevProblem } from './generated/types';

/** The `application/problem+json` document the API answers errors with (RFC 9457) and its extension members. */
export interface ProblemDocument {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  /** Class name of the exception behind the failure, for example `org.activiti.engine.ActivitiObjectNotFoundException`. */
  engineException?: string;
  /** Class and message of the root cause when it differs from the exception. */
  rootCause?: string;
  /** Findings of the dev endpoints (422 from deploy and scenario run, 400 for an invalid scenario file). */
  problems?: DevProblem[] | string[];
  [member: string]: unknown;
}

/** The server answered with an error status. */
export class RuntimeApiError extends Error {
  /** HTTP status. */
  readonly status: number;
  readonly method: string;
  readonly url: string;
  /** Short title of the problem document, or the status text. */
  readonly title: string;
  /** What went wrong, from the problem document; the response text for a non-problem answer. */
  readonly detail: string;
  /** The exception class the server reports, if any. */
  readonly engineException: string | undefined;
  readonly rootCause: string | undefined;
  /** Findings that came with the error, if any. */
  readonly problems: ProblemDocument['problems'];
  /** The problem document, or `undefined` when the answer was not one. */
  readonly problem: ProblemDocument | undefined;

  constructor(status: number, method: string, url: string, problem: ProblemDocument | undefined, text = '') {
    const title = problem?.title ?? statusText(status);
    const detail = problem?.detail ?? text;
    super(`${method} ${url} failed: ${status} ${title}${detail ? `: ${detail}` : ''}`);
    this.name = 'RuntimeApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.title = title;
    this.detail = detail;
    this.engineException = problem?.engineException;
    this.rootCause = problem?.rootCause;
    this.problems = problem?.problems;
    this.problem = problem;
  }

  /** 401: no or wrong credentials. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 403: signed in, but not allowed. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 409: the runtime's rules refuse it (task already claimed, instance ended, another scenario run in progress). */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

/** The request never got an answer (server down, CORS refused, timeout, aborted). */
export class RuntimeNetworkError extends Error {
  readonly method: string;
  readonly url: string;
  /** `true` when the request was cancelled by the caller's signal or the timeout. */
  readonly aborted: boolean;

  constructor(method: string, url: string, cause: unknown, aborted: boolean) {
    super(`${method} ${url} got no answer: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'RuntimeNetworkError';
    this.method = method;
    this.url = url;
    this.aborted = aborted;
  }
}

function statusText(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Authentication required';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not found';
    case 405:
      return 'Method not allowed';
    case 409:
      return 'Conflict';
    case 413:
      return 'Payload too large';
    case 422:
      return 'Unprocessable';
    default:
      return status >= 500 ? 'Server error' : `HTTP ${status}`;
  }
}
