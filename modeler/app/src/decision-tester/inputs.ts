/** Typed inputs of the decision tester (feature DM10) and what is remembered per DMN file (U33). */

export type ParsedInput = { omit: true } | { omit?: false; value: unknown } | { error: string };

/**
 * One typed input as the server's FEEL engine gets it. An empty field means "not provided": the variable is missing and evaluates to
 * `null` in FEEL (ADR 0004), which is what a decision task with that input unmapped does.
 */
export function parseInput(type: string, raw: string): ParsedInput {
  const text = raw.trim();
  if (text === '') return { omit: true };
  switch (type.toLowerCase()) {
    case 'number': {
      const value = Number(text);
      return Number.isFinite(value) ? { value } : { error: `"${text}" is not a number` };
    }
    case 'boolean':
      if (text === 'true' || text === 'false') return { value: text === 'true' };
      return { error: 'enter true or false' };
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: text } : { error: 'use the form 2026-10-27' };
    case 'time':
      return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?$/.test(text) ? { value: text } : { error: 'use the form 14:30:00' };
    case 'date and time':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?$/.test(text) ? { value: text } : { error: 'use the form 2026-10-27T14:30:00' };
    case 'string':
      return { value: raw };
    default:
      // Any, item definitions, durations: JSON when it is JSON (numbers, true, lists, objects), else the text
      try {
        return { value: JSON.parse(text) };
      } catch {
        return { value: raw };
      }
  }
}

/** The text a literal of `outputValues` / `inputValues` stands for: `"gold"` is `gold`. */
export const literalText = (literal: string): string => {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(literal);
  return quoted ? quoted[1]!.replace(/\\(.)/g, '$1') : literal;
};

export interface RememberedInputs {
  decision?: string;
  /** What was typed, by decision id and then input name (the text, not the parsed value). */
  inputs: Record<string, Record<string, string>>;
}

const KEY_PREFIX = 'activiti-modeler.decision-tester.v1:';

/** The key under which the inputs of one DMN file are kept: the project and the file. */
export const inputsKey = (project: string, path: string): string => `${KEY_PREFIX}${project}:${path}`;

export function loadInputs(key: string): RememberedInputs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { inputs: {} };
    const parsed = JSON.parse(raw) as Partial<RememberedInputs>;
    const inputs: Record<string, Record<string, string>> = {};
    for (const [decision, values] of Object.entries(parsed.inputs ?? {})) {
      if (typeof values !== 'object' || values === null) continue;
      inputs[decision] = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    }
    return { ...(typeof parsed.decision === 'string' ? { decision: parsed.decision } : {}), inputs };
  } catch {
    return { inputs: {} };
  }
}

export function saveInputs(key: string, remembered: RememberedInputs): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(remembered));
  } catch {
    // the inputs are a convenience: without storage the form starts empty next time
  }
}
