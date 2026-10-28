import { describe, expect, it } from 'vitest';

import { elementsInState, FLOW_TAKEN_CLASS, markerClass, overlaysForInstance, overlaysForVisits, type DiagramStructure } from './states';

describe('diagram viewer markers', () => {
  it('derives the marker class from the state', () => {
    expect(markerClass('incident')).toBe('activiti-incident');
    expect(markerClass('active')).toBe('activiti-active');
    expect(FLOW_TAKEN_CLASS).toBe('activiti-flow-taken');
  });

  it('lists elements by state', () => {
    const states = { review: 'active', start: 'completed', approve: 'active' } as const;
    expect(elementsInState(states, 'active')).toEqual(['approve', 'review']);
    expect(elementsInState(states, 'incident')).toEqual([]);
  });
});

/** A structure from a parent map: `inner` and `eStart` live in containers. */
const structure = (parents: Record<string, string>, eventSubProcesses: string[] = []): DiagramStructure => ({
  parentOf: (id) => parents[id],
  isEventSubProcess: (id) => eventSubProcesses.includes(id),
  has: (id) => id in parents || Object.values(parents).includes(id),
});

describe('overlaysForInstance', () => {
  const step = (activityId: string, activityType: string, ended = true) => ({ activityId, activityType, ...(ended ? { endTime: '2030-01-01T00:00:00Z' } : {}) });

  it('puts a token on what waits and marks what ended as completed', () => {
    const o = overlaysForInstance({ activeActivityIds: ['review'], path: { activities: [step('start', 'startEvent'), step('review', 'userTask', false)], sequenceFlows: [{ id: 'f1' }] }, jobs: [] });
    expect(o.active).toEqual(['review']);
    expect(o.completed).toEqual(['start']);
    expect(o.flows).toEqual(['f1']);
    expect(o.tokens).toEqual({ review: 1 });
    expect(o.incidents).toEqual([]);
  });

  it('counts the tokens of a multi-instance activity', () => {
    const o = overlaysForInstance({ activeActivityIds: ['each', 'each', 'each'], path: { activities: [], sequenceFlows: [] } });
    expect(o.tokens).toEqual({ each: 3 });
  });

  it('marks an activity with a dead-letter job as an incident', () => {
    const o = overlaysForInstance({ activeActivityIds: [], path: { activities: [step('call', 'serviceTask', false)], sequenceFlows: [] }, jobs: [{ activityId: 'call', kind: 'DEADLETTER', retries: 0, exceptionMessage: 'boom' }, { activityId: 'other', kind: 'JOB', retries: 3 }] });
    expect(o.incidents).toEqual(['call']);
  });

  it('infers an event sub process from what ran inside it, because the engine records no activity instance for it', () => {
    const s = structure({ eStart: 'eventSp', eTask: 'eventSp', eEnd: 'eventSp', f_in: 'eventSp' }, ['eventSp']);
    const o = overlaysForInstance(
      { activeActivityIds: [], path: { activities: [step('start', 'startEvent'), step('eStart', 'startEvent'), step('eTask', 'userTask'), step('eEnd', 'endEvent')], sequenceFlows: [{ id: 'f_in' }] } },
      s,
    );
    expect(o.completed).toContain('eventSp');
    expect(o.active).toEqual([]);
  });

  it('marks the sub process around a waiting task as active but puts the token on the task only', () => {
    const s = structure({ inner: 'sub' });
    const o = overlaysForInstance({ activeActivityIds: ['inner'], path: { activities: [step('inner', 'userTask', false)], sequenceFlows: [] } }, s);
    expect(o.active).toEqual(['inner', 'sub']);
    expect(o.tokens).toEqual({ inner: 1 });
  });

  it('shows the visits of a scenario report', () => {
    expect(overlaysForVisits({ nodes: ['b', 'a'], flows: ['f'] })).toEqual({ completed: ['a', 'b'], flows: ['f'] });
    expect(overlaysForVisits(undefined)).toEqual({ completed: [], flows: [] });
  });
});
