import { CAMUNDA_NS } from './detect';
import type { MappingValue } from '../../extensions';

/** The value of a Camunda input / output parameter, read from its XML. */
export type ParameterValue =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'json'; json: unknown }
  | { ok: false; reason: string };

const camundaChildren = (el: Element, local: string): Element[] => Array.from(el.children).filter((c) => c.namespaceURI === CAMUNDA_NS && c.localName === local);

function nested(el: Element): ParameterValue {
  const script = camundaChildren(el, 'script')[0];
  if (script) return { ok: false, reason: 'script' };
  const list = camundaChildren(el, 'list')[0];
  if (list) {
    const items: unknown[] = [];
    for (const item of Array.from(list.children)) {
      if (item.namespaceURI !== CAMUNDA_NS || item.localName !== 'value') continue;
      const value = nested(item);
      if (!value.ok) return value;
      items.push(value.kind === 'text' ? value.text : value.json);
    }
    return { ok: true, kind: 'json', json: items };
  }
  const map = camundaChildren(el, 'map')[0];
  if (map) {
    const entries: Record<string, unknown> = {};
    for (const entry of Array.from(map.children)) {
      if (entry.namespaceURI !== CAMUNDA_NS || entry.localName !== 'entry') continue;
      const value = nested(entry);
      if (!value.ok) return value;
      entries[entry.getAttribute('key') ?? ''] = value.kind === 'text' ? value.text : value.json;
    }
    return { ok: true, kind: 'json', json: entries };
  }
  return { ok: true, kind: 'text', text: (el.textContent ?? '').trim() };
}

/** Reads `<inputParameter>` / `<outputParameter>`: text, a list or a map of values; a script is not representable. */
export const parameterValue = (param: Element): ParameterValue => nested(param);

const SINGLE_VARIABLE = /^[#$]\{\s*([A-Za-z_$][\w$]*)\s*\}$/;
const hasExpression = (text: string): boolean => text.includes('${') || text.includes('#{');

/**
 * The mapping entry for a parameter.
 *  - Input: a value, evaluated when the task starts (`${expression}` works in a `VALUE`).
 *  - Output: a single `${variable}` is the variable of the result (`VARIABLE`); text without an expression is a fixed value; any other
 *    expression is refused by the engine in an output mapping, so it is `'expression'` and the caller reports it.
 */
export function mappingValueOf(value: ParameterValue & { ok: true }, direction: 'input'): MappingValue;
export function mappingValueOf(value: ParameterValue & { ok: true }, direction: 'output'): MappingValue | 'expression';
export function mappingValueOf(value: ParameterValue & { ok: true }, direction: 'input' | 'output'): MappingValue | 'expression' {
  if (direction === 'input') return { type: 'VALUE', value: value.kind === 'text' ? value.text : value.json };
  if (value.kind === 'json') return hasExpression(JSON.stringify(value.json)) ? 'expression' : { type: 'VALUE', value: value.json };
  const single = SINGLE_VARIABLE.exec(value.text);
  if (single) return { type: 'VARIABLE', value: single[1] };
  return hasExpression(value.text) ? 'expression' : { type: 'VALUE', value: value.text };
}
