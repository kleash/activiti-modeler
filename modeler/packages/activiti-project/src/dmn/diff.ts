/**
 * Semantic comparison of a hand-written DMN seed with the file the modeler generated for the same model (the corpus builds).
 * Ignored: the diagram (`dmndi`), attribute order, namespace prefixes, the order of requirements, and the ids that are not a
 * contract. The ids that ARE a contract are kept and compared: decisions, input data, business knowledge models, decision
 * services, knowledge sources, annotations and rules (a scenario asserts `matchedRules` by rule id, and a decision task names a
 * decision by id). References (`href`) are compared as written. Everything else is compared: names, labels, type references,
 * expressions, hit policies, aggregations, allowed values, input and output order, rule order, entries.
 *
 * Needs a `DOMParser` (the browser, or jsdom).
 */
import { feelTypeName } from './normalize';
import { parseXml } from './xml';

export interface DmnDiffOptions {
  /** Differences (by regular expression over the message) that the build knows about; they are removed from the result. */
  allow?: ReadonlyArray<RegExp>;
}

interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

/** Elements whose id is a contract (see above). */
const KEEP_ID = new Set(['decision', 'inputData', 'businessKnowledgeModel', 'decisionService', 'knowledgeSource', 'textAnnotation', 'rule', 'itemDefinition']);
const IGNORED_ATTRIBUTES = new Set(['namespace', 'exporter', 'exporterVersion', 'xmlns']);
const REQUIREMENTS = new Set(['informationRequirement', 'knowledgeRequirement', 'authorityRequirement']);

function canon(el: Element, depth: number): Node {
  const attrs: Record<string, string> = {};
  for (const attribute of Array.from(el.attributes)) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
    const name = attribute.localName;
    if (IGNORED_ATTRIBUTES.has(name)) continue;
    let value = attribute.value;
    if (name === 'id' && !KEEP_ID.has(el.localName)) continue;
    // the id of the definitions only names the document
    if (name === 'id' && depth === 0) continue;
    if (name === 'typeRef') value = feelTypeName(value);
    attrs[name] = value;
  }
  // defaults of the schema: an absent attribute is the same as the default
  if (el.localName === 'decisionTable') {
    attrs['hitPolicy'] ??= 'UNIQUE';
    attrs['hitPolicy'] = attrs['hitPolicy'].toUpperCase();
    if (attrs['aggregation']) attrs['aggregation'] = attrs['aggregation'].toUpperCase();
    if (attrs['preferredOrientation'] === 'Rule-as-Row') delete attrs['preferredOrientation'];
  }
  // `Any` is what a variable without a type is
  if (attrs['typeRef'] === 'Any' && ['variable', 'inputExpression', 'output'].includes(el.localName)) delete attrs['typeRef'];
  const children: Node[] = [];
  let text = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? '';
    else if (child.nodeType === 1) {
      const c = child as Element;
      if (c.localName === 'DMNDI') continue;
      children.push(canon(c, depth + 1));
    }
  }
  return { name: el.localName, attrs, children, text: el.localName === 'text' || children.length === 0 ? text.trim() : '' };
}

const label = (n: Node): string => (n.attrs['id'] ? `${n.name}[${n.attrs['id']}]` : n.attrs['name'] ? `${n.name}(${n.attrs['name']})` : n.name);

/** A requirement is identified by the element it points at. */
const requirementKey = (n: Node): string => `${n.name}>${n.children.map((c) => `${c.name}:${c.attrs['href'] ?? ''}`).join(',')}`;

function compare(expected: Node, actual: Node, path: string, out: string[]): void {
  for (const name of [...new Set([...Object.keys(expected.attrs), ...Object.keys(actual.attrs)])].sort()) {
    const e = expected.attrs[name];
    const a = actual.attrs[name];
    if (e !== a) out.push(`${path}/@${name}: expected ${e === undefined ? 'no attribute' : JSON.stringify(e)}, generated ${a === undefined ? 'no attribute' : JSON.stringify(a)}`);
  }
  if (expected.text !== actual.text) out.push(`${path}: expected text ${JSON.stringify(expected.text)}, generated ${JSON.stringify(actual.text)}`);

  // requirements are a set; everything else keeps its order (inputs, outputs, rules, entries and context entries are positional)
  const isRequirement = (n: Node): boolean => REQUIREMENTS.has(n.name);
  const ordered = (nodes: Node[]): Node[] => nodes.filter((n) => !isRequirement(n));
  const e = ordered(expected.children);
  const a = ordered(actual.children);
  // top level elements are matched by name and id: their order on the page is not a property of the model
  const keyed = expected.name === 'definitions' || actual.name === 'definitions';
  if (keyed) {
    const keyOf = (n: Node): string => `${n.name}#${n.attrs['id'] ?? n.attrs['name'] ?? ''}`;
    const aMap = new Map(a.map((n) => [keyOf(n), n]));
    const eMap = new Map(e.map((n) => [keyOf(n), n]));
    for (const [key, node] of eMap) {
      const other = aMap.get(key);
      if (other) compare(node, other, `${path}/${label(node)}`, out);
      else out.push(`${path}/${label(node)}: missing in the generated model`);
    }
    for (const [key, node] of aMap) if (!eMap.has(key)) out.push(`${path}/${label(node)}: only in the generated model`);
  } else {
    for (let i = 0; i < Math.max(e.length, a.length); i += 1) {
      const x = e[i];
      const y = a[i];
      if (x && y && x.name === y.name) compare(x, y, `${path}/${label(x)}${e.filter((n) => n.name === x.name).length > 1 ? `[${e.slice(0, i).filter((n) => n.name === x.name).length + 1}]` : ''}`, out);
      else if (x && !y) out.push(`${path}/${label(x)}: missing in the generated model`);
      else if (!x && y) out.push(`${path}/${label(y)}: only in the generated model`);
      else if (x && y) out.push(`${path}: expected ${label(x)} at position ${i + 1}, generated ${label(y)}`);
    }
  }
  const er = expected.children.filter(isRequirement).map(requirementKey).sort();
  const ar = actual.children.filter(isRequirement).map(requirementKey).sort();
  for (const key of er) if (!ar.includes(key)) out.push(`${path}: requirement ${key} is missing in the generated model`);
  for (const key of ar) if (!er.includes(key)) out.push(`${path}: requirement ${key} is only in the generated model`);
}

/** Differences between a seed DMN file and the generated one (empty when they are the same model). */
export function diffDmn(expectedXml: string, actualXml: string, options: DmnDiffOptions = {}): string[] {
  const expected = canon(parseXml(expectedXml, 'the seed DMN').documentElement, 0);
  const actual = canon(parseXml(actualXml, 'the generated DMN').documentElement, 0);
  const out: string[] = [];
  compare(expected, actual, expected.name, out);
  return out.filter((d) => !(options.allow ?? []).some((pattern) => pattern.test(d)));
}
