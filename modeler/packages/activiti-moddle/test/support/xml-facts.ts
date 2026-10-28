/**
 * "Attribute loss" check: reduces an XML document to a set of facts (element presence, attributes, text) keyed by a
 * namespace-aware path, ignoring the things a faithful re-serialisation may legitimately change.
 */

const SKIPPED_NAMESPACES = new Set([
  'http://www.omg.org/spec/BPMN/20100524/DI',
  'http://www.omg.org/spec/DD/20100524/DC',
  'http://www.omg.org/spec/DD/20100524/DI',
]);
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const ACTIVITI = 'http://activiti.org/bpmn';
const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/** Attribute values bpmn-moddle omits because they equal the BPMN default; absent and default mean the same. */
const BPMN_DEFAULTS: Record<string, string> = {
  isSequential: 'false',
  isInterrupting: 'true',
  cancelActivity: 'true',
  isForCompensation: 'false',
  triggeredByEvent: 'false',
  waitForCompletion: 'true',
  startQuantity: '1',
  completionQuantity: '1',
  instantiate: 'false',
  gatewayDirection: 'Unspecified',
  isClosed: 'false',
  isCollection: 'false',
  processType: 'None',
  cancelRemainingInstances: 'true',
  parallelMultiple: 'false',
  associationDirection: 'None',
  testBefore: 'false',
  textFormat: 'text/plain',
  typeLanguage: 'http://www.w3.org/2001/XMLSchema',
  expressionLanguage: 'http://www.w3.org/1999/XPath',
};

const DMN = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
const DMN_DEFAULTS: Record<string, string> = { hitPolicy: 'UNIQUE', preferredOrientation: 'Rule-as-Row' };

function describe(el: Element): string {
  const id = el.getAttribute('id');
  return `${el.namespaceURI ?? ''}#${el.localName}${id ? `[${id}]` : ''}`;
}

export function collectFacts(xml: string): Set<string> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`XML parse error: ${error.textContent}`);
  const facts = new Set<string>();

  const visit = (el: Element, path: string): void => {
    if (el.namespaceURI && SKIPPED_NAMESPACES.has(el.namespaceURI)) return;
    const here = `${path}/${describe(el)}`;
    facts.add(`E ${here}`);
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === XMLNS || attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
      if (attr.namespaceURI === XSI) continue;
      // attributes of non-BPMN elements are written unqualified; `x:a` and `a` on an `x:` element are the same attribute
      const ns = el.namespaceURI !== BPMN && !attr.namespaceURI ? (el.namespaceURI ?? '') : (attr.namespaceURI ?? '');
      if (el.namespaceURI === BPMN && !attr.namespaceURI && BPMN_DEFAULTS[attr.localName] === attr.value) continue;
      if (el.namespaceURI === DMN && !attr.namespaceURI && DMN_DEFAULTS[attr.localName] === attr.value) continue;
      facts.add(`A ${here}@{${ns}}${attr.localName}=${attr.value}`);
    }
    const children = Array.from(el.children);
    // text of leaf elements (script bodies, expressions, ...), ignoring layout whitespace
    if (children.length === 0 && el.textContent?.trim()) facts.add(`T ${here}=${el.textContent.trim()}`);
    const counters = new Map<string, number>();
    for (const child of children) {
      const key = describe(child);
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);
      // children without an id are addressed by position among their same-named siblings
      visit(child, child.getAttribute('id') ? here : `${here}<${index}>`);
    }
  };
  visit(doc.documentElement, '');
  return facts;
}

/** Facts present before and missing after. */
export function lostFacts(before: string, after: string): string[] {
  const b = collectFacts(before);
  const a = collectFacts(after);
  // moddle resolves an unqualified `assignee` on a BPMN element to the activiti property and writes it as `activiti:assignee`
  // (the engine reads `skipExpression` either way; for the rest the unqualified form fails XSD validation)
  for (const fact of [...a]) {
    if (fact.startsWith('A ') && fact.includes(`@{${ACTIVITI}}`)) a.add(fact.replace(`@{${ACTIVITI}}`, '@{}'));
  }
  return [...b].filter((f) => !a.has(f)).sort();
}
