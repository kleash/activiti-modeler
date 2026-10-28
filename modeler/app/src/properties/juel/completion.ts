import type { VariableSuggestion } from '@activiti-modeler/bpmn-js-activiti';

import { suggestFromSources, type ExpressionSuggestion, type SuggestionRequest } from '../sources';
import { completionContext, KEYWORDS } from './syntax';

export interface CompletionOptions {
  /** The process variables and context objects the diagram offers at the element. */
  variables(): VariableSuggestion[];
  /** `block`: the text is code without `${}` (a script). */
  block?: boolean;
  /** The element, handed to the registered sources. */
  element?: SuggestionRequest['element'];
}

export interface Completion {
  from: number;
  options: ExpressionSuggestion[];
}

const KEYWORD_INFO: Record<string, string> = {
  empty: 'true for null, "" and empty collections',
  not: 'logical not (also !)',
  and: 'logical and (also &&)',
  or: 'logical or (also ||)',
  div: 'division (also /)',
  mod: 'remainder (also %)',
  eq: 'equals (also ==)',
  ne: 'not equal (also !=)',
  lt: 'less than (also <)',
  gt: 'greater than (also >)',
  le: 'less or equal (also <=)',
  ge: 'greater or equal (also >=)',
};

const startsWith = (label: string, prefix: string): boolean => label.toLowerCase().startsWith(prefix.toLowerCase());

/**
 * The completions at `position` of an expression text: the process variables of the diagram and the beans of the registered
 * sources at the start of an operand, the keywords too, and for `vars.` the environment variables of the sources.
 */
export async function completeJuel(text: string, position: number, options: CompletionOptions): Promise<Completion | undefined> {
  const context = completionContext(text, position, { block: options.block ?? false });
  if (context.kind === 'none') return undefined;
  const request: SuggestionRequest = { kind: context.kind, prefix: context.prefix, ...(context.owner ? { owner: context.owner } : {}), ...(options.element ? { element: options.element } : {}) };
  const found: ExpressionSuggestion[] = [];
  if (context.kind === 'identifier') {
    for (const v of options.variables()) found.push({ label: v.name, kind: 'variable', detail: v.type ?? v.kind, info: v.detail });
    for (const keyword of KEYWORDS) found.push({ label: keyword, kind: 'keyword', ...(KEYWORD_INFO[keyword] ? { info: KEYWORD_INFO[keyword] } : {}) });
  }
  found.push(...(await suggestFromSources(request)));
  const seen = new Set<string>();
  const result = found.filter((s) => startsWith(s.label, context.prefix) && s.label !== context.prefix && !seen.has(`${s.kind}:${s.label}`) && seen.add(`${s.kind}:${s.label}`));
  return result.length === 0 ? undefined : { from: context.from, options: result };
}
