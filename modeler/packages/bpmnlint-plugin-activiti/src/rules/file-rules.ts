/** Rules over whole files: DMN files, sidecars, unreadable documents. They run in `lintProject()`, not inside bpmnlint. */
import { DOCS_BASE, defineRule, type RuleDef } from '../define';
import type { DmnFileInfo, Problem } from '../types';

const noop = (): void => undefined;
const R1 = 'docs/user-guide/dmn-conventions.md';

export const fileRules: RuleDef[] = [
  defineRule({
    id: 'bpmn-unreadable',
    tag: 'X',
    severity: 'error',
    target: 'file',
    title: 'A BPMN file is not well-formed XML',
    why: 'The modeler cannot open it and Activiti rejects the deployment. The message is the parser\'s.',
    evidence: ['R1 §2.1'],
    howToFix: 'Open the file as text, fix the XML and reopen it.',
    check: noop,
    bad: [{ files: { 'processes/a.bpmn20.xml': '<definitions><process' }, ids: ['processes/a.bpmn20.xml'] }],
    good: [{ files: { 'processes/a.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>' } }],
  }),
  defineRule({
    id: 'extensions-unreadable',
    tag: 'X',
    severity: 'error',
    target: 'file',
    title: 'An extensions JSON file cannot be read',
    why: 'The runtime reads `<name>-extensions.json` with Jackson; a file it cannot read fails every process start with `Unable to read process extension` (R1 §6.2.4). The deployment does not notice.',
    evidence: ['R1 §6.2.4'],
    howToFix: 'Fix the JSON in the extensions view of the process.',
    check: noop,
    serverKeys: ['extensions-json'],
    bad: [{ files: { 'processes/a.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>', 'processes/a-extensions.json': '{ "extensions": ' }, ids: ['processes/a-extensions.json'] }],
    good: [{ files: { 'processes/a.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>', 'processes/a-extensions.json': '{ "id": "a", "extensions": { "p": { "properties": {}, "mappings": {}, "constants": {} } } }' } }],
  }),
  defineRule({
    id: 'extensions-orphan-file',
    tag: 'X',
    severity: 'warn',
    target: 'file',
    title: 'An extensions file has no process file next to it',
    why: 'Activiti reads `<name>-extensions.json` only for the process deployed from `<name>.bpmn20.xml` in the same deployment; a sidecar on its own is never used.',
    evidence: ['R1 §6.2.1'],
    howToFix: 'Rename the file after its process, or delete it.',
    check: noop,
    bad: [{ files: { 'processes/ghost-extensions.json': '{ "id": "g", "extensions": {} }' }, ids: ['processes/ghost-extensions.json'] }],
    good: [{ files: { 'processes/a.bpmn20.xml': '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>', 'processes/a-extensions.json': '{ "id": "a", "extensions": {} }' } }],
  }),
  defineRule({
    id: 'dmn-unsupported-on-operaton',
    tag: 'L29',
    severity: 'error',
    target: 'file',
    title: 'A DMN construct only the KIE engine can evaluate (business knowledge model, boxed context, invocation, ...)',
    why: 'The default evaluator (Operaton) runs decision tables and literal expressions. Business knowledge models, boxed contexts, invocations, relations, functions and decision services need `activiti.dmn.engine=kie`; on Operaton the connector fails with a clear error naming the decision.',
    evidence: [R1, 'ADR 0004'],
    howToFix: 'Rewrite the decision as a decision table or literal expression, or select the KIE profile (`dmnProfile: "kie"`) and add `activiti-dmn-connector-kie` to the application.',
    check: noop,
    bad: [{ files: { 'processes/k.dmn': dmnSample('<context id="ctx"><contextEntry><literalExpression><text>1</text></literalExpression></contextEntry></context>', 'd1') }, ids: ['d1'] }],
    good: [
      { files: { 'processes/k.dmn': dmnSample('<literalExpression id="lit"><text>1</text></literalExpression>', 'd1') } },
    ],
  }),
  defineRule({
    id: 'dmn-output-without-name',
    tag: 'L33',
    severity: 'error',
    target: 'file',
    title: 'A decision table output column has no name',
    why: 'The connector hands a column value to the process under the column\'s `name`; a column without one fails the decision with `output column ... has no name` (ADR 0004).',
    evidence: [R1, 'ADR 0004'],
    howToFix: 'Give every output column a name in the decision table editor.',
    check: noop,
    bad: [{ files: { 'processes/t.dmn': dmnSample('<decisionTable id="t" hitPolicy="UNIQUE"><input id="i"><inputExpression typeRef="number"><text>x</text></inputExpression></input><output id="o" typeRef="string"/></decisionTable>', 'd1') }, ids: ['o'] }],
    good: [{ files: { 'processes/t.dmn': dmnSample('<decisionTable id="t" hitPolicy="UNIQUE"><input id="i"><inputExpression typeRef="number"><text>x</text></inputExpression></input><output id="o" name="grade" typeRef="string"/></decisionTable>', 'd1') } }],
  }),
  defineRule({
    id: 'dmn-legacy-version',
    tag: 'X',
    severity: 'warn',
    target: 'file',
    title: 'A DMN 1.1 or 1.2 file',
    why: 'Both engines load older DMN, but dmn-js 18 and the KIE engine are written against 1.3. The modeler migrates the file when it opens it (`@bpmn-io/dmn-migrate`) and writes 1.3 on save.',
    evidence: [R1, 'FEATURE_MATRIX DM9'],
    howToFix: 'Open the file in the DMN editor and save it.',
    check: noop,
    bad: [{ files: { 'processes/old.dmn': '<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd" id="old" name="old" namespace="urn:old"><decision id="d1" name="d1"><decisionTable id="t"><input id="i"><inputExpression><text>x</text></inputExpression></input><output id="o" name="y"/></decisionTable></decision></definitions>' }, ids: ['processes/old.dmn'] }],
    good: [{ files: { 'processes/t.dmn': dmnSample('<literalExpression id="lit"><text>1</text></literalExpression>', 'd1') } }],
  }),
  defineRule({
    id: 'dmn-unreadable',
    tag: 'X',
    severity: 'error',
    target: 'file',
    title: 'A DMN file is not a DMN definitions document',
    why: 'The decision task cannot find a decision in it and the connector fails when the task runs.',
    evidence: [R1],
    howToFix: 'Fix the XML or recreate the file in the DMN editor.',
    check: noop,
    bad: [{ files: { 'processes/bad.dmn': '<oops>' }, ids: ['processes/bad.dmn'] }],
    good: [{ files: { 'processes/t.dmn': dmnSample('<literalExpression id="lit"><text>1</text></literalExpression>', 'd1') } }],
  }),
];

/** A DMN 1.3 document with one decision holding `body`. */
export function dmnSample(body: string, decisionId: string): string {
  return `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="${decisionId}" name="${decisionId}"><variable id="${decisionId}_v" name="${decisionId}" typeRef="string"/>${body}</decision></definitions>`;
}

const problem = (file: DmnFileInfo, rule: string, severity: Problem['severity'], message: string, elementId?: string): Problem => ({
  id: `${file.path}|activiti/${rule}|${elementId ?? ''}|1`,
  path: file.path,
  ...(elementId ? { elementId } : {}),
  rule: `activiti/${rule}`,
  severity,
  message,
  source: 'client',
  documentationUrl: `${DOCS_BASE}${rule}.md`,
});

/** Runs the DMN rules over a scanned file. */
export function checkDmnFile(file: DmnFileInfo, options: { dmnProfile: 'operaton' | 'kie' }): Problem[] {
  const out: Problem[] = [];
  if (file.version === undefined && file.decisions.length === 0) {
    out.push(problem(file, 'dmn-unreadable', 'error', `${file.baseName}.dmn is not a DMN definitions document`));
    return out;
  }
  if (file.version === '1.1' || file.version === '1.2') out.push(problem(file, 'dmn-legacy-version', 'warning', `${file.baseName}.dmn is DMN ${file.version}; open and save it in the modeler to migrate it to 1.3`));
  for (const decision of file.decisions) {
    decision.outputs.forEach((output, i) => {
      if (!output.name?.trim()) out.push(problem(file, 'dmn-output-without-name', 'error', `Output column ${i + 1} of decision ${decision.id} has no name: its value would not reach the process [L33]`, output.id ?? decision.id));
    });
  }
  if (options.dmnProfile === 'operaton') {
    for (const item of file.kieOnly) {
      out.push(problem(file, 'dmn-unsupported-on-operaton', 'error', `${item.element}${item.id ? ` ${item.id}` : ''} needs the KIE engine; the default evaluator (Operaton) cannot run it [L29]`, item.decision ?? item.id));
    }
  }
  return out;
}
