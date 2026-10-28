/**
 * Server validation (`POST /api/dev/validate`, ADR 0007) behind a small interface, and the merge of its problems into the
 * client's: the engine's own findings are tagged `engine`, and dropped when a client rule already reports the same key on the
 * same element.
 */
import { RULES } from './catalog';
import type { Problem, Severity } from './types';

/** A problem as the server reports it (`ValidateResponse.problems` of the runtime-client contract). */
export interface ServerProblem {
  path?: string;
  elementId?: string;
  key: string;
  severity: string;
  message: string;
  source: string;
  line?: number;
  column?: number;
}

export interface ServerValidation {
  problems: ServerProblem[];
  /** Whether the engine's async executor is running (the async-not-available warnings depend on it). */
  asyncExecutorActive?: boolean;
  valid?: boolean;
}

/** What the lint needs from a modeler server. `RuntimeClient.devValidate` satisfies it through `runtimeClientValidator`. */
export interface ServerValidator {
  validate(files: Array<{ path: string; content: string }>): Promise<ServerValidation>;
}

/** Adapts `RuntimeClient` (`devValidate(files)`) to a `ServerValidator`. */
export function runtimeClientValidator(client: { devValidate(files: Array<{ path: string; content: string }>): Promise<{ problems: ServerProblem[]; asyncExecutorActive: boolean; valid: boolean }> }): ServerValidator {
  return {
    async validate(files) {
      const response = await client.devValidate(files);
      return { problems: response.problems, asyncExecutorActive: response.asyncExecutorActive, valid: response.valid };
    },
  };
}

/** `activiti-servicetask-missing-implementation`, `SERVICE_TASK_MISSING_IMPLEMENTATION`, ... to one spelling. */
export const normalizeKey = (key: string): string => key.trim().replace(/^activiti[-_]/i, '').replace(/-/g, '_').toUpperCase();

const clientKeys = (problem: Problem, serverKeysOf: ReadonlyMap<string, readonly string[]>): string[] => {
  const keys = new Set<string>();
  if (problem.key) keys.add(normalizeKey(problem.key));
  const id = problem.rule.startsWith('activiti/') ? problem.rule.slice('activiti/'.length) : undefined;
  for (const k of (id ? serverKeysOf.get(id) : undefined) ?? []) keys.add(normalizeKey(k));
  return [...keys];
};

const SERVER_KEYS: ReadonlyMap<string, readonly string[]> = new Map(RULES.filter((r) => r.serverKeys).map((r) => [r.id, r.serverKeys!]));

const severityOf = (s: string): Severity => (s === 'error' ? 'error' : s === 'warning' || s === 'warn' ? 'warning' : 'info');

/**
 * Adds the server's problems to the client's. A server problem is dropped when a client problem of the same file has the same
 * key (or a key the rule declares as its server key) on the same element, or on no element at all when both have none.
 */
export function mergeServerProblems(client: readonly Problem[], server: readonly ServerProblem[], defaultPath = ''): Problem[] {
  const merged = [...client];
  const counter = new Map<string, number>();
  for (const s of server) {
    const path = s.path ?? defaultPath;
    const key = normalizeKey(s.key);
    const duplicate = client.some((c) => c.path === path && (c.elementId ?? '') === (s.elementId ?? '') && clientKeys(c, SERVER_KEYS).includes(key));
    if (duplicate) continue;
    const base = `${path}|engine/${s.key}|${s.elementId ?? ''}`;
    const n = (counter.get(base) ?? 0) + 1;
    counter.set(base, n);
    merged.push({
      id: `${base}|${n}`,
      path,
      ...(s.elementId ? { elementId: s.elementId } : {}),
      rule: `engine/${s.key}`,
      key: s.key,
      severity: severityOf(s.severity),
      message: s.message,
      source: 'engine',
      ...(s.line !== undefined ? { line: s.line } : {}),
      ...(s.column !== undefined ? { column: s.column } : {}),
    });
  }
  return merged;
}
