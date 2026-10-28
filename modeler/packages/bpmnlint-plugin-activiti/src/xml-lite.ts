/**
 * A small, forgiving XML reader for the files the lint reads without bpmn-moddle (DMN, raw BPMN text checks). It builds an
 * element tree with attributes, text and source offsets. It is not a validator: malformed input yields the best tree it can.
 */
export interface XmlNode {
  /** Qualified name as written (`dmn:decision`). */
  name: string;
  /** Local name (`decision`). */
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated text children. */
  text: string;
  /** Offset of the `<` of the start tag. */
  start: number;
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export const decodeEntities = (s: string): string =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

export function parseXmlLite(text: string): XmlNode | undefined {
  const root: XmlNode = { name: '#root', local: '#root', attrs: {}, children: [], text: '', start: 0 };
  const stack: XmlNode[] = [root];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3] !== undefined) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      ATTR.lastIndex = 0;
      for (let a = ATTR.exec(m[4] ?? ''); a; a = ATTR.exec(m[4] ?? '')) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? '');
      const name = m[3];
      const node: XmlNode = { name, local: name.slice(name.indexOf(':') + 1), attrs, children: [], text: '', start: m.index };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root.children[0];
}

export function* descendants(node: XmlNode): Generator<XmlNode> {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

export const childrenNamed = (node: XmlNode, local: string): XmlNode[] => node.children.filter((c) => c.local === local);
export const firstChild = (node: XmlNode, local: string): XmlNode | undefined => node.children.find((c) => c.local === local);
