import { ACTIVITI_CHECKLIST, ACTIVITI_NAMESPACE } from '@activiti-modeler/activiti-moddle';

/**
 * Post-export checks of the ADR 0003 serializer guarantees. They run on the XML text that is about to be written, so a
 * defect in bpmn-js, in a behaviour or in an imported file can never reach a project on disk.
 */

export type ViolationCode =
  | 'XML_NOT_WELL_FORMED'
  | 'NOT_EXECUTABLE'
  | 'MULTI_INSTANCE_WHITESPACE'
  | 'CHILD_ORDER'
  | 'INVALID_ID'
  | 'ID_TOO_LONG'
  | 'DUPLICATE_ID'
  | 'FOREIGN_ATTRIBUTE'
  | 'UNQUALIFIED_ACTIVITI_ATTRIBUTE'
  | 'ACTIVITI_PREFIX'
  | 'UNDECLARED_PREFIX';

export interface Violation {
  code: ViolationCode;
  message: string;
  elementId?: string;
}

export interface VerifyResult {
  violations: Violation[];
  /** Things that are preserved but linted: foreign extension elements. */
  warnings: string[];
}

export class ExportVerificationError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[], context?: string) {
    super(
      `${context ? `${context}: ` : ''}export refused, the BPMN breaks ${violations.length} serializer guarantee(s) (ADR 0003):\n` +
        violations.map((v) => `  - [${v.code}] ${v.message}`).join('\n'),
    );
    this.name = 'ExportVerificationError';
    this.violations = violations;
  }
}

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const DIAGRAM_NAMESPACES = new Set([
  'http://www.omg.org/spec/BPMN/20100524/DI',
  'http://www.omg.org/spec/DD/20100524/DC',
  'http://www.omg.org/spec/DD/20100524/DI',
]);
/** Namespaces whose attributes are allowed on semantic elements: colour picker output (bioc:, color:). */
const ALLOWED_ATTRIBUTE_NAMESPACES = new Set([
  ACTIVITI_NAMESPACE.uri,
  XSI,
  XMLNS,
  'http://bpmn.io/schema/bpmn/biocolor/1.0',
  'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
  ...DIAGRAM_NAMESPACES,
]);

/** Unqualified names the engine only honours as `activiti:` attributes (strict reads); unqualified they fail the XSD or are ignored. */
const STRICT_ACTIVITI_ATTRIBUTES = new Set(
  ACTIVITI_CHECKLIST.entries.filter((e) => e.kind === 'attribute' && e.namespace === 'activiti' && e.match === 'strict').map((e) => e.name),
);

/** BPMN attributes of type xsd:QName that hold a prefixed value in practice (data object types, item definitions). */
const QNAME_ATTRIBUTES = ['itemSubjectRef', 'structureRef', 'typeRef'] as const;

const NCNAME = /^[\p{L}_][\p{L}\p{N}._\-·]*$/u;
const MAX_ID_LENGTH = 255;

const CONTAINERS = new Set(['process', 'subProcess', 'transaction', 'adHocSubProcess']);
const ARTIFACTS = new Set(['association', 'textAnnotation', 'group']);
const NON_FLOW_ELEMENTS = new Set([
  'documentation', 'extensionElements', 'auditing', 'monitoring', 'property', 'laneSet', 'resourceRole', 'performer',
  'humanPerformer', 'potentialOwner', 'correlationSubscription', 'supports', 'ioSpecification', 'dataInputAssociation',
  'dataOutputAssociation', 'multiInstanceLoopCharacteristics', 'standardLoopCharacteristics', 'incoming', 'outgoing',
  'completionCondition', 'conditionExpression',
]);

/** Position of a child within its container, following Semantic.xsd: documentation, extensionElements, laneSet, flow elements, artifacts. */
function containerRank(child: Element): number | undefined {
  if (child.namespaceURI !== BPMN) return undefined;
  const name = child.localName;
  if (name === 'documentation') return 0;
  if (name === 'extensionElements') return 1;
  if (name === 'laneSet') return 3;
  if (ARTIFACTS.has(name)) return 5;
  if (NON_FLOW_ELEMENTS.has(name)) return undefined;
  return 4;
}

const RANK_NAME = ['documentation', 'extensionElements', '', 'laneSet', 'flow elements', 'artifacts'];

function describe(el: Element): string {
  const id = el.getAttribute('id');
  return id ? `${el.localName} "${id}"` : `<${el.localName}>`;
}

export function verifyBpmnXml(xml: string): VerifyResult {
  const violations: Violation[] = [];
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    violations.push({ code: 'XML_NOT_WELL_FORMED', message: `XML is not well-formed: ${parseError.textContent?.trim().split('\n')[0] ?? ''}` });
    return { violations, warnings };
  }
  const root = doc.documentElement;

  // 1. every process is executable (Activiti skips isExecutable="false")
  for (const process of Array.from(root.getElementsByTagNameNS(BPMN, 'process'))) {
    if (process.getAttribute('isExecutable') !== 'true') {
      violations.push({
        code: 'NOT_EXECUTABLE',
        elementId: process.getAttribute('id') ?? undefined,
        message: `process "${process.getAttribute('id')}" has isExecutable=${JSON.stringify(process.getAttribute('isExecutable'))}; Activiti skips processes that are not isExecutable="true"`,
      });
    }
  }

  // 2. newline after </multiInstanceLoopCharacteristics> (the engine parser consumes one event too many otherwise)
  for (const mi of Array.from(root.getElementsByTagNameNS(BPMN, 'multiInstanceLoopCharacteristics'))) {
    const next = mi.nextSibling;
    const ok = next !== null && next.nodeType === 3 && /\n/.test(next.nodeValue ?? '');
    if (!ok) {
      const host = mi.parentElement;
      violations.push({
        code: 'MULTI_INSTANCE_WHITESPACE',
        elementId: host?.getAttribute('id') ?? undefined,
        message: `${host ? describe(host) : 'activity'}: multiInstanceLoopCharacteristics is not followed by a line break; the Activiti parser would swallow the closing tag of its activity and absorb the following flow elements`,
      });
    }
  }

  // 3. XSD child order: documentation and extensionElements first everywhere; in containers also laneSet, flow elements, artifacts
  for (const container of Array.from(root.getElementsByTagName('*'))) {
    if (container.namespaceURI !== BPMN) continue;
    let seenOther = false;
    let seenExtensions = false;
    for (const child of Array.from(container.children)) {
      const isBase = child.namespaceURI === BPMN && (child.localName === 'documentation' || child.localName === 'extensionElements');
      if (isBase && (seenOther || (seenExtensions && child.localName === 'documentation'))) {
        violations.push({ code: 'CHILD_ORDER', elementId: container.getAttribute('id') ?? undefined, message: `${describe(container)}: ${describe(child)} must precede the other children (XSD order: documentation, extensionElements, then the rest)` });
      }
      if (!isBase) seenOther = true;
      if (isBase && child.localName === 'extensionElements') seenExtensions = true;
    }
    if (!CONTAINERS.has(container.localName)) continue;
    let highest = -1;
    let highestName = '';
    for (const child of Array.from(container.children)) {
      const rank = containerRank(child);
      if (rank === undefined || rank < 3) continue;
      if (rank < highest) {
        violations.push({
          code: 'CHILD_ORDER',
          elementId: container.getAttribute('id') ?? undefined,
          message: `${describe(container)}: ${describe(child)} (${RANK_NAME[rank]}) comes after ${highestName} (${RANK_NAME[highest]}); XSD order is documentation, extensionElements, laneSet, flow elements, artifacts`,
        });
      } else {
        highest = rank;
        highestName = describe(child);
      }
    }
  }

  // 4. ids: NCName, at most 255 characters, unique
  const seen = new Map<string, Element>();
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    if (id === null) continue;
    if (!NCNAME.test(id)) violations.push({ code: 'INVALID_ID', elementId: id, message: `${describe(el)}: "${id}" is not a valid NCName (letters, digits, "_", "-", "."; no spaces or colons; must not start with a digit)` });
    if (id.length > MAX_ID_LENGTH) violations.push({ code: 'ID_TOO_LONG', elementId: id.slice(0, 40), message: `${describe(el)}: id has ${id.length} characters, the limit is ${MAX_ID_LENGTH}` });
    if (seen.has(id)) violations.push({ code: 'DUPLICATE_ID', elementId: id, message: `id "${id}" is used by ${describe(seen.get(id)!)} and ${describe(el)}` });
    else seen.set(id, el);
  }

  // 5. only activiti: extension attributes (plus the colour and diagram namespaces) on semantic elements
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (el.namespaceURI && DIAGRAM_NAMESPACES.has(el.namespaceURI)) continue;
    const semantic = el.namespaceURI === BPMN || el.namespaceURI === ACTIVITI_NAMESPACE.uri;
    if (!semantic) {
      if (!ALLOWED_ATTRIBUTE_NAMESPACES.has(el.namespaceURI ?? '') && el.parentElement?.localName === 'extensionElements') {
        warnings.push(`${describe(el.parentElement.parentElement ?? el)} has the foreign extension element <${el.prefix ? `${el.prefix}:` : ''}${el.localName}> (namespace ${el.namespaceURI})`);
      }
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === XMLNS || attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
      if (attr.namespaceURI) {
        if (!ALLOWED_ATTRIBUTE_NAMESPACES.has(attr.namespaceURI)) {
          violations.push({ code: 'FOREIGN_ATTRIBUTE', elementId: el.getAttribute('id') ?? undefined, message: `${describe(el)}: attribute ${attr.name} is in the foreign namespace ${attr.namespaceURI}; only activiti: attributes (and bioc:/color: colours) are allowed` });
        } else if (attr.namespaceURI === ACTIVITI_NAMESPACE.uri && attr.prefix !== ACTIVITI_NAMESPACE.prefix) {
          violations.push({ code: 'ACTIVITI_PREFIX', elementId: el.getAttribute('id') ?? undefined, message: `${describe(el)}: the Activiti namespace must use the prefix "activiti" (found "${attr.prefix}"); the engine reads message-definition attributes by that prefix` });
        }
      } else if (el.namespaceURI === BPMN && STRICT_ACTIVITI_ATTRIBUTES.has(attr.name) && !(attr.name === 'skipExpression' && el.localName === 'sequenceFlow')) {
        violations.push({ code: 'UNQUALIFIED_ACTIVITI_ATTRIBUTE', elementId: el.getAttribute('id') ?? undefined, message: `${describe(el)}: "${attr.name}" must be written as activiti:${attr.name}; unqualified it fails XSD validation and is ignored by the engine` });
      }
    }
    if (el.namespaceURI === ACTIVITI_NAMESPACE.uri && el.prefix !== ACTIVITI_NAMESPACE.prefix) {
      violations.push({ code: 'ACTIVITI_PREFIX', elementId: el.getAttribute('id') ?? undefined, message: `<${el.prefix}:${el.localName}>: the Activiti namespace must use the prefix "activiti"` });
    }
  }

  // 6. attribute values that are QNames need their prefix declared (`itemSubjectRef="xsd:int"` without xmlns:xsd makes the
  //    engine parser, and with it the whole deployment, fail with UndeclaredPrefix)
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (el.namespaceURI !== BPMN) continue;
    for (const name of QNAME_ATTRIBUTES) {
      const value = el.getAttribute(name);
      const colon = value === null ? -1 : value.indexOf(':');
      if (value === null || colon <= 0) continue;
      const prefix = value.slice(0, colon);
      if (el.lookupNamespaceURI(prefix) === null) {
        violations.push({ code: 'UNDECLARED_PREFIX', elementId: el.getAttribute('id') ?? undefined, message: `${describe(el)}: ${name}="${value}" uses the prefix "${prefix}", which is not declared (xmlns:${prefix}); the Activiti parser rejects the whole deployment` });
      }
    }
  }

  // 7. a drawn data object is not understood by the Activiti parser: its diagram shape refers to an element it does not know
  for (const reference of Array.from(root.getElementsByTagNameNS(BPMN, 'dataObjectReference'))) {
    const id = reference.getAttribute('id');
    const drawn = Array.from(root.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/DI', 'BPMNShape')).some((s) => s.getAttribute('bpmnElement') === id);
    if (drawn) warnings.push(`dataObjectReference "${id}" is drawn: Activiti 9 deploys the model but reports its shape as DI_INVALID_REFERENCE (it does not know data object references; the data object itself works)`);
  }

  return { violations, warnings };
}

/** Throws ExportVerificationError when the XML breaks a guarantee. Returns the warnings otherwise. */
export function assertBpmnExportable(xml: string, context?: string): string[] {
  const { violations, warnings } = verifyBpmnXml(xml);
  if (violations.length > 0) throw new ExportVerificationError(violations, context);
  return warnings;
}
