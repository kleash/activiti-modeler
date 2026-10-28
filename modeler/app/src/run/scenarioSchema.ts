import schema from '../../../../schemas/scenario.schema.json';
import { locatePointers, rangeFor } from './jsonPointers';
import { SchemaValidator } from './jsonSchema';

const validator = new SchemaValidator(schema as unknown as Record<string, unknown>);

export interface ScenarioDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export const SCENARIO_SCHEMA = schema;

/** The step types of the schema, in the order of the form's "Add step" menu. */
export const STEP_TYPES = Object.keys(((schema as { $defs: { step: { properties: Record<string, unknown> } } }).$defs.step.properties));

/**
 * Checks the text of a scenario file against `schemas/scenario.schema.json` (the schema the server's runner validates with) and returns
 * editor markers. A text that is not JSON gets one marker at the syntax error.
 */
export function checkScenarioText(text: string): { diagnostics: ScenarioDiagnostic[]; value?: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const position = /position (\d+)/.exec(message)?.[1];
    const from = position ? Math.min(Number(position), Math.max(0, text.length - 1)) : 0;
    return { diagnostics: [{ from, to: from + 1, message: `Invalid JSON: ${message}`, severity: 'error' }] };
  }
  const map = locatePointers(text);
  const diagnostics = validator.validate(parsed).map((problem): ScenarioDiagnostic => {
    const range = rangeFor(map, problem.pointer, problem.key !== undefined);
    return { ...range, message: `${problem.pointer === '' ? 'The file' : problem.pointer}: ${problem.message}`, severity: 'error' };
  });
  return { diagnostics, value: parsed };
}
