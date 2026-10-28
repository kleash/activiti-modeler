/**
 * Timer value syntax of Activiti 9 (R1 §8.3): `timeDate` is an ISO 8601 date-time, `timeDuration` an ISO 8601 duration,
 * `timeCycle` an ISO 8601 repeating interval (`R3/PT10M`, `R/2030-01-01T00:00:00/PT1H`) or a Quartz cron expression.
 * Values containing `${...}` are expressions: only their syntax is checked (by the caller).
 */

const DATE_TIME = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}(?::\d{2}(?::\d{2}(?:[.,]\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/;
const DURATION = /^P(?=\d|T\d)(?:\d+(?:[.,]\d+)?Y)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?W)?(?:\d+(?:[.,]\d+)?D)?(?:T(?=\d)(?:\d+(?:[.,]\d+)?H)?(?:\d+(?:[.,]\d+)?M)?(?:\d+(?:[.,]\d+)?S)?)?$/;

export const isIsoDateTime = (value: string): boolean => DATE_TIME.test(value.trim());
export const isIsoDuration = (value: string): boolean => DURATION.test(value.trim());

/** The date-time of an ISO date or repeating interval, for comparisons; undefined when it is not a literal date-time. */
export function parseDateTime(value: string): number | undefined {
  const t = value.trim();
  if (!isIsoDateTime(t)) return undefined;
  let iso: string;
  if (!t.includes('T')) iso = `${t.length === 4 ? `${t}-01-01` : t.length === 7 ? `${t}-01` : t}T00:00:00Z`;
  else iso = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(t.slice(t.indexOf('T'))) ? t : `${t}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : time;
}

const CRON_FIELD = /^[0-9A-Za-z*?/,\-#]+$/;

export interface TimerIssue {
  message: string;
}

/** Why `value` is not a valid `timeDate`, or undefined. */
export function timeDateIssue(value: string): TimerIssue | undefined {
  const v = value.trim();
  if (isIsoDateTime(v) || isIsoDuration(v)) return undefined;
  return { message: `"${v}" is not an ISO 8601 date-time (2030-01-01T12:00:00) or duration (PT30M)` };
}

export function timeDurationIssue(value: string): TimerIssue | undefined {
  const v = value.trim();
  if (isIsoDuration(v)) return undefined;
  return { message: `"${v}" is not an ISO 8601 duration (PT10M, P1DT2H, P2W)` };
}

export function timeCycleIssue(value: string): TimerIssue | undefined {
  const v = value.trim();
  if (v.startsWith('R')) {
    const parts = v.split('/');
    const repeat = /^R\d*$/.test(parts[0]!);
    const rest = parts.slice(1);
    const ok =
      repeat &&
      ((rest.length === 1 && isIsoDuration(rest[0]!)) ||
        (rest.length === 2 && ((isIsoDateTime(rest[0]!) && isIsoDuration(rest[1]!)) || (isIsoDuration(rest[0]!) && isIsoDateTime(rest[1]!)))) ||
        (rest.length === 3 && isIsoDateTime(rest[0]!) && isIsoDuration(rest[1]!) && isIsoDateTime(rest[2]!)));
    return ok ? undefined : { message: `"${v}" is not an ISO 8601 repeating interval (R3/PT10M, R/PT1H, R5/2030-01-01T00:00:00/PT1H)` };
  }
  const fields = v.split(/\s+/);
  if (fields.length < 6 || fields.length > 7) {
    return { message: `"${v}" is neither an ISO 8601 repeating interval (R3/PT10M) nor a Quartz cron expression (6 or 7 fields: second minute hour day-of-month month day-of-week [year])` };
  }
  const bad = fields.find((f) => !CRON_FIELD.test(f));
  if (bad) return { message: `cron field "${bad}" has characters Quartz does not accept` };
  const dayOfMonth = fields[3]!;
  const dayOfWeek = fields[5]!;
  if ((dayOfMonth === '?') === (dayOfWeek === '?')) {
    return { message: `"${v}": Quartz needs exactly one of day-of-month and day-of-week to be "?" (for example 0 0 12 * * ?)` };
  }
  return undefined;
}

export const END_DATE_ISSUE = (value: string): TimerIssue | undefined => (isIsoDateTime(value) ? undefined : { message: `end date "${value.trim()}" is not an ISO 8601 date-time` });
