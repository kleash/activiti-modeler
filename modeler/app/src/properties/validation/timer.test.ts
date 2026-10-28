import { describe, expect, it } from 'vitest';

import { cronProblem, describeCron, describeTimer, endDateDiagnostic, isoDateProblem, isoDurationProblem, isoRepeatProblem, timerDiagnostic, timerPlacementWarning } from './timer';

describe('ISO 8601 and cron validation', () => {
  it.each(['2030-01-01T12:00:00Z', '2030-01-01T12:00', '2030-12-31', '2030-01-01T09:30:00+01:00', '2030-02-28T23:59:59.123Z'])('accepts the date %s', (v) => {
    expect(isoDateProblem(v)).toBeUndefined();
  });

  it.each([['2030-13-01', /Month 13/], ['2030-02-30', /no day 30/], ['01/02/2030', /Not an ISO/], ['2030-01-01T25:00:00Z', /out of range/], ['tomorrow', /Not an ISO/]])('rejects the date %s', (v, m) => {
    expect(isoDateProblem(v)).toMatch(m);
  });

  it.each(['PT30M', 'P2D', 'P1DT12H', 'PT0.5S', 'P1Y2M3DT4H5M6S', 'PT1H'])('accepts the duration %s', (v) => {
    expect(isoDurationProblem(v)).toBeUndefined();
  });

  it.each([['P1W', /Weeks/], ['PT', /Not an ISO/], ['P', /Not an ISO/], ['30 minutes', /Not an ISO/], ['PT1.5H', /Not an ISO/]])('rejects the duration %s', (v, m) => {
    expect(isoDurationProblem(v)).toMatch(m);
  });

  it.each(['R3/PT1H', 'R/PT10M', 'R5/2030-01-01T09:00:00Z/PT1H', 'R2/PT1H/2030-01-01T09:00:00Z'])('accepts the repeat %s', (v) => {
    expect(isoRepeatProblem(v)).toBeUndefined();
  });

  it.each([['3/PT1H', /starts with R/], ['R3', /Write R<count>/], ['R3/2030-01-01T09:00:00Z', /exactly one duration/], ['R3/PT1X', /Not an ISO/], ['R0/PT1H', /zero times/]])('rejects the repeat %s', (v, m) => {
    expect(isoRepeatProblem(v)).toMatch(m);
  });

  it.each(['0 0 12 * * ?', '0 0/30 * * * ?', '0 15 10 ? * MON-FRI', '0 0 12 1 JAN ? 2031', '0 0 0 L * ?', '0 0 9 ? * 6#3', '0 0 8 ? * 2L'])('accepts the cron %s', (v) => {
    expect(cronProblem(v)).toBeUndefined();
  });

  it.each([
    ['0 0 12 * *', /6 or 7 fields.*has 5/],
    ['0 60 12 * * ?', /minutes: 60 is outside 0-59/],
    ['0 0 12 * * *', /Quartz needs "\?"/],
    ['0 0 12 ? * ?', /both "\?"/],
    ['0 0 12 32 * ?', /32 is outside/],
    ['0 0 12 * FOO ?', /not a month value/],
    ['0 0 12 ? * 5-2', /backwards/],
    ['0 0/0 12 * * ?', /positive/],
  ])('rejects the cron %s', (v, m) => {
    expect(cronProblem(v)).toMatch(m);
  });
});

describe('timer diagnostics and previews', () => {
  it('validates by type, lets expressions through and ignores an empty value', () => {
    expect(timerDiagnostic('duration', '')).toBeUndefined();
    expect(timerDiagnostic('duration', 'PT1H')).toBeUndefined();
    expect(timerDiagnostic('duration', '2030-01-01')?.severity).toBe('error');
    expect(timerDiagnostic('date', '${deadline}')).toMatchObject({ severity: 'info' });
    expect(timerDiagnostic('date', '${deadline')?.severity).toBe('error');
    expect(timerDiagnostic('cycle', 'R3/PT1H')).toBeUndefined();
    expect(timerDiagnostic('cycle', '0 0 12 * * ?')).toBeUndefined();
    expect(timerDiagnostic('cycle', '0 0 12 * *')?.message).toMatch(/6 or 7 fields/);
    expect(timerDiagnostic('cycle', 'R3/PT1H', 'not a date')?.message).toMatch(/End date/);
    expect(endDateDiagnostic('2030-01-01T11:30:00Z')).toBeUndefined();
    expect(endDateDiagnostic('soon')?.severity).toBe('error');
  });

  it('describes a timer in a sentence', () => {
    expect(describeTimer('duration', 'PT30M')).toBe('Fires once, 30 minutes after the process reaches the timer (a start event: after the deployment).');
    expect(describeTimer('duration', 'P1DT12H')).toMatch(/1 day and 12 hours/);
    expect(describeTimer('date', '2030-01-01T12:00:00Z')).toBe('Fires once on Tue, 1 Jan 2030, 12:00 UTC.');
    expect(describeTimer('cycle', 'R3/PT1H')).toBe('Repeats every 1 hour, 3 times.');
    expect(describeTimer('cycle', 'R/PT1H', '2030-01-01T11:30:00Z')).toBe('Repeats every 1 hour without a limit, until Tue, 1 Jan 2030, 11:30 UTC.');
    expect(describeTimer('cycle', '0 0 12 * * ?')).toBe('At 12:00, every day.');
    expect(describeTimer('cycle', '0 0/30 * * * ?')).toBe('Every 30 minutes from minute 0, every day.');
    expect(describeTimer('cycle', '0 15 10 ? * MON-FRI')).toBe('At 10:15, on MON-FRI, every day.'.replace(', every day', ''));
    expect(describeTimer('duration', 'bad')).toBeUndefined();
    expect(describeTimer('duration', '')).toBeUndefined();
    expect(describeTimer('date', '${x}')).toMatch(/expression/);
  });

  it('describes cron expressions of the corpus', () => {
    expect(describeCron('0 0 12 * * ?')).toBe('At 12:00, every day');
    expect(describeCron('0 0 12 ? * MON')).toBe('At 12:00, on MON');
    expect(describeCron('0 0 9 1 * ?')).toBe('At 09:00, on day 1 of the month');
  });

  it('warns where a cycle does not repeat', () => {
    expect(timerPlacementWarning('cycle', { kind: 'intermediate' })?.message).toMatch(/only once/);
    expect(timerPlacementWarning('cycle', { kind: 'boundary', interrupting: true })?.message).toMatch(/never repeats/);
    expect(timerPlacementWarning('cycle', { kind: 'boundary', interrupting: false })).toBeUndefined();
    expect(timerPlacementWarning('duration', { kind: 'intermediate' })).toBeUndefined();
    expect(timerPlacementWarning('cycle', { kind: 'start' })).toBeUndefined();
  });
});
