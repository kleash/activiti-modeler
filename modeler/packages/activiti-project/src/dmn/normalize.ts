/**
 * The portable DMN normalizer (feature DM8, docs/user-guide/dmn-conventions.md). It runs on every save of a DMN file and turns what an
 * editor, or another tool, wrote into the form both engines evaluate identically (ADR 0004):
 *
 *  1. the DMN 1.3 namespace (a 1.2 file is moved, a 1.1 file has to be migrated first, see `@bpmn-io/dmn-migrate`);
 *  2. a `<variable>` on every decision, input data, business knowledge model and decision service, named like the element;
 *  3. FEEL type names (`integer`, `long`, `double` become `number`, `dateTime` becomes `date and time`, ...);
 *  4. `inputData` declared, and connected with a requirement, for every plain-name input of a decision table;
 *  5. `-` in an empty input entry;
 *  6. a name on every output column (a single output is named like its decision);
 *  7. an `id` on every rule (the connector reports matched rules by id);
 *  8. nothing of Camunda (the default target namespace of its editors, its attributes and namespace declarations).
 *
 * It is a pure function of the text: no editor state. It reports what it changed, it is idempotent (a second run changes nothing
 * and returns the text it was given), and a file that needs no change is returned as it is, byte for byte.
 */
import {
  DC_NS, DI_NS, DMNDI_NS_13, DMN_NS_13, LEGACY_DMN_NAMESPACES, NEWER_DMN_NAMESPACES, kid, kids, parseXml, plainVariable, serializeDocument, textOf,
} from './xml';

export interface NormalizeChange {
  /** What was done: `namespace`, `variable`, `type`, `input-data`, `entry`, `output-name`, `rule-id`, `definitions`, `foreign`. */
  code: string;
  /** The element the change is about (its id). */
  element?: string;
  message: string;
}

export interface NormalizeResult {
  /** The portable file; the input text itself when nothing changed. */
  xml: string;
  changed: boolean;
  changes: NormalizeChange[];
  /** Findings the normalizer cannot fix (the lint reports the same): the user has to act. */
  warnings: string[];
}

export interface NormalizeOptions {
  /** `definitions/@name` when the file has none (the file's base name). */
  definitionsName?: string;
}

/** FEEL type names by their other spellings. Names that are not listed (item definitions, `Any`) are left as they are. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: 'string',
  boolean: 'boolean',
  number: 'number',
  integer: 'number',
  long: 'number',
  double: 'number',
  float: 'number',
  decimal: 'number',
  date: 'date',
  time: 'time',
  datetime: 'date and time',
  'date and time': 'date and time',
  yearmonthduration: 'years and months duration',
  'years and months duration': 'years and months duration',
  daytimeduration: 'days and time duration',
  'days and time duration': 'days and time duration',
};

/** The FEEL name of a type reference: `integer` is `number`, `dateTime` is `date and time`; anything else is returned as it is. */
export function feelTypeName(typeRef: string): string {
  return TYPE_NAMES[typeRef.trim().toLowerCase()] ?? typeRef;
}

/** Namespaces of the foreign tools; the lint plugin quotes them by name, this package only recognises them. */
const FOREIGN_ATTRIBUTE_NAMESPACES = /camunda\.org|zeebe\.io/;
/** The `namespace` the editors of Camunda write by default (`<host>/schema/1.0/dmn`). */
const isForeignDefaultNamespace = (ns: string): boolean => FOREIGN_ATTRIBUTE_NAMESPACES.test(ns) && ns.endsWith('/1.0/dmn');

/** Elements that carry a `variable` (the name a requirement hands over). */
const WITH_VARIABLE = ['decision', 'inputData', 'businessKnowledgeModel', 'decisionService'];
/** Children a decision (or input data) has before its variable: the variable goes behind them. */
const BEFORE_VARIABLE = new Set(['description', 'extensionElements', 'question', 'allowedAnswers']);

function newerOrUnknown(root: Element): { warning?: string; stop: boolean } {
  const namespace = root.namespaceURI ?? '';
  if (namespace === DMN_NS_13) return { stop: false };
  const newer = NEWER_DMN_NAMESPACES.find((n) => n.namespace === namespace);
  if (newer) return { warning: `This is a DMN ${newer.version} file; the modeler reads it as DMN 1.3, and parts that 1.3 does not have are lost when dmn-js saves it`, stop: false };
  const legacy = LEGACY_DMN_NAMESPACES.find((n) => n.namespace === namespace);
  if (legacy) return { warning: `This is a DMN ${legacy.version} file: open it in the modeler to migrate it to DMN 1.3`, stop: true };
  return { warning: 'This is not a DMN definitions document (the root element is not definitions in a DMN namespace)', stop: true };
}

/**
 * Makes DMN text portable. Throws when the text is not well-formed XML; a well-formed document that is not DMN comes back unchanged
 * with a warning.
 */
export function normalizeDmn(xml: string, options: NormalizeOptions = {}): NormalizeResult {
  const changes: NormalizeChange[] = [];
  const warnings: string[] = [];
  let text = xml;

  // 1. a DMN 1.2 file only differs from 1.3 in its namespaces; the DMN 1.2 DMNDI namespace moved with them
  const legacy = LEGACY_DMN_NAMESPACES.find((n) => n.swap && text.includes(n.namespace));
  if (legacy?.swap) {
    text = text.split(legacy.namespace).join(legacy.swap).split('http://www.omg.org/spec/DMN/20180521/DMNDI/').join(DMNDI_NS_13);
    changes.push({ code: 'namespace', message: `moved from the DMN ${legacy.version} namespace to DMN 1.3` });
  }

  const doc = parseXml(text);
  const root = doc.documentElement;
  if (root.localName !== 'definitions') return { xml, changed: false, changes: [], warnings: ['This is not a DMN definitions document (the root element is not definitions)'] };
  const version = newerOrUnknown(root);
  if (version.warning) warnings.push(version.warning);
  if (version.stop) return { xml, changed: false, changes: [], warnings };

  const dmnNs = root.namespaceURI as string;
  const prefix = root.prefix;
  const create = (local: string): Element => doc.createElementNS(dmnNs, prefix ? `${prefix}:${local}` : local);

  const taken = new Set<string>();
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    if (id) taken.add(id);
  }
  const rootId = root.getAttribute('id');
  if (rootId) taken.add(rootId);
  const uniqueId = (wanted: string): string => {
    let id = wanted;
    for (let n = 2; taken.has(id); n += 1) id = `${wanted}_${n}`;
    taken.add(id);
    return id;
  };

  const report = (code: string, message: string, element?: string): void => void changes.push({ code, message, ...(element ? { element } : {}) });

  normalizeDefinitions(root, options, report, uniqueId);
  removeForeignAttributes(root, report);
  normalizeTypes(root, report);

  const drgElements = kids(root).filter((e) => WITH_VARIABLE.includes(e.localName));
  for (const element of drgElements) ensureVariable(element, create, report);

  const decisions = kids(root, 'decision');
  const context: Context = { doc, root, create, report, uniqueId, warnings };
  for (const decision of decisions) normalizeDecisionTable(decision, context);
  for (const decision of decisions) declareInputs(decision, context);

  if (changes.length === 0) return { xml, changed: false, changes, warnings };
  const declaration = /^\s*(<\?xml[^>]*\?>)/.exec(xml)?.[1];
  return { xml: serializeDocument(doc, declaration), changed: true, changes, warnings };
}

interface Context {
  doc: Document;
  root: Element;
  create(local: string): Element;
  report(code: string, message: string, element?: string): void;
  uniqueId(wanted: string): string;
  warnings: string[];
}

// --- definitions -------------------------------------------------------------------------------------------------------------

function normalizeDefinitions(root: Element, options: NormalizeOptions, report: Context['report'], uniqueId: Context['uniqueId']): void {
  if (!root.getAttribute('id')) {
    const id = uniqueId('Definitions_1');
    root.setAttribute('id', id);
    report('definitions', `definitions had no id; set to ${id}`);
  }
  const id = root.getAttribute('id') as string;
  if (!root.getAttribute('name') && (options.definitionsName ?? '') !== '') {
    root.setAttribute('name', options.definitionsName as string);
    report('definitions', `definitions had no name; set to "${options.definitionsName}"`);
  }
  const ns = root.getAttribute('namespace');
  if (!ns || isForeignDefaultNamespace(ns)) {
    root.setAttribute('namespace', `http://activiti.org/schema/1.0/dmn/${id}`);
    report('definitions', ns ? `namespace ${ns} is another tool's default; set to http://activiti.org/schema/1.0/dmn/${id}` : `definitions had no namespace; set to http://activiti.org/schema/1.0/dmn/${id}`);
  }
}

/** Attributes of Camunda and Zeebe namespaces (and the modeler marker Camunda Modeler adds) mean nothing to Activiti: ADR 0001. */
function removeForeignAttributes(root: Element, report: Context['report']): void {
  const all = (): Element[] => [root, ...Array.from(root.getElementsByTagName('*'))];
  for (const el of all()) {
    for (const attribute of Array.from(el.attributes)) {
      if (!attribute.namespaceURI || !FOREIGN_ATTRIBUTE_NAMESPACES.test(attribute.namespaceURI)) continue;
      el.removeAttributeNode(attribute);
      report('foreign', `removed ${attribute.name} (${el.getAttribute('id') ?? el.localName}): it means nothing to Activiti`, el.getAttribute('id') ?? undefined);
    }
  }
  // a namespace declaration goes with its last use
  for (const attribute of Array.from(root.attributes)) {
    if (!attribute.name.startsWith('xmlns:') || !FOREIGN_ATTRIBUTE_NAMESPACES.test(attribute.value)) continue;
    const prefix = attribute.name.slice('xmlns:'.length);
    const used = all().some((e) => e.prefix === prefix || Array.from(e.attributes).some((a) => a.prefix === prefix));
    if (used) continue;
    root.removeAttributeNode(attribute);
    report('foreign', `removed the namespace declaration ${attribute.name}`);
  }
}

// --- types -----------------------------------------------------------------------------------------------------------------------

function normalizeTypes(root: Element, report: Context['report']): void {
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const typeRef = el.getAttribute('typeRef');
    if (typeRef === null) continue;
    const name = feelTypeName(typeRef);
    if (name !== typeRef) {
      el.setAttribute('typeRef', name);
      report('type', `${el.localName} ${el.getAttribute('id') ?? ''}: type ${typeRef} is written ${name}`.replace('  ', ' '), el.getAttribute('id') ?? undefined);
    }
  }
}

// --- variables -----------------------------------------------------------------------------------------------------------------

function ensureVariable(element: Element, create: Context['create'], report: Context['report']): void {
  const id = element.getAttribute('id') ?? '';
  let name = element.getAttribute('name');
  if (!name) {
    if (element.localName === 'decision' && id) {
      element.setAttribute('name', id);
      report('variable', `decision ${id} had no name; set to its id`, id);
      name = id;
    } else {
      return;
    }
  }
  const existing = kid(element, 'variable');
  if (existing) {
    if (existing.getAttribute('name') !== name) {
      const was = existing.getAttribute('name');
      existing.setAttribute('name', name);
      report('variable', `${element.localName} ${id}: variable ${was === null ? 'had no name' : `was named ${was}`}; set to ${name}`, id);
    }
    return;
  }
  const variable = create('variable');
  if (id) variable.setAttribute('id', `${id}_variable`);
  variable.setAttribute('name', name);
  let anchor: Element | undefined;
  for (const child of kids(element)) if (BEFORE_VARIABLE.has(child.localName)) anchor = child;
  if (anchor) anchor.parentNode?.insertBefore(variable, anchor.nextSibling);
  else element.insertBefore(variable, element.firstChild);
  report('variable', `${element.localName} ${id}: added <variable name="${name}">`, id);
}

const variableNameOf = (decision: Element): string => kid(decision, 'variable')?.getAttribute('name') ?? decision.getAttribute('name') ?? decision.getAttribute('id') ?? '';

// --- decision tables -------------------------------------------------------------------------------------------------------------

function normalizeDecisionTable(decision: Element, ctx: Context): void {
  const table = kid(decision, 'decisionTable');
  if (!table) return;
  const decisionId = decision.getAttribute('id') ?? '';

  // output names: the connector hands a column value to the process under the column's name
  const outputs = kids(table, 'output');
  const named = new Set(outputs.map((o) => o.getAttribute('name')).filter((n): n is string => !!n));
  outputs.forEach((output, index) => {
    if (output.getAttribute('name')) return;
    let name = outputs.length === 1 ? variableNameOf(decision) : slug(output.getAttribute('label') ?? '') || `output${index + 1}`;
    for (let n = 2; named.has(name); n += 1) name = `${name}_${n}`;
    named.add(name);
    output.setAttribute('name', name);
    ctx.report('output-name', `decision ${decisionId}: output column ${index + 1} had no name; set to ${name}`, output.getAttribute('id') ?? decisionId);
  });

  // an empty input entry reads as "any" on KIE only when it says so
  const rules = kids(table, 'rule');
  rules.forEach((rule, ruleIndex) => {
    if (!rule.getAttribute('id')) {
      const id = ctx.uniqueId(`${decisionId}_rule${ruleIndex + 1}`);
      rule.setAttribute('id', id);
      ctx.report('rule-id', `decision ${decisionId}: rule ${ruleIndex + 1} had no id; set to ${id}`, id);
    }
    kids(rule, 'inputEntry').forEach((entry, column) => {
      const content = kid(entry, 'text');
      if ((textOf(entry) ?? '') !== '') return;
      if (content) {
        while (content.firstChild) content.removeChild(content.firstChild);
        content.appendChild(ctx.doc.createTextNode('-'));
      } else {
        const created = ctx.create('text');
        created.appendChild(ctx.doc.createTextNode('-'));
        entry.appendChild(created);
      }
      ctx.report('entry', `decision ${decisionId}: rule ${rule.getAttribute('id')}, input ${column + 1} was empty; written -`, rule.getAttribute('id') ?? undefined);
    });
  });

  const hitPolicy = (table.getAttribute('hitPolicy') ?? 'UNIQUE').toUpperCase();
  if (hitPolicy === 'PRIORITY' || hitPolicy === 'OUTPUT ORDER') {
    const listed = outputs.map((o) => textOf(kid(o, 'outputValues'))).filter((t) => t);
    if (listed.length === 0) ctx.warnings.push(`decision ${decisionId}: ${hitPolicy} needs the allowed output values (their order is the priority); no output column has any`);
    for (const value of listed) if (!/^\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*(?:,\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*)*$/.test(value as string)) ctx.warnings.push(`decision ${decisionId}: the output values ${value} are not a comma separated list of string, number or boolean literals`);
  }
}

const slug = (label: string): string => {
  const words = label.trim().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const joined = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  return /^[\p{L}_]/u.test(joined) ? joined : `_${joined}`;
};

// --- inputs ----------------------------------------------------------------------------------------------------------------------

/** Names a decision already receives: its required input data and the variables of its required decisions. */
function providedNames(decision: Element, root: Element): Set<string> {
  const byId = new Map(kids(root).filter((e) => e.getAttribute('id')).map((e) => [e.getAttribute('id') as string, e]));
  const provided = new Set<string>();
  for (const requirement of kids(decision, 'informationRequirement')) {
    const href = (kid(requirement, 'requiredInput') ?? kid(requirement, 'requiredDecision'))?.getAttribute('href')?.replace(/^#/, '');
    const target = href ? byId.get(href) : undefined;
    if (!target) continue;
    provided.add(target.getAttribute('name') ?? href!);
    const variable = kid(target, 'variable')?.getAttribute('name');
    if (variable) provided.add(variable);
  }
  return provided;
}

/** Declares the inputs a decision table reads by name, so that KIE can compile it and the DRD shows where they come from. */
function declareInputs(decision: Element, ctx: Context): void {
  const table = kid(decision, 'decisionTable');
  if (!table) return;
  const decisionId = decision.getAttribute('id') ?? '';
  const provided = providedNames(decision, ctx.root);
  const wanted: Array<{ name: string; typeRef?: string }> = [];
  kids(table, 'input').forEach((input, index) => {
    const expression = kid(input, 'inputExpression');
    const expressionText = textOf(expression);
    if (expressionText === undefined || expressionText === '') {
      ctx.warnings.push(`decision ${decisionId}: input ${index + 1} has no input expression, so it reads nothing`);
      return;
    }
    const name = plainVariable(expressionText);
    if (name === undefined || provided.has(name) || wanted.some((w) => w.name === name)) return;
    const typeRef = expression?.getAttribute('typeRef');
    wanted.push({ name, ...(typeRef ? { typeRef } : {}) });
  });

  for (const { name, typeRef } of wanted) {
    const decisions = kids(ctx.root, 'decision');
    const sameNamedDecision = decisions.find((d) => d !== decision && variableNameOf(d) === name);
    const target = sameNamedDecision ?? kids(ctx.root, 'inputData').find((i) => i.getAttribute('name') === name);
    let created = false;
    let targetId = target?.getAttribute('id') ?? '';
    let reference: 'requiredDecision' | 'requiredInput' = sameNamedDecision ? 'requiredDecision' : 'requiredInput';
    if (!target || !targetId) {
      const inputData = ctx.create('inputData');
      targetId = ctx.uniqueId(`InputData_${name}`);
      inputData.setAttribute('id', targetId);
      inputData.setAttribute('name', name);
      const variable = ctx.create('variable');
      variable.setAttribute('id', ctx.uniqueId(`${targetId}_variable`));
      variable.setAttribute('name', name);
      if (typeRef) variable.setAttribute('typeRef', feelTypeName(typeRef));
      inputData.appendChild(variable);
      const firstDecision = decisions[0] as Element;
      firstDecision.parentNode?.insertBefore(inputData, firstDecision);
      reference = 'requiredInput';
      created = true;
      ctx.report('input-data', `decision ${decisionId}: reads ${name}, which no input data declared; added inputData ${targetId}`, targetId);
    }
    const requirement = ctx.create('informationRequirement');
    const requirementId = ctx.uniqueId(`${decisionId}_req_${targetId}`);
    requirement.setAttribute('id', requirementId);
    const ref = ctx.create(reference);
    ref.setAttribute('href', `#${targetId}`);
    requirement.appendChild(ref);
    insertRequirement(decision, requirement);
    if (!created) ctx.report('input-data', `decision ${decisionId}: reads ${name}; connected it to ${targetId}`, requirementId);
    addDiagram(ctx, { decisionId, targetId, requirementId, createdShape: created });
  }
}

const REQUIREMENTS = new Set(['informationRequirement', 'knowledgeRequirement', 'authorityRequirement']);

function insertRequirement(decision: Element, requirement: Element): void {
  const children = kids(decision);
  const lastRequirement = [...children].reverse().find((c) => REQUIREMENTS.has(c.localName));
  if (lastRequirement) {
    decision.insertBefore(requirement, lastRequirement.nextSibling);
    return;
  }
  const variable = kid(decision, 'variable');
  const anchor = variable ?? [...children].reverse().find((c) => BEFORE_VARIABLE.has(c.localName));
  if (anchor) decision.insertBefore(requirement, anchor.nextSibling);
  else decision.insertBefore(requirement, decision.firstChild);
}

// --- diagram ---------------------------------------------------------------------------------------------------------------------

/** Puts a new input data and its requirement on the diagram (below the decision that reads it), when the file has a diagram. */
function addDiagram(ctx: Context, added: { decisionId: string; targetId: string; requirementId: string; createdShape: boolean }): void {
  const dmndi = Array.from(ctx.root.childNodes).find((n) => n.nodeType === 1 && (n as Element).localName === 'DMNDI') as Element | undefined;
  const diagram = dmndi ? kid(dmndi, 'DMNDiagram') : undefined;
  if (!dmndi || !diagram) return;
  const diNs = dmndi.namespaceURI as string;
  const diPrefix = dmndi.prefix;
  // dmn-js declares `dc` and `di` only when the diagram has the shapes and edges that use them
  const declare = (namespace: string, wanted: string): string => {
    const known = ctx.root.lookupPrefix(namespace);
    if (known) return known;
    ctx.root.setAttribute(`xmlns:${wanted}`, namespace);
    return wanted;
  };
  const dcPrefix = declare(DC_NS, 'dc');
  const diDiPrefix = declare(DI_NS, 'di');
  const shapes = kids(diagram, 'DMNShape');
  const shapeOf = (ref: string): Element | undefined => shapes.find((s) => s.getAttribute('dmnElementRef') === ref);
  const boundsOf = (shape: Element | undefined): { x: number; y: number; width: number; height: number } | undefined => {
    const bounds = shape ? kids(shape).find((c) => c.localName === 'Bounds') : undefined;
    if (!bounds) return undefined;
    const read = (name: string): number => Number(bounds.getAttribute(name) ?? 0);
    return { x: read('x'), y: read('y'), width: read('width'), height: read('height') };
  };
  const decisionBounds = boundsOf(shapeOf(added.decisionId));
  if (!decisionBounds) return;
  const make = (ns: string, prefix: string | null, local: string): Element => ctx.doc.createElementNS(ns, prefix ? `${prefix}:${local}` : local);
  const dc = (local: string): Element => make(DC_NS, dcPrefix, local);
  const di = (local: string): Element => make(DI_NS, diDiPrefix, local);
  const dmndiElement = (local: string): Element => make(diNs, diPrefix, local);

  let target = boundsOf(shapeOf(added.targetId));
  if (!target && added.createdShape) {
    const below = shapes.filter((s) => s.getAttribute('dmnElementRef')?.startsWith('InputData_')).length;
    target = { x: decisionBounds.x + (below % 4) * 150, y: decisionBounds.y + decisionBounds.height + 110 + Math.floor(below / 4) * 70, width: 125, height: 45 };
    const shape = dmndiElement('DMNShape');
    shape.setAttribute('id', ctx.uniqueId(`DMNShape_${added.targetId}`));
    shape.setAttribute('dmnElementRef', added.targetId);
    const bounds = dc('Bounds');
    bounds.setAttribute('height', String(target.height));
    bounds.setAttribute('width', String(target.width));
    bounds.setAttribute('x', String(target.x));
    bounds.setAttribute('y', String(target.y));
    shape.appendChild(bounds);
    const lastShape = shapes[shapes.length - 1];
    if (lastShape) diagram.insertBefore(shape, lastShape.nextSibling);
    else diagram.insertBefore(shape, diagram.firstChild);
    shapes.push(shape);
  }
  if (!target) return;
  const edge = dmndiElement('DMNEdge');
  edge.setAttribute('id', ctx.uniqueId(`DMNEdge_${added.requirementId}`));
  edge.setAttribute('dmnElementRef', added.requirementId);
  const point = (x: number, y: number): Element => {
    const waypoint = di('waypoint');
    waypoint.setAttribute('x', String(Math.round(x)));
    waypoint.setAttribute('y', String(Math.round(y)));
    return waypoint;
  };
  edge.appendChild(point(target.x + target.width / 2, target.y));
  edge.appendChild(point(decisionBounds.x + decisionBounds.width / 2, decisionBounds.y + decisionBounds.height));
  diagram.appendChild(edge);
}
