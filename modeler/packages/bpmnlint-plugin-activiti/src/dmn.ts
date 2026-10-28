/** Reads the parts of a DMN file the lint rules need (L23, L29, L33, L37). Version agnostic: names are compared without prefixes. */
import { basenameOf } from './paths';
import type { DecisionInfo, DmnFileInfo } from './types';
import { childrenNamed, descendants, firstChild, parseXmlLite, type XmlNode } from './xml-lite';

const VERSIONS: Array<[RegExp, DmnFileInfo['version']]> = [
  [/DMN\/20151101\//, '1.1'],
  [/DMN\/20180521\/MODEL/, '1.2'],
  [/DMN\/20191111\/MODEL/, '1.3'],
  [/DMN\/20211108\/MODEL/, '1.4'],
  [/DMN\/20230324\/MODEL/, '1.5'],
];

/** Elements of boxed expressions and the business knowledge that only the KIE engine evaluates (docs/user-guide/dmn-conventions.md). */
export const KIE_ONLY_ELEMENTS = [
  'businessKnowledgeModel', 'decisionService', 'context', 'invocation', 'list', 'relation', 'functionDefinition', 'conditional', 'for', 'some', 'every', 'filter',
] as const;

const NAME = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

function decisionInfo(decision: XmlNode): DecisionInfo {
  const table = firstChild(decision, 'decisionTable');
  const inputs: string[] = [];
  const complexInputs: string[] = [];
  for (const input of table ? childrenNamed(table, 'input') : []) {
    const expression = firstChild(input, 'inputExpression');
    const text = (firstChild(expression ?? input, 'text')?.text ?? '').trim();
    if (!text) continue;
    if (NAME.test(text)) inputs.push(text.split('.')[0]!);
    else complexInputs.push(text);
  }
  const requiredDecisions: string[] = [];
  const requiredInputs: string[] = [];
  for (const requirement of childrenNamed(decision, 'informationRequirement')) {
    const decisionRef = firstChild(requirement, 'requiredDecision')?.attrs['href'];
    const inputRef = firstChild(requirement, 'requiredInput')?.attrs['href'];
    if (decisionRef) requiredDecisions.push(decisionRef.replace(/^#/, ''));
    if (inputRef) requiredInputs.push(inputRef.replace(/^#/, ''));
  }
  return {
    id: decision.attrs['id'] ?? '',
    ...(decision.attrs['name'] ? { name: decision.attrs['name'] } : {}),
    inputs: [...new Set(inputs)],
    complexInputs,
    requiredDecisions,
    requiredInputs,
    outputs: (table ? childrenNamed(table, 'output') : []).map((o) => ({
      ...(o.attrs['id'] ? { id: o.attrs['id'] } : {}),
      ...(o.attrs['name'] ? { name: o.attrs['name'] } : {}),
      ...(o.attrs['typeRef'] ? { type: o.attrs['typeRef'] } : {}),
    })),
    ...(table ? { hitPolicy: (table.attrs['hitPolicy'] ?? 'UNIQUE').toUpperCase() } : {}),
    ...(table?.attrs['aggregation'] ? { aggregation: table.attrs['aggregation'].toUpperCase() } : {}),
  };
}

export function scanDmn(path: string, text: string): DmnFileInfo {
  const root = parseXmlLite(text);
  const info: DmnFileInfo = { path, baseName: basenameOf(path).replace(/\.dmn$/, ''), decisions: [], inputData: {}, kieOnly: [] };
  if (!root || root.local !== 'definitions') return info;
  const ns = root.attrs['xmlns'] ?? root.attrs[`xmlns:${root.name.includes(':') ? root.name.split(':')[0] : 'dmn'}`] ?? '';
  info.version = VERSIONS.find(([re]) => re.test(ns))?.[1];
  if (root.attrs['name']) info.name = root.attrs['name'];
  for (const node of descendants(root)) {
    if (node.local === 'inputData' && node.attrs['id']) info.inputData[node.attrs['id']] = node.attrs['name'] ?? node.attrs['id'];
    if (node.local === 'decision') info.decisions.push(decisionInfo(node));
  }
  const decisionOf = (node: XmlNode): string | undefined => {
    for (const d of childrenNamed(root, 'decision')) for (const x of descendants(d)) if (x === node) return d.attrs['id'];
    return undefined;
  };
  for (const node of descendants(root)) {
    if ((KIE_ONLY_ELEMENTS as readonly string[]).includes(node.local)) {
      const decision = decisionOf(node);
      info.kieOnly.push({ element: node.local, ...(node.attrs['id'] ? { id: node.attrs['id'] } : {}), ...(decision ? { decision } : {}) });
    }
  }
  return info;
}

/** The input variable names a decision needs from the process: its own table inputs, those of required decisions, and required input data. */
export function requiredInputNames(file: DmnFileInfo, decisionId: string): string[] {
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const decision = file.decisions.find((d) => d.id === id);
    if (!decision) return;
    for (const n of decision.inputs) names.add(n);
    for (const ref of decision.requiredInputs) names.add(file.inputData[ref] ?? ref);
    for (const required of decision.requiredDecisions) visit(required);
  };
  visit(decisionId);
  // a decision's own inputs may be fed by required decisions: those names are not process inputs
  for (const id of seen) {
    const decision = file.decisions.find((d) => d.id === id);
    if (decision && id !== decisionId) names.delete(decision.name ?? decision.id);
  }
  return [...names];
}

/** The file a decision task's `_activiti_dmn_table_` value resolves to: a decision id, a file base name or a definitions name (ADR 0004). */
export function resolveDecision(files: readonly DmnFileInfo[], value: string): { file: DmnFileInfo; decision?: DecisionInfo } | undefined {
  for (const file of files) {
    const decision = file.decisions.find((d) => d.id === value);
    if (decision) return { file, decision };
  }
  for (const file of files) {
    if (file.baseName === value || file.name === value) {
      const sinks = file.decisions.filter((d) => !file.decisions.some((other) => other.requiredDecisions.includes(d.id)));
      return { file, ...(sinks.length === 1 ? { decision: sinks[0]! } : {}) };
    }
  }
  return undefined;
}
