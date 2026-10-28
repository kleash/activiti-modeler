import { layoutProcess } from 'bpmn-auto-layout';

/**
 * A BPMN file without a diagram (feature U18): written by hand, exported by a tool that does not draw, or converted from another
 * dialect. bpmn-js shows nothing for it, so the editor lays it out with `bpmn-auto-layout` when it is opened. The layout adds
 * the diagram elements and changes nothing else; saving then writes the diagram like any other.
 */

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** What `bpmn-auto-layout` cannot draw: the reason is shown to the person. */
export interface LayoutOutcome {
  /** The XML to open: the input when nothing was done. */
  xml: string;
  /** A layout was generated. */
  laidOut: boolean;
  /** Why no layout was generated, or what the layout leaves out. */
  note?: string;
}

function parse(xml: string): Document | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? undefined : doc;
}

/** True when the file has a process but no shape at all: nothing for the canvas to show. */
export function lacksDiagram(xml: string): boolean {
  const doc = parse(xml);
  if (!doc) return false;
  const processes = doc.getElementsByTagNameNS(BPMN_NS, 'process');
  if (processes.length === 0) return false;
  return doc.getElementsByTagNameNS(BPMNDI_NS, 'BPMNShape').length === 0;
}

/**
 * The layout reads the `outgoing` references of the flow nodes, which hand-written files often omit: add the ones that the
 * sequence flows imply (bpmn-js writes them on export anyway).
 */
function withFlowReferences(doc: Document): void {
  const nodes = new Map<string, Element>();
  for (const element of Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))) {
    const id = element.getAttribute('id');
    if (id) nodes.set(id, element);
  }
  const has = (node: Element, tag: 'incoming' | 'outgoing', id: string): boolean =>
    Array.from(node.children).some((child) => child.namespaceURI === BPMN_NS && child.localName === tag && child.textContent?.trim() === id);
  const add = (node: Element, tag: 'incoming' | 'outgoing', id: string): void => {
    if (has(node, tag, id)) return;
    const reference = doc.createElementNS(BPMN_NS, `${node.prefix ? `${node.prefix}:` : ''}${tag}`);
    reference.textContent = id;
    // the references follow the extension elements and the documentation, and precede the rest
    const first = Array.from(node.children).find((child) => child.localName !== 'documentation' && child.localName !== 'extensionElements');
    node.insertBefore(reference, first ?? null);
  };
  for (const flow of Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'sequenceFlow'))) {
    const id = flow.getAttribute('id');
    const source = nodes.get(flow.getAttribute('sourceRef') ?? '');
    const target = nodes.get(flow.getAttribute('targetRef') ?? '');
    if (!id) continue;
    if (source) add(source, 'outgoing', id);
    if (target) add(target, 'incoming', id);
  }
}

/** The XML with a generated diagram; the input when it has a diagram or when the layout cannot draw it. */
export async function layoutWhenMissing(xml: string, draw: (xml: string) => Promise<string> = layoutProcess): Promise<LayoutOutcome> {
  if (!lacksDiagram(xml)) return { xml, laidOut: false };
  const doc = parse(xml);
  if (!doc) return { xml, laidOut: false };
  const processes = doc.getElementsByTagNameNS(BPMN_NS, 'process').length;
  const participants = doc.getElementsByTagNameNS(BPMN_NS, 'participant').length;
  if (processes > 1 || participants > 1) {
    return { xml, laidOut: false, note: 'The file has several processes or participants. The automatic layout draws one process, so it was not applied.' };
  }
  try {
    withFlowReferences(doc);
    const result = await draw(new XMLSerializer().serializeToString(doc));
    return {
      xml: result,
      laidOut: true,
      ...(doc.getElementsByTagNameNS(BPMN_NS, 'messageFlow').length + doc.getElementsByTagNameNS(BPMN_NS, 'textAnnotation').length + doc.getElementsByTagNameNS(BPMN_NS, 'group').length > 0
        ? { note: 'Message flows, groups and text annotations are not drawn by the automatic layout.' }
        : {}),
    };
  } catch (error) {
    return { xml, laidOut: false, note: `The automatic layout failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
