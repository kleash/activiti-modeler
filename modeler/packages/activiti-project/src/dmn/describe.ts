/**
 * What a DMN file says about its decisions, for the decision tester and for pickers: kind, hit policy, the inputs a caller has to
 * provide (with FEEL types and allowed values), outputs, rules and requirements. Read from the text with a DOM parser; version
 * agnostic like the lint scan, and it never throws for a file it cannot read (the `error` field says why).
 */
import { feelTypeName } from './normalize';
import { detectDmnVersion, type DmnVersion, kid, kids, parseXml, plainVariable, textOf } from './xml';

export type DecisionKind = 'table' | 'literal' | 'context' | 'invocation' | 'other' | 'empty';

export interface InputDescription {
  /** The variable the caller provides. */
  name: string;
  /** FEEL type name (`number`, `string`, ...); `Any` when the file does not say. */
  type: string;
  /** Allowed values of the input column (`inputValues`) as FEEL literals, when the table lists them. */
  allowedValues?: string[];
  /** Where the type comes from: an input data element or an input expression of a table. */
  source: 'inputData' | 'inputExpression';
}

export interface OutputDescription {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  allowedValues?: string[];
}

export interface RuleDescription {
  id: string;
  annotation?: string;
}

export interface DecisionDescription {
  id: string;
  name?: string;
  kind: DecisionKind;
  hitPolicy?: string;
  aggregation?: string;
  /** The input columns of the decision's own table (expression text and type). */
  tableInputs: Array<{ id?: string; label?: string; expression: string; type: string; allowedValues?: string[] }>;
  outputs: OutputDescription[];
  rules: RuleDescription[];
  /** Ids of required decisions and required input data. */
  requiredDecisions: string[];
  requiredInputs: string[];
  /** No other decision of the file requires it: what a file name resolves to. */
  sink: boolean;
  /** The variables a caller has to provide to evaluate the decision (own inputs, required input data, those of required decisions). */
  inputs: InputDescription[];
  /** True when a COLLECT without aggregator, RULE ORDER or OUTPUT ORDER decision returns a list under its id (ADR 0004). */
  multiResult: boolean;
}

export interface DmnDescription {
  version?: DmnVersion;
  name?: string;
  id?: string;
  decisions: DecisionDescription[];
  inputData: Array<{ id: string; name: string; type: string }>;
  /** Business knowledge models, decision services and boxed contexts: only the KIE engine evaluates them. */
  kieOnly: string[];
  /** Set when the file could not be read. */
  error?: string;
}

/** `"a","b"` -> `['"a"', '"b"']`; splits at commas outside string literals. */
export function splitLiterals(text: string | undefined): string[] {
  const out: string[] = [];
  if (!text) return out;
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === '\\' && quoted) {
      current += ch + (text[i + 1] ?? '');
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (ch === ',' && !quoted) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function kindOf(decision: Element): DecisionKind {
  if (kid(decision, 'decisionTable')) return 'table';
  if (kid(decision, 'literalExpression')) return 'literal';
  if (kid(decision, 'context')) return 'context';
  if (kid(decision, 'invocation')) return 'invocation';
  const logic = kids(decision).find((c) => ['relation', 'list', 'functionDefinition', 'conditional', 'for', 'some', 'every', 'filter'].includes(c.localName));
  return logic ? 'other' : 'empty';
}

const isMulti = (hitPolicy: string | undefined, aggregation: string | undefined): boolean => {
  const policy = (hitPolicy ?? 'UNIQUE').toUpperCase();
  if (policy === 'COLLECT') return !aggregation;
  return policy === 'RULE ORDER' || policy === 'OUTPUT ORDER';
};

export function describeDmn(xml: string): DmnDescription {
  const empty: DmnDescription = { decisions: [], inputData: [], kieOnly: [] };
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
  const root = doc.documentElement;
  if (root.localName !== 'definitions') return { ...empty, error: 'not a DMN definitions document' };
  const version = detectDmnVersion(xml);
  const result: DmnDescription = {
    ...empty,
    ...(version ? { version } : {}),
    ...(root.getAttribute('name') ? { name: root.getAttribute('name') as string } : {}),
    ...(root.getAttribute('id') ? { id: root.getAttribute('id') as string } : {}),
  };

  result.inputData = kids(root, 'inputData').map((i) => ({
    id: i.getAttribute('id') ?? '',
    name: i.getAttribute('name') ?? i.getAttribute('id') ?? '',
    type: feelTypeName(kid(i, 'variable')?.getAttribute('typeRef') ?? 'Any'),
  }));

  const byId = new Map<string, Element>();
  for (const el of kids(root)) if (el.getAttribute('id')) byId.set(el.getAttribute('id') as string, el);

  const raw = kids(root, 'decision').map((decision): DecisionDescription => {
    const table = kid(decision, 'decisionTable');
    const hitPolicy = table ? (table.getAttribute('hitPolicy') ?? 'UNIQUE').toUpperCase() : undefined;
    const aggregation = table?.getAttribute('aggregation')?.toUpperCase();
    const requirements = kids(decision, 'informationRequirement');
    return {
      id: decision.getAttribute('id') ?? '',
      ...(decision.getAttribute('name') ? { name: decision.getAttribute('name') as string } : {}),
      kind: kindOf(decision),
      ...(hitPolicy ? { hitPolicy } : {}),
      ...(aggregation ? { aggregation } : {}),
      tableInputs: (table ? kids(table, 'input') : []).map((input) => {
        const expression = kid(input, 'inputExpression');
        const values = splitLiterals(textOf(kid(input, 'inputValues')));
        return {
          ...(input.getAttribute('id') ? { id: input.getAttribute('id') as string } : {}),
          ...(input.getAttribute('label') ? { label: input.getAttribute('label') as string } : {}),
          expression: textOf(expression) ?? '',
          type: feelTypeName(expression?.getAttribute('typeRef') ?? 'Any'),
          ...(values.length > 0 ? { allowedValues: values } : {}),
        };
      }),
      outputs: (table ? kids(table, 'output') : []).map((output) => {
        const values = splitLiterals(textOf(kid(output, 'outputValues')));
        return {
          ...(output.getAttribute('id') ? { id: output.getAttribute('id') as string } : {}),
          ...(output.getAttribute('name') ? { name: output.getAttribute('name') as string } : {}),
          ...(output.getAttribute('label') ? { label: output.getAttribute('label') as string } : {}),
          ...(output.getAttribute('typeRef') ? { type: feelTypeName(output.getAttribute('typeRef') as string) } : {}),
          ...(values.length > 0 ? { allowedValues: values } : {}),
        };
      }),
      rules: (table ? kids(table, 'rule') : []).map((rule, index) => {
        const description = textOf(kid(rule, 'description'));
        return { id: rule.getAttribute('id') ?? `${decision.getAttribute('id')}_rule${index + 1}`, ...(description ? { annotation: description } : {}) };
      }),
      requiredDecisions: requirements.flatMap((r) => (kid(r, 'requiredDecision') ? [(kid(r, 'requiredDecision') as Element).getAttribute('href')?.replace(/^#/, '') ?? ''] : [])),
      requiredInputs: requirements.flatMap((r) => (kid(r, 'requiredInput') ? [(kid(r, 'requiredInput') as Element).getAttribute('href')?.replace(/^#/, '') ?? ''] : [])),
      sink: true,
      inputs: [],
      multiResult: isMulti(hitPolicy, aggregation),
    };
  });
  const required = new Set(raw.flatMap((d) => d.requiredDecisions));
  for (const d of raw) d.sink = !required.has(d.id);

  const decisionById = new Map(raw.map((d) => [d.id, d]));
  const needed = (id: string, seen = new Set<string>()): InputDescription[] => {
    const decision = decisionById.get(id);
    if (!decision || seen.has(id)) return [];
    seen.add(id);
    const out: InputDescription[] = [];
    const provided = new Set<string>();
    for (const ref of decision.requiredInputs) {
      const element = byId.get(ref);
      const name = element?.getAttribute('name') ?? ref;
      provided.add(name);
      out.push({ name, type: feelTypeName(kid(element as Element, 'variable')?.getAttribute('typeRef') ?? 'Any'), source: 'inputData' });
    }
    for (const ref of decision.requiredDecisions) {
      const required = decisionById.get(ref);
      provided.add(required?.name ?? ref);
      out.push(...needed(ref, seen));
    }
    for (const column of decision.tableInputs) {
      const name = plainVariable(column.expression);
      if (!name || provided.has(name) || out.some((o) => o.name === name)) continue;
      out.push({ name, type: column.type, source: 'inputExpression', ...(column.allowedValues ? { allowedValues: column.allowedValues } : {}) });
    }
    return out;
  };
  for (const d of raw) {
    const unique = new Map<string, InputDescription>();
    for (const input of needed(d.id)) if (!unique.has(input.name)) unique.set(input.name, input);
    // required decisions provide their own names to the decisions that read them
    d.inputs = [...unique.values()].filter((i) => !raw.some((other) => (other.name ?? other.id) === i.name && other.id !== d.id && d.requiredDecisions.includes(other.id)));
  }
  result.decisions = raw;

  const kieOnly = ['businessKnowledgeModel', 'decisionService'];
  for (const el of kids(root)) if (kieOnly.includes(el.localName)) result.kieOnly.push(`${el.localName} ${el.getAttribute('id') ?? ''}`.trim());
  for (const d of raw) if (d.kind === 'context' || d.kind === 'invocation' || d.kind === 'other') result.kieOnly.push(`${d.kind} ${d.id}`);
  return result;
}

/** The decision a name (decision id, file base name or definitions name) selects in a file, as ADR 0004 resolves it. */
export function resolveDecisionIn(description: DmnDescription, baseName: string, value: string): DecisionDescription | undefined {
  const byId = description.decisions.find((d) => d.id === value);
  if (byId) return byId;
  if (baseName === value || description.name === value) {
    const sinks = description.decisions.filter((d) => d.sink);
    return sinks.length === 1 ? sinks[0] : undefined;
  }
  return undefined;
}
