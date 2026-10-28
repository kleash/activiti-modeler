import type { LintContext, ME } from './types';

const contexts = new WeakMap<object, LintContext>();

/** Attaches the context to a definitions element; rules find it by walking up from the node they check. */
export function setLintContext(definitions: ME, context: LintContext): void {
  contexts.set(definitions, context);
}

export function clearLintContext(definitions: ME): void {
  contexts.delete(definitions);
}

const EMPTY: LintContext = {};

export function lintContextOf(node: ME): LintContext {
  for (let current: ME | undefined = node; current; current = current.$parent) {
    const found = contexts.get(current);
    if (found) return found;
  }
  return EMPTY;
}

/** The elements bpmn-moddle dropped because of a duplicate id: `unparsable content <process> detected ... nested error: duplicate ID <p>`. */
export function duplicateIdsFromWarnings(warnings: ReadonlyArray<{ message?: string }>): Array<{ id: string; tag: string }> {
  const out: Array<{ id: string; tag: string }> = [];
  for (const w of warnings) {
    const m = /unparsable content <([^>]+)> detected[\s\S]*duplicate ID <([^>]+)>/.exec(w.message ?? '');
    if (m) out.push({ tag: m[1]!.replace(/^.*:/, ''), id: m[2]! });
  }
  return out;
}

/** `fromXML` / `importXML` warnings about references that did not resolve, as the `unresolved` map of a context. */
export function unresolvedFromWarnings(warnings: ReadonlyArray<{ message?: string; element?: ME; property?: string; value?: string }>): Map<object, Record<string, string>> {
  const out = new Map<object, Record<string, string>>();
  for (const w of warnings) {
    if (!w.element || !w.property || w.value === undefined || !/unresolved reference/i.test(w.message ?? '')) continue;
    const prop = w.property.includes(':') ? w.property.slice(w.property.indexOf(':') + 1) : w.property;
    const entry = out.get(w.element) ?? {};
    entry[prop] = w.value;
    out.set(w.element, entry);
  }
  return out;
}
