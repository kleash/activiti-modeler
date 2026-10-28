/**
 * Small DOM helpers for the DMN functions of this package (normalizer, description, semantic diff). They need a `DOMParser`
 * (the browser, or jsdom in the tests) and work on local names, so a document that uses a prefix for the DMN namespace is read
 * like one that uses the default namespace.
 */

export const DMN_NS_13 = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
export const DMNDI_NS_13 = 'https://www.omg.org/spec/DMN/20191111/DMNDI/';
export const DC_NS = 'http://www.omg.org/spec/DMN/20180521/DC/';
export const DI_NS = 'http://www.omg.org/spec/DMN/20180521/DI/';

/** Namespaces of older DMN versions: [namespace, version, replacement for a plain namespace swap (1.2 only; 1.1 has another schema)]. */
export const LEGACY_DMN_NAMESPACES: ReadonlyArray<{ namespace: string; version: '1.1' | '1.2'; swap?: string }> = [
  { namespace: 'http://www.omg.org/spec/DMN/20151101/dmn.xsd', version: '1.1' },
  { namespace: 'http://www.omg.org/spec/DMN/20180521/MODEL/', version: '1.2', swap: DMN_NS_13 },
];

/** The DMN versions the modeler reads without migration, by model namespace (1.4 and 1.5 are read as they are, with a warning). */
export const NEWER_DMN_NAMESPACES: ReadonlyArray<{ namespace: string; version: '1.4' | '1.5' }> = [
  { namespace: 'https://www.omg.org/spec/DMN/20211108/MODEL/', version: '1.4' },
  { namespace: 'https://www.omg.org/spec/DMN/20230324/MODEL/', version: '1.5' },
];

export type DmnVersion = '1.1' | '1.2' | '1.3' | '1.4' | '1.5';

/** The DMN version a document declares (by the namespace of its root), without parsing it; undefined when it is not a DMN document. */
export function detectDmnVersion(xml: string): DmnVersion | undefined {
  const head = xml.slice(0, 4000);
  if (/DMN\/20151101\/dmn\.xsd/.test(head)) return '1.1';
  if (/DMN\/20180521\/MODEL/.test(head)) return '1.2';
  if (/DMN\/20191111\/MODEL/.test(head)) return '1.3';
  if (/DMN\/20211108\/MODEL/.test(head)) return '1.4';
  if (/DMN\/20230324\/MODEL/.test(head)) return '1.5';
  return undefined;
}

export function parseXml(xml: string, label = 'the DMN file'): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`${label} is not well-formed XML: ${error.textContent?.trim().slice(0, 200)}`);
  return doc;
}

/** Child elements (optionally only those with a local name). */
export function kids(parent: Element, localName?: string): Element[] {
  const out: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (localName === undefined || (node as Element).localName === localName)) out.push(node as Element);
  }
  return out;
}

export const kid = (parent: Element, localName: string): Element | undefined => kids(parent, localName)[0];

/** Text of the `<text>` child of an expression element, trimmed; undefined without a `<text>`. */
export function textOf(expression: Element | undefined): string | undefined {
  if (!expression) return undefined;
  const text = kid(expression, 'text');
  return text ? (text.textContent ?? '').trim() : undefined;
}

const NAME = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

/** The variable an input expression reads when it is nothing but a name (`age`, `customer.age` reads `customer`); undefined for any other expression. */
export function plainVariable(expression: string | undefined): string | undefined {
  const text = (expression ?? '').trim();
  return NAME.test(text) ? text.split('.')[0] : undefined;
}

// --- serialization -------------------------------------------------------------------------------------------------------

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(node: Node): string {
  switch (node.nodeType) {
    case 3:
      return escapeText(node.nodeValue ?? '');
    case 4:
      return `<![CDATA[${node.nodeValue ?? ''}]]>`;
    case 8:
      return `<!--${node.nodeValue ?? ''}-->`;
    case 7:
      return `<?${(node as ProcessingInstruction).target} ${(node as ProcessingInstruction).data}?>`;
    case 1:
      return element(node as Element, undefined);
    default:
      return '';
  }
}

function openTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
    .join('');
  return `<${el.prefix ? `${el.prefix}:` : ''}${el.localName}${attrs}`;
}

function element(el: Element, indent: string | undefined): string {
  const name = `${el.prefix ? `${el.prefix}:` : ''}${el.localName}`;
  const children = Array.from(el.childNodes);
  const hasElements = children.some((c) => c.nodeType === 1);
  const significantText = children.some((c) => (c.nodeType === 3 || c.nodeType === 4) && (c.nodeValue ?? '').trim() !== '');
  if (children.length === 0 || (!hasElements && !significantText && !children.some((c) => c.nodeType === 4 || c.nodeType === 8))) {
    return `${openTag(el)} />`;
  }
  // text only, or mixed content: written as it is, because whitespace in text is data
  if (!hasElements || significantText) return `${openTag(el)}>${children.map(inline).join('')}</${name}>`;
  const next = `${indent ?? ''}  `;
  const lines = children
    .filter((c) => !(c.nodeType === 3 && (c.nodeValue ?? '').trim() === ''))
    .map((c) => `${next}${c.nodeType === 1 ? element(c as Element, next) : inline(c)}`);
  return `${openTag(el)}>\n${lines.join('\n')}\n${indent ?? ''}</${name}>`;
}

/** Writes a document with two-space indentation (the style dmn-js writes); `declaration` is the XML declaration to keep. */
export function serializeDocument(doc: Document, declaration = '<?xml version="1.0" encoding="UTF-8"?>'): string {
  const parts: string[] = [];
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 1) parts.push(element(node as Element, ''));
    else if (node.nodeType === 8) parts.push(`<!--${node.nodeValue ?? ''}-->`);
  }
  return `${declaration}\n${parts.join('\n')}\n`;
}
