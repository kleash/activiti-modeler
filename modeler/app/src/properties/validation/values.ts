import { juelError } from '../juel/syntax';
import { isoDateProblem, isoDurationProblem } from './timer';
import { type Diagnostic, error, info } from './types';

const isExpression = (v: string): boolean => /[$#]\{/.test(v);

/** A value that may be an expression: any syntax error of the expression is an error. */
export function expressionDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value || !isExpression(value)) return undefined;
  const problem = juelError(value);
  return problem ? error(problem) : undefined;
}

/** `activiti:priority`: a whole number or an expression. */
export function priorityDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  return /^-?\d+$/.test(value) ? undefined : error('The priority is a whole number such as 50, or an expression such as ${urgency}.');
}

/** `activiti:dueDate`: an ISO 8601 duration (relative to the creation of the task), an ISO 8601 date-time, or an expression. */
export function dueDateDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  const problem = /^-?P/.test(value) ? isoDurationProblem(value) : isoDateProblem(value);
  return problem ? error(`${problem} (a due date is a duration such as P2D, a date-time, or an expression).`) : undefined;
}

/** A resource assignment such as `user(ann), group(clerks)`, a bare name (a group) or an expression. */
export function resourceDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  const parts = value.split(',').map((p) => p.trim());
  if (parts.some((p) => p === '')) return error('An empty entry between commas. Write user(ann), group(clerks).');
  const bare = parts.filter((p) => !/^(user|group)\([^()]+\)$/.test(p));
  const wrong = bare.find((p) => /[()]/.test(p));
  if (wrong) return error(`"${wrong}" is not user(name) or group(name).`);
  if (bare.length > 0) return info(`${bare.map((b) => `"${b}"`).join(', ')} ${bare.length === 1 ? 'is' : 'are'} read as ${bare.length === 1 ? 'a group' : 'groups'}; write user(${bare[0]}) for a user.`);
  return undefined;
}

/** A comma separated list of ids (candidate users and groups, starters) or an expression. */
export function idListDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  if (value.split(',').some((p) => p.trim() === '')) return error('An empty entry between commas.');
  return undefined;
}

/** The key of a called process: letters, digits, `.`, `_`, `-`; or an expression. */
export function processKeyDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  return /^[A-Za-z_][\w.-]*$/.test(value) ? undefined : error('A process key starts with a letter or "_" and has letters, digits, ".", "_" and "-" only; or use an expression such as ${processKey}.');
}

/** `<connector>.<ACTION>`: the connector name has no dot. */
export function connectorDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return error('Enter the connector action as <connector>.<ACTION>, for example mailer.SEND.');
  if (value === '##WebService') return error('Web service tasks are not supported by Activiti 9 (there is no CXF importer).');
  return /^[^.\s]+\.[^.\s]+$/.test(value) ? undefined : error('A connector action is <connector>.<ACTION>: a name without dots, a dot, and the action name.');
}

/** `R5/PT10S`: the number of attempts and the wait. */
export function retryCycleDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  if (isExpression(value)) return expressionDiagnostic(value);
  if (!/^R\d*\/P/.test(value)) return error('A retry cycle is R<attempts>/<wait>, for example R5/PT10S: five attempts, ten seconds apart.');
  const [, duration] = value.split('/');
  const problem = duration ? isoDurationProblem(duration) : 'missing';
  return problem ? error(`The wait ${duration ?? ''} is not an ISO 8601 duration. Example: R5/PT10S.`) : undefined;
}

/** A fully qualified exception class name. */
export function exceptionClassDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value) ? undefined : error('Enter a fully qualified exception class such as java.lang.IllegalStateException.');
}
