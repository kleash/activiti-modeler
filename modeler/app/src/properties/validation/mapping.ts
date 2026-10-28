import { expressionDiagnostic } from './values';
import { type Diagnostic, error, warning } from './types';

/**
 * Values of mappings, constants and variable defaults are JSON values in the extensions file but a line of text in the panel. The
 * text is read as JSON when it is JSON (a number, true, false, null, an array, an object, a quoted text) and as a plain text
 * otherwise, so `hello` and `${customerName} is ${tier}` stay unquoted and `42` is the number 42. A text that would read as JSON
 * is shown with quotes: `"42"` is the text 42.
 */
export function valueFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function valueToText(value: unknown): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value.trim());
      return value.trim() === '' ? value : JSON.stringify(value);
    } catch {
      return value;
    }
  }
  return value === undefined ? '' : JSON.stringify(value);
}

const PATCH_OPERATIONS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];

/** An RFC 6902 patch: a JSON array of operations. */
export function jsonPatchProblem(text: string | undefined): Diagnostic | undefined {
  if (!text) return error('A JSON patch needs its operations: [{ "op": "add", "path": "/name", "value": "Ann" }].');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return error(`The patch is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) return error('A JSON patch is an array of operations: [{ "op": "add", "path": "/name", "value": "Ann" }].');
  for (const [index, operation] of parsed.entries()) {
    const o = operation as { op?: unknown; path?: unknown } | null;
    if (typeof o !== 'object' || o === null || typeof o.op !== 'string' || typeof o.path !== 'string') return error(`Operation ${index + 1} needs an "op" and a "path".`);
    if (!PATCH_OPERATIONS.includes(o.op)) return error(`Operation ${index + 1}: "op" is one of ${PATCH_OPERATIONS.join(', ')}.`);
  }
  return undefined;
}

/** A VALUE input: text, a JSON literal, or text with ${expressions} that are resolved against the process variables. */
export function inputValueDiagnostic(text: string | undefined): Diagnostic | undefined {
  if (!text) return undefined;
  return expressionDiagnostic(text);
}

/** A VALUE output: the engine refuses an expression in an output value. */
export function outputValueDiagnostic(text: string | undefined): Diagnostic | undefined {
  if (!text) return undefined;
  if (/\$\{/.test(text)) return error('An output value cannot contain an expression; use a VARIABLE output to copy a value.');
  return undefined;
}

/** A mapping target or source that is a variable name; the engine accepts any key, but an expression can only read a plain name. */
export function mappingNameProblem(text: string | undefined, what: string): Diagnostic | undefined {
  if (!text) return undefined;
  if (!/^[A-Za-z_$][\w$]*$/.test(text)) return warning(`${what} is not a plain name (letters, digits, "_" and "$"): an expression such as \${name} cannot read it.`);
  return undefined;
}

