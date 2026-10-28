import { describe, expect, it } from 'vitest';

import { mergeServerProblems, normalizeKey, runtimeClientValidator, type ServerProblem } from './server';
import type { Problem } from './types';

const client = (over: Partial<Problem>): Problem => ({ id: 'x', path: 'a.bpmn20.xml', rule: 'activiti/service-task-missing-implementation', key: 'SERVICE_TASK_MISSING_IMPLEMENTATION', severity: 'error', message: 'm', source: 'client', ...over });
const server = (over: Partial<ServerProblem>): ServerProblem => ({ path: 'a.bpmn20.xml', key: 'SERVICE_TASK_MISSING_IMPLEMENTATION', severity: 'error', message: 'engine says', source: 'engine-validate', ...over });

describe('server problem merge', () => {
  it('normalises the spellings of a key', () => {
    expect(normalizeKey('activiti-servicetask-missing-implementation')).toBe('SERVICETASK_MISSING_IMPLEMENTATION');
    expect(normalizeKey('SERVICE_TASK_MISSING_IMPLEMENTATION')).toBe('SERVICE_TASK_MISSING_IMPLEMENTATION');
    expect(normalizeKey('activiti-flow-element-async-not-available')).toBe('FLOW_ELEMENT_ASYNC_NOT_AVAILABLE');
  });

  it('drops a server problem the client already reports on the same element', () => {
    const merged = mergeServerProblems([client({ elementId: 't' })], [server({ elementId: 't' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe('client');
  });

  it('keeps it for another element, another key or another file, tagged engine', () => {
    const merged = mergeServerProblems([client({ elementId: 't' })], [server({ elementId: 'u' }), server({ elementId: 't', key: 'SCRIPT_TASK_MISSING_SCRIPT' }), server({ elementId: 't', path: 'b.bpmn20.xml' })]);
    expect(merged.map((p) => [p.source, p.elementId, p.key])).toEqual([
      ['client', 't', 'SERVICE_TASK_MISSING_IMPLEMENTATION'],
      ['engine', 'u', 'SERVICE_TASK_MISSING_IMPLEMENTATION'],
      ['engine', 't', 'SCRIPT_TASK_MISSING_SCRIPT'],
      ['engine', 't', 'SERVICE_TASK_MISSING_IMPLEMENTATION'],
    ]);
    expect(merged[1]!.rule).toBe('engine/SERVICE_TASK_MISSING_IMPLEMENTATION');
  });

  it('matches the keys a rule declares for the server findings of the runtime (extensions-*, trial-deploy)', () => {
    const c = client({ rule: 'activiti/extensions-unknown-element', key: undefined, elementId: 'p' });
    delete (c as { key?: string }).key;
    expect(mergeServerProblems([c], [server({ key: 'extensions-unknown-element', elementId: 'p' })])).toHaveLength(1);
  });

  it('maps severities and keeps positions', () => {
    const [p] = mergeServerProblems([], [server({ severity: 'warning', line: 4, column: 2 })]);
    expect(p).toMatchObject({ severity: 'warning', line: 4, column: 2, source: 'engine' });
  });

  it('wraps a RuntimeClient-like object as a ServerValidator', async () => {
    const validator = runtimeClientValidator({ devValidate: async () => ({ problems: [server({})], asyncExecutorActive: false, valid: false }) });
    expect(await validator.validate([])).toMatchObject({ asyncExecutorActive: false, valid: false });
  });
});
