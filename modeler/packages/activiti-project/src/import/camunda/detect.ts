import type { CamundaDetection } from './types';

export const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
export const CAMUNDA_MODELER_NS = 'http://camunda.org/schema/modeler/1.0';
export const CAMUNDA_NS_FAMILY = 'http://camunda.org/schema/';
export const ZEEBE_NS_PREFIX = 'http://camunda.org/schema/zeebe/';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const ACTIVITI_NS = 'http://activiti.org/bpmn';

/** An XML namespace of the Camunda family: the Camunda 7 one, the Camunda Modeler's, Zeebe's, the DMN one. */
export const isVendorNamespace = (uri: string | null): boolean => !!uri && uri.startsWith(CAMUNDA_NS_FAMILY);

export function parseXml(xml: string): { doc: Document; error?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? { doc, error: (error.textContent ?? 'not well-formed').trim().split('\n')[0] ?? 'not well-formed' } : { doc };
}

/** Does a BPMN document use Camunda 7 (or Camunda 8) extensions? Says what and how much, so the offer can name it. */
export function detectCamundaDocument(doc: Document): CamundaDetection {
  const result: CamundaDetection = { found: false, zeebe: false, prefixes: [], attributes: 0, elements: 0, modeler: false };
  const prefixes = new Set<string>();
  const visit = (element: Element): void => {
    if (isVendorNamespace(element.namespaceURI)) {
      if (element.namespaceURI === CAMUNDA_NS) result.elements += 1;
      if (element.namespaceURI?.startsWith(ZEEBE_NS_PREFIX)) result.zeebe = true;
      if (element.prefix) prefixes.add(element.prefix);
    }
    for (const attr of Array.from(element.attributes)) {
      const uri = attr.namespaceURI;
      if (uri === XMLNS_NS || !isVendorNamespace(uri)) continue;
      if (uri === CAMUNDA_NS) {
        result.attributes += 1;
        if (attr.prefix) prefixes.add(attr.prefix);
      } else if (uri === CAMUNDA_MODELER_NS) result.modeler = true;
      else if (uri?.startsWith(ZEEBE_NS_PREFIX)) result.zeebe = true;
    }
    for (const child of Array.from(element.children)) visit(child);
  };
  if (doc.documentElement) visit(doc.documentElement);
  result.prefixes = [...prefixes].sort();
  // the Modeler metadata alone counts: the export refuses its attributes, as it refuses any foreign attribute
  result.found = result.attributes + result.elements > 0 || result.zeebe || result.modeler;
  return result;
}

/** Detection on the XML text; a text that is not XML reports the parse error. */
export function detectCamunda(xml: string): CamundaDetection {
  // cheap exit: no namespace of the family is mentioned at all
  if (!xml.includes(CAMUNDA_NS_FAMILY)) return { found: false, zeebe: false, prefixes: [], attributes: 0, elements: 0, modeler: false };
  const { doc, error } = parseXml(xml);
  if (error) return { found: false, zeebe: false, prefixes: [], attributes: 0, elements: 0, modeler: false, error };
  return detectCamundaDocument(doc);
}
