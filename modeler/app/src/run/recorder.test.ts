import type { InstanceDetail } from '@activiti-modeler/runtime-client';
import { describe, expect, it } from 'vitest';

import { ScenarioRecorder } from './recorder';
import { checkScenarioText } from './scenarioSchema';

const final = {
  id: 'i1',
  state: 'COMPLETED',
  jobs: [],
  variables: [{ name: 'approved', value: true }, { name: 'amount', value: 250 }, { name: 'gone', value: null }],
  path: {
    activities: [
      { activityId: 'start', activityType: 'startEvent' },
      { activityId: 'review', activityType: 'userTask' },
      { activityId: 'review', activityType: 'userTask' },
      { activityId: 'approvedEnd', activityType: 'endEvent' },
    ],
  },
} as unknown as InstanceDetail;

describe('ScenarioRecorder', () => {
  it('records nothing before begin, and only the instance that was started while recording', () => {
    const r = new ScenarioRecorder();
    r.note('i1', { executeJobs: {} });
    expect(r.getSnapshot().steps).toBe(0);
    r.begin();
    expect(r.isWaitingForStart).toBe(true);
    r.noteStart({ instanceId: 'i1', process: 'orderReview', user: 'alice', variables: { amount: 250 } });
    r.note('other', { executeJobs: {} });
    r.note('i1', { claim: { activity: 'review', user: 'alice' } }, { name: 'alice', groups: ['reviewers'] });
    r.note('i1', { completeTask: { activity: 'review', user: 'alice', variables: { approved: true } } }, { name: 'alice', groups: ['reviewers'] });
    expect(r.getSnapshot()).toEqual({ recording: true, instanceId: 'i1', subject: 'orderReview', steps: 2 });
    // a second start while recording does not replace the first
    r.noteStart({ instanceId: 'i2', process: 'x', user: 'bob' });
    expect(r.getSnapshot().instanceId).toBe('i1');
  });

  it('builds a scenario file that the schema accepts, with the final state as expectations', () => {
    const r = new ScenarioRecorder();
    r.begin();
    r.noteStart({ instanceId: 'i1', process: 'orderReview', businessKey: 'BK', user: 'alice', variables: { amount: 250 } });
    r.note('i1', { expectTask: { activity: 'review' } });
    r.note('i1', { completeTask: { activity: 'review', user: 'alice', variables: { approved: true } } }, { name: 'alice', groups: ['reviewers'] });
    const file = r.build('approved order', final);
    expect(file.users).toEqual({ alice: ['reviewers'] });
    expect(file.scenarios[0]).toEqual({
      name: 'approved order',
      start: { process: 'orderReview', businessKey: 'BK', user: 'alice', variables: { amount: 250 } },
      steps: [{ expectTask: { activity: 'review' } }, { completeTask: { activity: 'review', user: 'alice', variables: { approved: true } } }],
      expect: {
        state: 'COMPLETED',
        endEvents: ['approvedEnd'],
        path: { contains: ['start', 'review', 'approvedEnd'] },
        variables: { approved: true, amount: 250 },
      },
    });
    expect(checkScenarioText(JSON.stringify(file)).diagnostics).toEqual([]);
  });

  it('starts by message and expects a dead letter when a job failed for good', () => {
    const r = new ScenarioRecorder();
    r.begin();
    r.noteStart({ instanceId: 'i1', message: 'newOrder', user: 'alice' });
    const stuck = { ...final, state: 'ACTIVE', jobs: [{ kind: 'DEADLETTER', activityId: 'call', exceptionMessage: 'boom' }], path: { activities: [] }, variables: [] } as unknown as InstanceDetail;
    const file = r.build('stuck', stuck);
    expect((file.scenarios[0] as { start: unknown }).start).toEqual({ message: 'newOrder', user: 'alice' });
    expect((file.scenarios[0] as { expect: unknown }).expect).toEqual({ state: 'DEADLETTER', deadLetterJobs: [{ activity: 'call', exceptionMessageContains: 'boom' }] });
  });

  it('refuses to build before an instance was started', () => {
    const r = new ScenarioRecorder();
    r.begin();
    expect(() => r.build('x', final)).toThrow(/nothing was recorded/);
  });
});
