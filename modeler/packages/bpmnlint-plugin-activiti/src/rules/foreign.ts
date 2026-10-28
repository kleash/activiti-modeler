/** Rules about what is not Activiti in the document: Camunda / Zeebe extensions (L1), foreign attributes, QName prefixes, duplicate ids. */
import { ACTIVITI_CHECKLIST } from '@activiti-modeler/activiti-moddle';

import { CAMUNDA_NAMESPACE_PREFIX, ELEMENT_REMOVAL_REASONS, SAME_NAME_ELEMENTS, translateAttribute } from '../camunda-map';
import { defineRule, onDefinitions } from '../define';
import { ACTIVITI_NS, foreignAttributes, is, label, namespaceOfPrefix, str } from '../model';
import type { ME } from '../types';
import { parseXmlLite, type XmlNode } from '../xml-lite';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const DIAGRAM = ['http://www.omg.org/spec/BPMN/20100524/DI', 'http://www.omg.org/spec/DD/20100524/DC', 'http://www.omg.org/spec/DD/20100524/DI'];
/** Namespaces whose attributes the serializer lets through (ADR 0003, guarantee 5): colours and the diagram. */
const ALLOWED_ATTRIBUTE_NAMESPACES = new Set([ACTIVITI_NS, XSI, 'http://bpmn.io/schema/bpmn/biocolor/1.0', 'http://www.omg.org/spec/BPMN/non-normative/color/1.0', ...DIAGRAM]);

const isCamundaLike = (ns: string | undefined): boolean => !!ns && ns.startsWith(CAMUNDA_NAMESPACE_PREFIX);
const isZeebe = (ns: string | undefined): boolean => !!ns && ns.startsWith('http://camunda.org/schema/zeebe/');

const STRICT_ACTIVITI = new Set(ACTIVITI_CHECKLIST.entries.filter((e) => e.kind === 'attribute' && e.namespace === 'activiti' && e.match === 'strict').map((e) => e.name));
const QNAME_ATTRIBUTES = ['itemSubjectRef', 'structureRef', 'typeRef'] as const;
/** Prefixes moddle declares itself when it writes the document. */
const SELF_DECLARED = new Set(['bpmn', 'bpmndi', 'dc', 'di', 'activiti', 'xsi', 'xml', 'xmlns']);

export interface CamundaOccurrence {
  kind: 'attribute' | 'element';
  /** As written, with its prefix: `camunda:assignee`. */
  name: string;
  prefix: string;
  local: string;
  ns: string;
  value?: string;
  /** What a quick fix does. */
  action: 'rename' | 'async' | 'element' | 'remove';
  to?: string;
  reason?: string;
}

/** Camunda and Zeebe attributes and elements of one node (attributes) or of a generic extension element. */
export function camundaOccurrences(node: ME): CamundaOccurrence[] {
  const out: CamundaOccurrence[] = [];
  const isService = is(node, 'bpmn:ServiceTask');
  const foreign = foreignAttributes(node);
  const hasExpression = !!str(node, 'activiti:expression') || foreign.some((a) => a.local === 'expression' && isCamundaLike(namespaceOfPrefix(node, a.prefix)));
  for (const attr of foreign) {
    const ns = namespaceOfPrefix(node, attr.prefix);
    if (!isCamundaLike(ns)) continue;
    if (isZeebe(ns)) {
      out.push({ kind: 'attribute', name: attr.name, prefix: attr.prefix, local: attr.local, ns: ns!, value: attr.value, action: 'remove', reason: 'Zeebe has no counterpart in Activiti' });
      continue;
    }
    const translation = typeof node.$instanceOf === 'function' ? translateAttribute(attr.local, (t) => node.$instanceOf(t), isService, hasExpression) : { kind: 'remove' as const, reason: '' };
    if (translation.kind === 'rename') out.push({ kind: 'attribute', name: attr.name, prefix: attr.prefix, local: attr.local, ns: ns!, value: attr.value, action: 'rename', to: translation.to });
    else if (translation.kind === 'async') out.push({ kind: 'attribute', name: attr.name, prefix: attr.prefix, local: attr.local, ns: ns!, value: attr.value, action: 'async', to: 'activiti:async' });
    else out.push({ kind: 'attribute', name: attr.name, prefix: attr.prefix, local: attr.local, ns: ns!, value: attr.value, action: 'remove', reason: translation.reason });
  }
  const generic = (node.$descriptor as { isGeneric?: boolean } | undefined)?.isGeneric === true;
  if (generic && node.$type.includes(':')) {
    const prefix = node.$type.slice(0, node.$type.indexOf(':'));
    const local = node.$type.slice(node.$type.indexOf(':') + 1);
    const ns = namespaceOfPrefix(node, prefix);
    if (isCamundaLike(ns)) {
      const translatable = !isZeebe(ns) && (local in SAME_NAME_ELEMENTS || local === 'inputOutput' || local === 'in' || local === 'out');
      out.push({
        kind: 'element',
        name: node.$type,
        prefix,
        local,
        ns: ns!,
        action: translatable ? 'element' : 'remove',
        ...(translatable ? {} : { reason: isZeebe(ns) ? 'Zeebe has no counterpart in Activiti' : (ELEMENT_REMOVAL_REASONS[local] ?? 'Activiti has no equivalent') }),
      });
    }
  }
  return out;
}

export const foreignRules = [
  defineRule({
    id: 'no-camunda-extensions',
    tag: 'L1',
    severity: 'error',
    title: 'A camunda: or zeebe: attribute or element',
    why: 'Activiti reads only the `http://activiti.org/bpmn` namespace for its extension attributes. A `camunda:assignee` is silently ignored (the task has no assignee and nothing says so), `camunda:class` on a service task fails the deployment, and a `camunda:inputOutput` does nothing. The modeler never writes them and refuses to save a file that has them.',
    evidence: ['R1 §0.1-1', 'R1 §5 (translation table)', 'R1 §7.1 L1', 'engine runs t01 t13d', 'FEATURE_MATRIX §C'],
    howToFix: 'Use the quick fix: it translates the attribute or element to its Activiti equivalent where there is one (assignee, candidateUsers, class, expression, asyncBefore as async, listeners, fields, input/output parameters as an extensions mapping, ...) and removes it where there is not (followUpDate, historyTimeToLive, external tasks, ...). A Camunda Modeler file can also be imported with the Camunda importer, which reports what was lost.',
    quickFix: 'translate-camunda',
    check: (node, api) => {
      for (const occurrence of camundaOccurrences(node)) {
        const where = occurrence.kind === 'attribute' ? `attribute ${occurrence.name}${occurrence.value !== undefined ? `="${occurrence.value}"` : ''} on ${label(node)}` : `element <${occurrence.name}> in ${label(node.$parent ?? node)}`;
        const outcome = occurrence.action === 'remove' ? `has no Activiti equivalent (${occurrence.reason}) and is ignored` : `is ignored by Activiti; translate it to ${occurrence.to ?? 'the activiti: element'}`;
        api.report(node.$descriptor && (node.$descriptor as { isGeneric?: boolean }).isGeneric ? (node.$parent ?? node) : node, `${where} ${outcome}`, {
          fix: occurrence.action === 'remove' ? 'remove-camunda' : 'translate-camunda',
          data: { ...occurrence, ownerType: node.$type },
        });
      }
    },
    bad: [
      { body: '<userTask id="u" camunda:assignee="kermit" camunda:candidateGroups="g"/>', ids: ['u', 'u'] },
      { body: '<serviceTask id="s" camunda:class="a.B" camunda:asyncBefore="true"/>', ids: ['s', 's'] },
      { body: '<userTask id="u"><extensionElements><camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput></extensionElements></userTask>', ids: ['u'] },
      { body: '<userTask id="u"><extensionElements><zeebe:taskDefinition xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" type="x"/></extensionElements></userTask>', ids: ['u'] },
    ],
    good: [{ body: '<userTask id="u" activiti:assignee="kermit" activiti:candidateGroups="g"/>' }],
  }),
  defineRule({
    id: 'foreign-attribute-namespace',
    tag: 'X',
    severity: 'error',
    title: 'An attribute from a namespace the serializer does not allow',
    why: 'ADR 0003 allows only `activiti:` attributes (plus the `bioc:` and `color:` colours and the diagram namespaces) on BPMN elements. Anything else is preserved on import but makes the export refuse the file, so it cannot be saved until it is removed. Camunda Modeler adds `modeler:executionPlatform` to every definitions element (reported as a Camunda extension).',
    evidence: ['ADR 0003 guarantee 5', 'verify.ts FOREIGN_ATTRIBUTE'],
    howToFix: 'Remove the attribute in the XML view.',
    quickFix: 'remove-attribute',
    check: (node, api) => {
      if (!node.$type.startsWith('bpmn:') && !node.$type.startsWith('activiti:')) return;
      if ((node.$descriptor as { isGeneric?: boolean } | undefined)?.isGeneric) return;
      for (const attr of foreignAttributes(node)) {
        const ns = namespaceOfPrefix(node, attr.prefix);
        if (ns === undefined || isCamundaLike(ns) || ALLOWED_ATTRIBUTE_NAMESPACES.has(ns)) continue;
        api.report(node, `Attribute ${attr.name} on ${label(node)} is in the namespace ${ns}; only activiti: attributes (and bioc:/color: colours) can be saved`, { data: { name: attr.name } });
      }
    },
    bad: [{ body: '<task id="t" xmlns:acme="urn:acme" acme:flag="1"/>', ids: ['t'] }],
    good: [{ body: '<task id="t" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" bioc:stroke="#000"/>' }],
  }),
  defineRule({
    id: 'unqualified-activiti-attribute',
    tag: 'X',
    severity: 'warn',
    title: 'An Activiti attribute written without the activiti: prefix in the file',
    why: 'Activiti reads attributes such as `assignee`, `class` or `async` only in the `activiti:` namespace. Written without the prefix they fail the XSD or are ignored. The editor reads such an attribute as the Activiti one and writes it with the prefix, so saving fixes the file; until then the file as it is on disk does not do what it says.',
    evidence: ['R1 §2.3', 'verify.ts UNQUALIFIED_ACTIVITI_ATTRIBUTE'],
    howToFix: 'Save the file from the modeler, or write `activiti:assignee` in the XML.',
    needs: ['text'],
    check: onDefinitions((_definitions, api) => {
      if (!api.ctx.text) return;
      const root = parseXmlLite(api.ctx.text);
      if (!root) return;
      const stack: XmlNode[] = [root];
      while (stack.length > 0) {
        const el = stack.pop()!;
        stack.push(...el.children);
        const bpmn = !el.name.includes(':') ? el.attrs['xmlns'] === undefined || el.attrs['xmlns'].includes('BPMN/20100524/MODEL') : false;
        if (!bpmn && !el.name.startsWith('bpmn')) continue;
        for (const name of Object.keys(el.attrs)) {
          if (name.includes(':') || name === 'xmlns') continue;
          if (STRICT_ACTIVITI.has(name) && !(name === 'skipExpression' && el.local === 'sequenceFlow') && el.attrs['id']) api.report(el.attrs['id'], `${el.local} ${el.attrs['id']}: "${name}" must be written as activiti:${name}`);
        }
      }
    }),
    bad: [{ body: '<userTask id="u" assignee="kermit"/>', ids: ['u'] }],
    good: [{ body: '<userTask id="u" activiti:assignee="kermit"/><sequenceFlow id="f" sourceRef="u" targetRef="u" skipExpression="${true}"/>' }],
  }),
  defineRule({
    id: 'undeclared-qname-prefix',
    tag: 'X',
    severity: 'error',
    title: 'A prefixed QName value whose prefix is not declared',
    why: '`itemSubjectRef="xsd:string"` needs `xmlns:xsd`. With the prefix undeclared the Activiti parser rejects the whole deployment (`UndeclaredPrefix`) and the modeler refuses to export. Checked attributes: `itemSubjectRef` (data objects), `structureRef` (item definitions), `typeRef`.',
    evidence: ['ADR 0003 guarantee 6', 'verify.ts UNDECLARED_PREFIX'],
    howToFix: 'Declare the prefix on the definitions (`xmlns:xsd="http://www.w3.org/2001/XMLSchema"`).',
    check: (node, api) => {
      if (!node.$type.startsWith('bpmn:')) return;
      for (const name of QNAME_ATTRIBUTES) {
        const value = str(node, name);
        const colon = value === undefined ? -1 : value.indexOf(':');
        if (value === undefined || colon <= 0) continue;
        const prefix = value.slice(0, colon);
        if (!SELF_DECLARED.has(prefix) && namespaceOfPrefix(node, prefix) === undefined) api.report(node, `${label(node)}: ${name}="${value}" uses the prefix "${prefix}", which is not declared (xmlns:${prefix}); Activiti rejects the deployment`);
      }
    },
    bad: [{ xml: '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><process id="p" isExecutable="true"><dataObject id="o" name="amount" itemSubjectRef="xsd:int"/></process></definitions>', ids: ['o'] }],
    good: [{ body: '<dataObject id="o" name="amount" itemSubjectRef="xsd:int"/>' }],
  }),
  defineRule({
    id: 'duplicate-element-id',
    tag: 'X',
    severity: 'error',
    title: 'Two elements have the same id',
    why: 'bpmn-moddle keeps the first element of an id and drops the later ones when it reads the file, so saving the file would lose them silently. Ids must be unique and are NCNames.',
    evidence: ['ADR 0003 guarantee 4', 'verify.ts DUPLICATE_ID'],
    howToFix: 'Give the second element its own id in the XML view (the dropped element is not in the diagram any more; reopen the original file to see it).',
    check: onDefinitions((_definitions, api) => {
      for (const dropped of api.ctx.duplicateIds ?? []) if (dropped.tag !== 'process') api.report(dropped.id, `A <${dropped.tag}> with the id "${dropped.id}" was dropped: the id is used twice`);
    }),
    bad: [{ body: '<task id="t"/><task id="t"/>', ids: ['t'] }],
    good: [{ body: '<task id="t"/><task id="u"/>' }],
  }),
];
