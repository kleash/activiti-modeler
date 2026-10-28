import { juelError } from '../juel/syntax';
import { type Diagnostic, error, info, warning } from './types';

/**
 * Timer values as Activiti 9 reads them (`TimerEventDefinition`, `DurationHelper`, `CronExpression`): an ISO 8601 date-time
 * (`timeDate`), an `xsd:duration` (`timeDuration`), an ISO 8601 repeating interval or a Quartz cron expression (`timeCycle`),
 * or a `${...}` expression for any of them.
 */

export type TimerType = 'date' | 'duration' | 'cycle';

const isExpression = (value: string): boolean => /[$#]\{/.test(value);

// --- date-times --------------------------------------------------------------------------------------------------------------

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** Problem with an ISO 8601 date or date-time, or undefined. */
export function isoDateProblem(value: string): string | undefined {
  const m = DATE_TIME.exec(value);
  if (!m) return 'Not an ISO 8601 date-time. Example: 2030-01-31T09:30:00Z (or 2030-01-31T09:30:00+01:00).';
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => (x === undefined ? undefined : Number(x)));
  if (month! < 1 || month! > 12) return `Month ${month} does not exist.`;
  const days = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (day! < 1 || day! > days) return `${year}-${String(month).padStart(2, '0')} has no day ${day}.`;
  if (hour !== undefined && (hour > 23 || minute! > 59 || (second !== undefined && second > 59))) return 'The time of day is out of range (00:00:00 to 23:59:59).';
  return undefined;
}

// --- durations ---------------------------------------------------------------------------------------------------------------

const DURATION = /^-?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Problem with an `xsd:duration` (what `DatatypeFactory.newDuration` accepts), or undefined. */
export function isoDurationProblem(value: string): string | undefined {
  if (/^-?P.*\d+W/.test(value)) return 'Weeks (W) are not valid here: Activiti reads an xsd:duration. Use days, for example P14D.';
  const m = DURATION.exec(value);
  if (!m || value === 'P' || /T$/.test(value)) return 'Not an ISO 8601 duration. Examples: PT30M (30 minutes), P2D (2 days), P1DT12H (a day and a half).';
  if (m.slice(1).every((x) => x === undefined)) return 'The duration has no amount. Example: PT30M.';
  return undefined;
}

// --- repeating intervals -----------------------------------------------------------------------------------------------------

/** Problem with an ISO 8601 repeating interval (`R3/PT1H`, `R/PT10M`, `R5/2030-01-01T09:00:00Z/PT1H`), or undefined. */
export function isoRepeatProblem(value: string): string | undefined {
  const parts = value.split('/');
  const first = parts[0]!;
  if (!/^R\d*$/.test(first)) return 'A repeating interval starts with R or R<count>. Example: R3/PT1H (three times, hourly).';
  const rest = parts.slice(1);
  if (rest.length < 1 || rest.length > 2) return 'Write R<count>/<duration>, optionally with a start date: R3/2030-01-01T09:00:00Z/PT1H.';
  const durations = rest.filter((p) => p.startsWith('P') || p.startsWith('-P'));
  if (durations.length !== 1) return 'A repeating interval needs exactly one duration such as PT1H.';
  for (const part of rest) {
    const problem = durations.includes(part) ? isoDurationProblem(part) : isoDateProblem(part);
    if (problem) return `${part}: ${problem}`;
  }
  if (/^R0$/.test(first)) return 'R0 repeats zero times; the timer would never fire.';
  return undefined;
}

// --- Quartz cron -------------------------------------------------------------------------------------------------------------

interface CronField {
  name: string;
  min: number;
  max: number;
  names?: readonly string[];
  /** index of the first entry of `names` (1 for months and weekdays) */
  nameBase?: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const FIELDS: readonly CronField[] = [
  { name: 'seconds', min: 0, max: 59 },
  { name: 'minutes', min: 0, max: 59 },
  { name: 'hours', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { name: 'day of week', min: 1, max: 7, names: WEEKDAYS, nameBase: 1 },
  { name: 'year', min: 1970, max: 2199 },
];

function cronValue(field: CronField, token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token);
  const index = field.names?.indexOf(token.toUpperCase() as never) ?? -1;
  return index >= 0 ? index + (field.nameBase ?? 0) : undefined;
}

function cronPartProblem(field: CronField, part: string): string | undefined {
  const range = (text: string): string | undefined => {
    const bounds = text.split('-');
    if (bounds.length > 2) return `"${text}" is not a range`;
    const values = bounds.map((b) => cronValue(field, b));
    if (values.some((v) => v === undefined)) return `"${text}" is not a ${field.name} value`;
    for (const v of values as number[]) if (v < field.min || v > field.max) return `${v} is outside ${field.min}-${field.max} for ${field.name}`;
    if (values.length === 2 && values[0]! > values[1]!) return `"${text}" counts backwards`;
    return undefined;
  };
  if (part === '*' || part === '?') return undefined;
  const step = part.split('/');
  if (step.length > 2) return `"${part}" has two steps`;
  if (step.length === 2) {
    if (!/^[1-9]\d*$/.test(step[1]!)) return `the step "${step[1]}" must be a positive number`;
    return step[0] === '*' ? undefined : range(step[0]!) ?? undefined;
  }
  if (field.name === 'day of month' && (part === 'L' || part === 'LW' || /^L-\d+$/.test(part) || /^\d+W$/.test(part))) return undefined;
  if (field.name === 'day of week') {
    if (part === 'L' || /^[A-Za-z0-9]+L$/.test(part) || /^[A-Za-z0-9]+#[1-5]$/.test(part)) return undefined;
  }
  return range(part);
}

/** Problem with a Quartz cron expression (6 or 7 fields, `?` in the day of month or the day of week), or undefined. */
export function cronProblem(value: string): string | undefined {
  const fields = value.trim().split(/\s+/);
  if (fields.length < 6 || fields.length > 7) {
    return `A Quartz cron expression has 6 or 7 fields (seconds minutes hours day-of-month month day-of-week [year]); this has ${fields.length}. Example: 0 0 12 * * ? (daily at noon).`;
  }
  for (const [i, text] of fields.entries()) {
    const field = FIELDS[i]!;
    for (const part of text.split(',')) {
      const problem = cronPartProblem(field, part);
      if (problem) return `${field.name}: ${problem}.`;
    }
  }
  const [dayOfMonth, dayOfWeek] = [fields[3]!, fields[5]!];
  if ((dayOfMonth === '?') === (dayOfWeek === '?')) {
    return dayOfMonth === '?' ? 'Day of month and day of week are both "?"; one of them needs a value.' : 'Quartz needs "?" in the day of month or the day of week; both have a value. Example: 0 0 12 ? * MON (Mondays at noon).';
  }
  return undefined;
}

/** True when the cycle looks like a cron expression rather than an ISO repeat. */
export const looksLikeCron = (value: string): boolean => !/^R\d*\//.test(value.trim()) && /\s/.test(value.trim());

// --- the timer as the panel validates it -------------------------------------------------------------------------------------

/** Validation message for a timer value (`undefined` is fine); expressions are checked as JUEL only. */
export function timerDiagnostic(type: TimerType, value: string | undefined, endDate?: string): Diagnostic | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const text = value.trim();
  if (isExpression(text)) {
    const problem = juelError(text);
    return problem ? error(problem) : info('Evaluated when the process reaches the timer; it must give a valid value of this type.');
  }
  let problem: string | undefined;
  if (type === 'date') problem = isoDateProblem(text);
  else if (type === 'duration') problem = isoDurationProblem(text);
  else problem = looksLikeCron(text) ? cronProblem(text) : isoRepeatProblem(text);
  if (problem) return error(problem);
  if (endDate && endDate.trim() !== '' && !isExpression(endDate)) {
    const end = isoDateProblem(endDate.trim());
    if (end) return error(`End date: ${end}`);
  }
  return undefined;
}

export function endDateDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (isExpression(value)) return juelError(value) ? error(juelError(value)!) : undefined;
  const problem = isoDateProblem(value.trim());
  return problem ? error(problem) : undefined;
}

// --- human readable preview --------------------------------------------------------------------------------------------------

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

function describeDuration(value: string): string {
  const m = DURATION.exec(value)!;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const parts: string[] = [];
  if (y) parts.push(plural(y, 'year'));
  if (mo) parts.push(plural(mo, 'month'));
  if (d) parts.push(plural(d, 'day'));
  if (h) parts.push(plural(h, 'hour'));
  if (mi) parts.push(plural(mi, 'minute'));
  if (s) parts.push(plural(s, 'second'));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '0 seconds');
  return value.startsWith('-') ? `minus ${text}` : text;
}

function describeDate(value: string): string {
  const m = DATE_TIME.exec(value)!;
  const hasTime = m[4] !== undefined;
  const zone = m[8];
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  if (!hasTime) return day;
  const time = `${m[4]}:${m[5]}${m[6] && m[6] !== '00' ? `:${m[6]}` : ''}`;
  const where = zone === 'Z' ? ' UTC' : zone ? ` (UTC${zone.length === 3 ? `${zone}:00` : zone})` : ' (server time zone)';
  return `${day}, ${time}${where}`;
}

function describeCronField(field: CronField, text: string, unit: string): string {
  if (text === '*' || text === '?') return `every ${unit}`;
  const parts = text.split(',').map((part) => {
    const step = part.split('/');
    if (step.length === 2) {
      const start = step[0] === '*' ? undefined : step[0]!;
      return `every ${step[1] === '1' ? unit : `${step[1]} ${unit}s`}${start ? ` from ${start}` : ''}`;
    }
    if (part.includes('-')) return `${unit}s ${part.replace('-', ' through ')}`;
    if (part === 'L') return `the last ${unit}`;
    return `${unit} ${part}`;
  });
  void field;
  return parts.join(' and ');
}

/** A sentence for a Quartz cron expression, e.g. `0 0/30 * * * ?` gives "Every 30 minutes from 0 (at second 0)". */
export function describeCron(value: string): string {
  const [sec, min, hour, dom, month, dow, year] = value.trim().split(/\s+/);
  const f = (i: number, text: string | undefined, unit: string): string => describeCronField(FIELDS[i]!, text ?? '*', unit);
  const exact = (x: string | undefined): boolean => x !== undefined && /^\d+$/.test(x);
  let time: string;
  if (exact(sec) && exact(min) && exact(hour)) {
    time = `At ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}${sec === '0' ? '' : `:${sec!.padStart(2, '0')}`}`;
  } else if (exact(sec) && /^(\*|\d+)\/\d+$|^\*$/.test(min!) && hour === '*') {
    time = min === '*' ? `Every minute at second ${sec}` : `Every ${min!.split('/')[1]} minutes${min!.startsWith('*') ? '' : ` from minute ${min!.split('/')[0]}`}${sec === '0' ? '' : ` at second ${sec}`}`;
  } else if (sec === '0' && min === '0' && /^(\*|\d+)\/\d+$/.test(hour!)) {
    time = `Every ${hour!.split('/')[1]} hours`;
  } else {
    time = `At ${f(0, sec, 'second')}, ${f(1, min, 'minute')}, ${f(2, hour, 'hour')}`;
  }
  const names = (x: string): string => x.replace(/\b\d+\b/g, (n) => MONTHS[Number(n) - 1] ?? n);
  const days = (x: string): string => x.replace(/\b[1-7]\b/g, (n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(n) - 1]!);
  const date: string[] = [];
  if (dow !== '?' && dow !== '*') date.push(`on ${days(dow!)}`);
  else if (dom !== '?' && dom !== '*') date.push(`on day ${dom} of the month`);
  else date.push('every day');
  if (month !== '*') date.push(`in ${names(month!)}`);
  if (year) date.push(`in ${year}`);
  return `${time}, ${date.join(' ')}`;
}

/** What a timer does, in a sentence, or undefined while the value is empty or invalid. */
export function describeTimer(type: TimerType, value: string | undefined, endDate?: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const text = value.trim();
  if (isExpression(text)) return 'The value is an expression: it is evaluated when the process reaches the timer.';
  if (timerDiagnostic(type, text, endDate)?.severity === 'error') return undefined;
  const until = endDate && endDate.trim() !== '' ? `, until ${isExpression(endDate) ? 'the end date expression' : describeDate(endDate.trim())}` : '';
  if (type === 'date') return `Fires once on ${describeDate(text)}.`;
  if (type === 'duration') return `Fires once, ${describeDuration(text)} after the process reaches the timer (a start event: after the deployment).`;
  if (looksLikeCron(text)) return `${describeCron(text)}${until}.`;
  const parts = text.split('/');
  const count = parts[0] === 'R' ? undefined : Number(parts[0]!.slice(1));
  const duration = parts.find((p) => p.startsWith('P') || p.startsWith('-P'))!;
  const date = parts.slice(1).find((p) => !p.startsWith('P') && !p.startsWith('-P'));
  return `Repeats every ${describeDuration(duration)}${count === undefined ? ' without a limit' : `, ${plural(count, 'time')}`}${date ? ` starting ${describeDate(date)}` : ''}${until}.`;
}

/** A warning when the type does not suit the element (the engine fires an intermediate catch cycle only once, ...). */
export function timerPlacementWarning(type: TimerType, element: { kind: 'start' | 'boundary' | 'intermediate' | 'end'; interrupting?: boolean }): Diagnostic | undefined {
  if (type === 'cycle' && element.kind === 'intermediate') return warning('A cycle on an intermediate catch event fires only once.');
  if (type === 'cycle' && element.kind === 'boundary' && element.interrupting !== false) return warning('An interrupting boundary timer never repeats: it cancels the activity when it fires. Make it non-interrupting to repeat.');
  return undefined;
}
