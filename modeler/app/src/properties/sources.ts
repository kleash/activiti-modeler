import type { DiagramElement } from '@activiti-modeler/bpmn-js-activiti';

/**
 * Pluggable sources of expression completions. The editor of an expression asks every registered source for what fits at
 * the cursor; the diagram's own variables and the JUEL keywords are always offered. A source can add, for
 * example, the Spring bean names of a connected engine and its `vars.X` environment variables:
 *
 * ```ts
 * import { registerExpressionSource } from './properties/sources';
 * const unregister = registerExpressionSource({
 *   id: 'server',
 *   suggest: ({ kind, owner }) =>
 *     kind === 'member' && owner === 'vars' ? env.map((name) => ({ label: name, kind: 'env' })) : kind === 'identifier' ? beans.map((name) => ({ label: name, kind: 'bean' })) : [],
 * });
 * ```
 */

export type SuggestionKind = 'variable' | 'bean' | 'env' | 'function' | 'keyword';

export interface ExpressionSuggestion {
  label: string;
  kind: SuggestionKind;
  /** Short text after the label, e.g. the declared type. */
  detail?: string;
  /** Longer explanation shown next to the highlighted completion. */
  info?: string;
}

export interface SuggestionRequest {
  /** The element whose field is being edited. */
  element?: DiagramElement;
  /** `identifier`: a name at the start of an operand; `member`: after `owner.`. */
  kind: 'identifier' | 'member';
  /** For `member`: the name before the dot (`vars` for `${vars.REG`). */
  owner?: string;
  /** What has been typed of the word. */
  prefix: string;
}

export interface ExpressionSource {
  id: string;
  suggest(request: SuggestionRequest): ExpressionSuggestion[] | Promise<ExpressionSuggestion[]>;
}

const sources = new Map<string, ExpressionSource>();

/** Registers a source (replacing one with the same id) and returns the function that removes it again. */
export function registerExpressionSource(source: ExpressionSource): () => void {
  sources.set(source.id, source);
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
}

export const registeredExpressionSources = (): ExpressionSource[] => [...sources.values()];

/** Asks every registered source; one that throws or rejects is skipped (a failing server must not break the editor). */
export async function suggestFromSources(request: SuggestionRequest): Promise<ExpressionSuggestion[]> {
  const results = await Promise.all(
    registeredExpressionSources().map(async (source) => {
      try {
        return await source.suggest(request);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}
