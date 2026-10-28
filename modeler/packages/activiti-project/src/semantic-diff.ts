/**
 * Semantic comparison of two versions of a process: a hand-written seed against the file the modeler generated for the
 * same model (the corpus builds, `corpus/<id>/build.ts`). Everything the engine ignores is ignored here too, and
 * nothing else: layout (`bpmndi`), attribute order, namespace prefixes, `incoming` / `outgoing`, the property ids of the
 * extensions JSON. Element ids, names, attributes, conditions, listeners, sequence flow order per source and the
 * extensions semantics must be equal.
 *
 * Needs a `DOMParser` (the browser, jsdom, or a global set by the caller).
 */

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const ACTIVITI = 'http://activiti.org/bpmn';

/** Attributes whose absence means this value (BPMN 2.0 XSD and Activiti defaults), so writing them or not is the same model. */
const DEFAULT_ATTRIBUTES: Readonly<Record<string, string>> = {
  isSequential: 'false',
  isInterrupting: 'true',
  cancelActivity: 'true',
  triggeredByEvent: 'false',
  isForCompensation: 'false',
  startQuantity: '1',
  completionQuantity: '1',
  '{http://activiti.org/bpmn}async': 'false',
  '{http://activiti.org/bpmn}exclusive': 'true',
  '{http://activiti.org/bpmn}terminateAll': 'false',
  '{http://activiti.org/bpmn}terminateMultiInstance': 'false',
};

export interface BpmnDiffOptions {
  /**
   * Local names of BPMN elements that exist only in the generated model because of how the editor draws something
   * (for example the `dataObjectReference` shape next to a `dataObject`), and are not compared.
   */
  ignoreElements?: readonly string[];
}

interface CNode {
  /** `{namespace}local` */
  name: string;
  attrs: Record<string, string>;
  children: CNode[];
  text: string;
}

const qname = (namespace: string | null, local: string): string => (namespace ? `{${namespace}}${local}` : local);

function parse(xml: string, label: string): Element {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`${label} is not well-formed XML: ${error.textContent?.trim().slice(0, 200)}`);
  return doc.documentElement;
}

function canon(element: Element, options: BpmnDiffOptions, depth: number): CNode {
  const attrs: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
    // the attributes of an `activiti:` element are read by name: `<activiti:customResource activiti:name="x">` equals `name="x"`
    const inOwnNamespace = attribute.namespaceURI === ACTIVITI && element.namespaceURI === ACTIVITI;
    const name = inOwnNamespace ? attribute.localName : qname(attribute.namespaceURI, attribute.localName);
    let value = attribute.value;
    if (attribute.namespaceURI === XSI && attribute.localName === 'type') {
      // a QName: `tFormalExpression`, `bpmn:tFormalExpression` and `xsi:type` with any prefix are the same type
      const colon = value.indexOf(':');
      const prefix = colon === -1 ? null : value.slice(0, colon);
      value = qname(element.lookupNamespaceURI(prefix), colon === -1 ? value : value.slice(colon + 1));
    }
    if (DEFAULT_ATTRIBUTES[name] === value) continue;
    attrs[name] = value;
  }
  // the root's id only names the document
  if (depth === 0) delete attrs['id'];
  const children: CNode[] = [];
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      text += child.nodeValue ?? '';
    } else if (child.nodeType === 1) {
      const c = child as Element;
      if (c.namespaceURI === BPMNDI) continue;
      if (c.namespaceURI === BPMN && (c.localName === 'incoming' || c.localName === 'outgoing')) continue;
      if (c.namespaceURI === BPMN && options.ignoreElements?.includes(c.localName)) continue;
      children.push(canon(c, options, depth + 1));
    }
  }
  return { name: qname(element.namespaceURI, element.localName), attrs, children, text: text.replace(/\s+/g, ' ').trim() };
}

const short = (name: string): string => name.replace(/^\{[^}]*\}/, '');
const label = (node: CNode): string => (node.attrs['id'] ? `${short(node.name)}[${node.attrs['id']}]` : short(node.name));

/** Expressions whose schema type is already `tExpression` (the base of `tFormalExpression`): an `xsi:type` on them adds nothing, the editor writes it anyway. */
const PLAIN_EXPRESSIONS = new Set(['timeDuration', 'timeDate', 'timeCycle', 'loopCardinality', 'completionCondition']);
const FORMAL_EXPRESSION = `{${BPMN}}tFormalExpression`;
const XSI_TYPE = `{${XSI}}type`;

/** Event definitions get a generated id from the editor; the seed omits it unless something refers to it. */
const generatedIdAllowed = (node: CNode): boolean => short(node.name).endsWith('EventDefinition');

function compareNodes(expected: CNode, actual: CNode, path: string, out: string[]): void {
  const attrNames = new Set([...Object.keys(expected.attrs), ...Object.keys(actual.attrs)]);
  for (const name of [...attrNames].sort()) {
    const e = expected.attrs[name];
    const a = actual.attrs[name];
    if (e === a) continue;
    if (name === 'id' && e === undefined && generatedIdAllowed(actual)) continue;
    if (name === XSI_TYPE && e === undefined && a === FORMAL_EXPRESSION && PLAIN_EXPRESSIONS.has(short(actual.name))) continue;
    out.push(`${path}/@${short(name)}: expected ${e === undefined ? 'no attribute' : JSON.stringify(e)}, generated ${a === undefined ? 'no attribute' : JSON.stringify(a)}`);
  }
  if (expected.text !== actual.text) out.push(`${path}: expected text ${JSON.stringify(expected.text)}, generated ${JSON.stringify(actual.text)}`);

  // children with an id are matched by name and id (the order of flow elements is not a model property); event
  // definitions and children without an id are matched by position (listeners, link sources, extension elements, ...)
  const isKeyed = (n: CNode): boolean => !!n.attrs['id'] && !generatedIdAllowed(n);
  const keyOf = (n: CNode): string => `${n.name}#${n.attrs['id']}`;
  const expectedKeyed = new Map(expected.children.filter(isKeyed).map((c) => [keyOf(c), c]));
  const actualKeyed = new Map(actual.children.filter(isKeyed).map((c) => [keyOf(c), c]));
  for (const [key, node] of expectedKeyed) {
    const counterpart = actualKeyed.get(key);
    if (counterpart) compareNodes(node, counterpart, `${path}/${label(node)}`, out);
    else out.push(`${path}/${label(node)}: missing in the generated model`);
  }
  for (const [key, node] of actualKeyed) {
    if (!expectedKeyed.has(key)) out.push(`${path}/${label(node)}: only in the generated model`);
  }
  const positionalE = expected.children.filter((c) => !isKeyed(c));
  const positionalA = actual.children.filter((c) => !isKeyed(c));
  for (let i = 0; i < Math.max(positionalE.length, positionalA.length); i += 1) {
    const e = positionalE[i];
    const a = positionalA[i];
    if (e && a && e.name === a.name) compareNodes(e, a, `${path}/${label(e)}`, out);
    else if (e && !a) out.push(`${path}/${label(e)}: missing in the generated model`);
    else if (!e && a) out.push(`${path}/${label(a)}: only in the generated model`);
    else if (e && a) out.push(`${path}: expected ${label(e)} at position ${i}, generated ${label(a)}`);
  }

  // the order of the outgoing flows of a source decides which condition wins (exclusive gateway, implicit split)
  const flowOrder = (n: CNode): Map<string, string[]> => {
    const bySource = new Map<string, string[]>();
    for (const c of n.children) {
      if (short(c.name) !== 'sequenceFlow' || !c.attrs['id']) continue;
      const source = c.attrs['sourceRef'] ?? '';
      bySource.set(source, [...(bySource.get(source) ?? []), c.attrs['id']]);
    }
    return bySource;
  };
  const eo = flowOrder(expected);
  const ao = flowOrder(actual);
  for (const [source, ids] of eo) {
    const other = ao.get(source) ?? [];
    if (ids.length > 1 && ids.length === other.length && ids.join() !== other.join()) {
      out.push(`${path}: sequence flows leaving ${source} are in another order: expected ${ids.join(', ')}, generated ${other.join(', ')}`);
    }
  }
}

/**
 * Differences between a seed BPMN and the generated one (empty when they are the same model). Each entry says where
 * (an element path made of element names and ids) and what.
 */
export function diffBpmn(expectedXml: string, actualXml: string, options: BpmnDiffOptions = {}): string[] {
  const expected = canon(parse(expectedXml, 'the seed BPMN'), options, 0);
  const actual = canon(parse(actualXml, 'the generated BPMN'), options, 0);
  const out: string[] = [];
  compareNodes(expected, actual, short(expected.name), out);
  return out;
}

// --- extensions JSON ---------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Java defaults of the model classes: a field that equals its default is the same as an absent one. */
const FALSE_DEFAULTS = ['required', 'ephemeral', 'analytics'] as const;

function normalizeMapping(mapping: unknown): Json {
  if (!isRecord(mapping)) return {};
  const out: Json = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (key === 'ephemeral' && value === false) continue;
    if ((key === 'inputs' || key === 'outputs') && isRecord(value)) {
      if (Object.keys(value).length === 0) continue;
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, m]) => [name, isRecord(m) ? { ...m, ...(typeof m['type'] === 'string' ? { type: m['type'].toUpperCase() } : {}) } : m]),
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeProcess(ext: unknown): Json {
  const e = isRecord(ext) ? ext : {};
  const out: Json = {};
  // properties are keyed by a generated id; the name is the identity
  const properties: Json = {};
  for (const definition of Object.values(isRecord(e['properties']) ? e['properties'] : {})) {
    if (!isRecord(definition)) continue;
    const copy: Json = { ...definition };
    delete copy['id'];
    for (const field of FALSE_DEFAULTS) if (copy[field] === false) delete copy[field];
    properties[String(copy['name'])] = copy;
  }
  if (Object.keys(properties).length > 0) out['properties'] = properties;
  const mappings: Json = {};
  for (const [element, mapping] of Object.entries(isRecord(e['mappings']) ? e['mappings'] : {})) {
    const normalized = normalizeMapping(mapping);
    // an element with an empty mapping entry maps nothing, same as no entry (unlike MAP_ALL, which is an entry with content)
    if (Object.keys(normalized).length > 0) mappings[element] = normalized;
  }
  if (Object.keys(mappings).length > 0) out['mappings'] = mappings;
  const constants: Json = {};
  for (const [element, values] of Object.entries(isRecord(e['constants']) ? e['constants'] : {})) {
    if (isRecord(values) && Object.keys(values).length > 0) constants[element] = values;
  }
  if (Object.keys(constants).length > 0) out['constants'] = constants;
  for (const key of ['templates', 'assignments'] as const) {
    const value = e[key];
    if (isRecord(value) && Object.keys(value).length > 0) out[key] = value;
  }
  return out;
}

function compareJson(expected: unknown, actual: unknown, path: string, out: string[]): void {
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (!(key in expected)) out.push(`${path}.${key}: only in the generated model (${JSON.stringify(actual[key])})`);
      else if (!(key in actual)) out.push(`${path}.${key}: missing in the generated model (expected ${JSON.stringify(expected[key])})`);
      else compareJson(expected[key], actual[key], `${path}.${key}`, out);
    }
    return;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) out.push(`${path}: expected ${JSON.stringify(expected)}, generated ${JSON.stringify(actual)}`);
}

/**
 * Differences between a seed `-extensions.json` (`undefined` when the seed has none) and the generated one. Process
 * variables are compared by name, mapping types case-insensitively, defaults like `required: false` as absent.
 */
export function diffExtensions(expectedJson: string | undefined, actualJson: string | undefined): string[] {
  const read = (text: string | undefined): Json => {
    if (text === undefined) return {};
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && isRecord(parsed['extensions']) ? parsed['extensions'] : {};
  };
  const expected = read(expectedJson);
  const actual = read(actualJson);
  const out: string[] = [];
  for (const processId of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    compareJson(normalizeProcess(expected[processId]), normalizeProcess(actual[processId]), `extensions[${processId}]`, out);
  }
  return out;
}
