import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { describeDmn, resolveDecisionIn } from './describe';
import { diffDmn } from './diff';
import { feelTypeName, normalizeDmn } from './normalize';
import { detectDmnVersion } from './xml';

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../corpus');
function seeds(): Array<{ id: string; xml: string }> {
  const out: Array<{ id: string; xml: string }> = [];
  for (const project of readdirSync(corpus)) {
    const dir = join(corpus, project, 'seed', 'processes');
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.dmn'));
    } catch {
      continue;
    }
    for (const f of files) out.push({ id: `${project}/${f}`, xml: readFileSync(join(dir, f), 'utf8') });
  }
  return out;
}

/** What dmn-js 18 writes for a decision table the user just made: no variables, an empty entry, a Camunda namespace. */
const RAW = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_1" name="DRD" namespace="http://camunda.org/schema/1.0/dmn" modeler:executionPlatform="Camunda Platform">
  <decision id="Decision_1" name="Risk">
    <decisionTable id="DecisionTable_1">
      <input id="Input_1" label="Age">
        <inputExpression id="InputExpression_1" typeRef="integer">
          <text>age</text>
        </inputExpression>
      </input>
      <output id="Output_1" typeRef="string" />
      <rule id="Rule_1">
        <inputEntry id="UnaryTests_1"><text></text></inputEntry>
        <outputEntry id="LiteralExpression_1"><text>"HIGH"</text></outputEntry>
      </rule>
      <rule>
        <inputEntry id="UnaryTests_2"><text>&lt; 21</text></inputEntry>
        <outputEntry id="LiteralExpression_2"><text>"LOW"</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="Decision_1">
        <dc:Bounds height="80" width="180" x="160" y="100" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;

describe('normalizeDmn', () => {
  it('leaves every hand-written seed of the corpus exactly as it is (they follow the portable conventions)', () => {
    const files = seeds();
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const { id, xml } of files) {
      const result = normalizeDmn(xml);
      expect(result.changes, id).toEqual([]);
      expect(result.xml, id).toBe(xml);
      expect(result.changed, id).toBe(false);
    }
  });

  it('makes a fresh dmn-js table portable and says what it changed', () => {
    const result = normalizeDmn(RAW, { definitionsName: 'risk' });
    expect(result.changed).toBe(true);
    const codes = result.changes.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['definitions', 'variable', 'type', 'output-name', 'entry', 'rule-id', 'input-data', 'foreign']));
    expect(result.xml).toContain('namespace="http://activiti.org/schema/1.0/dmn/Definitions_1"');
    expect(result.xml).not.toMatch(/camunda|modeler:/);
    // a variable named like the decision, FEEL type names, '-' for the empty entry, a named single output
    expect(result.xml).toContain('<variable id="Decision_1_variable" name="Risk" />');
    expect(result.xml).toContain('typeRef="number"');
    expect(result.xml).not.toContain('integer');
    expect(result.xml).toContain('<text>-</text>');
    expect(result.xml).toContain('<output id="Output_1" typeRef="string" name="Risk" />');
    // the second rule had no id: <decision id>_rule<n>
    expect(result.xml).toContain('<rule id="Decision_1_rule2">');
    // the input the table reads is declared, connected and drawn
    expect(result.xml).toContain('<inputData id="InputData_age" name="age">');
    expect(result.xml).toContain('<variable id="InputData_age_variable" name="age" typeRef="number" />');
    expect(result.xml).toContain('<requiredInput href="#InputData_age" />');
    expect(result.xml).toContain('dmnElementRef="InputData_age"');
    expect(result.xml).toContain('dmnElementRef="Decision_1_req_InputData_age"');
    // what it wrote is well-formed and describes the same decision
    const described = describeDmn(result.xml);
    expect(described.error).toBeUndefined();
    expect(described.decisions[0]?.inputs).toEqual([{ name: 'age', type: 'number', source: 'inputData' }]);
  });

  it('is idempotent: the result normalizes to itself with no change', () => {
    const once = normalizeDmn(RAW, { definitionsName: 'risk' });
    const twice = normalizeDmn(once.xml, { definitionsName: 'risk' });
    expect(twice.changes).toEqual([]);
    expect(twice.xml).toBe(once.xml);
  });

  it('corrects a variable whose name differs from the decision name (KIE cannot resolve it) and names an unnamed decision', () => {
    const xml = RAW.replace('<decision id="Decision_1" name="Risk">', '<decision id="Decision_1" name="Risk"><variable id="v" name="risk" typeRef="Any" />').replace('<decisionTable', '<decisionTable hitPolicy="FIRST"');
    const result = normalizeDmn(xml);
    expect(result.xml).toContain('<variable id="v" name="Risk" typeRef="Any" />');
    expect(normalizeDmn(RAW.replace(' name="Risk"', '')).xml).toContain('<decision id="Decision_1" name="Decision_1">');
  });

  it('connects an input that another decision provides instead of inventing input data', () => {
    const xml = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="d" namespace="urn:d">
  <decision id="a" name="risk"><variable id="a_v" name="risk" /><literalExpression id="l"><text>1</text></literalExpression></decision>
  <decision id="b" name="offer"><variable id="b_v" name="offer" />
    <decisionTable id="t"><input id="i"><inputExpression id="ie" typeRef="string"><text>risk</text></inputExpression></input><output id="o" name="offer" typeRef="string" /></decisionTable>
  </decision>
</definitions>`;
    const result = normalizeDmn(xml);
    expect(result.xml).toContain('<requiredDecision href="#a" />');
    expect(result.xml).not.toContain('<inputData');
    expect(normalizeDmn(result.xml).changes).toEqual([]);
  });

  it('numbers outputs of a multi-output table by their label and warns about PRIORITY without output values', () => {
    const xml = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="d" namespace="urn:d">
  <inputData id="x" name="x"><variable id="xv" name="x" typeRef="number" /></inputData>
  <decision id="a" name="a"><variable id="a_v" name="a" /><informationRequirement id="r"><requiredInput href="#x" /></informationRequirement>
    <decisionTable id="t" hitPolicy="PRIORITY"><input id="i"><inputExpression id="ie" typeRef="number"><text>x</text></inputExpression></input><output id="o1" label="Risk level" typeRef="string" /><output id="o2" typeRef="string" /></decisionTable>
  </decision>
</definitions>`;
    const result = normalizeDmn(xml);
    expect(result.xml).toContain('name="riskLevel"');
    expect(result.xml).toContain('name="output2"');
    expect(result.warnings.join('\n')).toContain('PRIORITY needs the allowed output values');
  });

  it('moves a DMN 1.2 file to the 1.3 namespace and refuses to guess for 1.1 and for non-DMN files', () => {
    const v12 = RAW.replace('https://www.omg.org/spec/DMN/20191111/MODEL/', 'http://www.omg.org/spec/DMN/20180521/MODEL/').replace('https://www.omg.org/spec/DMN/20191111/DMNDI/', 'http://www.omg.org/spec/DMN/20180521/DMNDI/');
    const moved = normalizeDmn(v12);
    expect(moved.xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
    expect(moved.changes[0]?.code).toBe('namespace');
    const legacy = readFileSync(join(corpus, 'N01-negative/models/legacy-discount.dmn'), 'utf8');
    const refused = normalizeDmn(legacy);
    expect(refused.changed).toBe(false);
    expect(refused.xml).toBe(legacy);
    expect(refused.warnings[0]).toContain('DMN 1.1');
    expect(normalizeDmn('<definitions/>').warnings[0]).toContain('not a DMN');
    expect(() => normalizeDmn('<definitions>')).toThrow(/not well-formed/);
  });

  it('writes FEEL type names', () => {
    expect(feelTypeName('integer')).toBe('number');
    expect(feelTypeName('Long')).toBe('number');
    expect(feelTypeName('double')).toBe('number');
    expect(feelTypeName('dateTime')).toBe('date and time');
    expect(feelTypeName('yearMonthDuration')).toBe('years and months duration');
    expect(feelTypeName('dayTimeDuration')).toBe('days and time duration');
    expect(feelTypeName('string')).toBe('string');
    expect(feelTypeName('Any')).toBe('Any');
    expect(feelTypeName('tCustomer')).toBe('tCustomer');
  });
});

describe('describeDmn', () => {
  const read = (project: string, file: string): string => readFileSync(join(corpus, project, 'seed/processes', file), 'utf8');

  it('describes the DRD of C17: kinds, requirements, the sink, the inputs a caller provides', () => {
    const d = describeDmn(read('C17-dmn-drd', 'loan-decision.dmn'));
    expect(d.version).toBe('1.3');
    expect(d.name).toBe('Loan decision');
    expect(d.decisions.map((x) => [x.id, x.kind, x.sink])).toEqual([['riskClass', 'table', false], ['maxLoan', 'literal', false], ['loanOffer', 'table', true]]);
    const offer = d.decisions.find((x) => x.id === 'loanOffer')!;
    expect(offer.requiredDecisions).toEqual(['riskClass', 'maxLoan']);
    expect(offer.inputs.map((i) => [i.name, i.type])).toEqual([['amount', 'number'], ['age', 'number'], ['country', 'string'], ['income', 'number']]);
    expect(d.decisions.find((x) => x.id === 'riskClass')!.outputs[0]?.allowedValues).toEqual(['"HIGH"', '"MEDIUM"', '"LOW"']);
    expect(resolveDecisionIn(d, 'loan-decision', 'loan-decision')?.id).toBe('loanOffer');
    expect(resolveDecisionIn(d, 'loan-decision', 'Loan decision')?.id).toBe('loanOffer');
    expect(resolveDecisionIn(d, 'loan-decision', 'maxLoan')?.id).toBe('maxLoan');
    expect(resolveDecisionIn(d, 'loan-decision', 'nothing')).toBeUndefined();
  });

  it('knows multi-result policies, rules and what only KIE runs', () => {
    const badges = describeDmn(read('C16-dmn-hit-policies', 'output-order-badges.dmn')).decisions[0]!;
    expect(badges).toMatchObject({ id: 'outputOrderBadges', hitPolicy: 'OUTPUT ORDER', multiResult: true });
    expect(badges.rules.length).toBeGreaterThan(1);
    expect(describeDmn(read('C16-dmn-hit-policies', 'collect-sum-points.dmn')).decisions[0]).toMatchObject({ aggregation: 'SUM', multiResult: false });
    const pricing = describeDmn(read('C17-dmn-drd-kie', 'pricing.dmn'));
    expect(pricing.kieOnly).toEqual(expect.arrayContaining(['businessKnowledgeModel discountRate', 'context finalPrice']));
    expect(describeDmn('<nope').error).toContain('not well-formed');
  });
});

describe('diffDmn', () => {
  const seed = readFileSync(join(corpus, 'C16-dmn-hit-policies/seed/processes/unique-grade.dmn'), 'utf8');

  it('finds no difference between a file and itself, whatever its diagram, ids of columns and cells, or attribute order are', () => {
    const generated = seed
      .replace(/<dmndi:DMNDI>[\s\S]*<\/dmndi:DMNDI>/, '')
      .replace(/id="uniqueGrade_input1"/, 'id="Input_9"')
      .replace(/ id="uniqueGrade_[a-z]+_in1"/g, ' id="UnaryTests_x"')
      .replace('<variable id="uniqueGrade_variable" name="uniqueGrade" />', '<variable name="uniqueGrade" typeRef="Any" id="v1" />');
    expect(diffDmn(seed, generated)).toEqual([]);
  });

  it('reports a different rule id, entry, hit policy, output name and type, a missing rule and an extra requirement', () => {
    const rule = /<rule id="(uniqueGrade_[a-zA-Z]+)">/.exec(seed)![1]!;
    const changed = seed
      .replace(`<rule id="${rule}">`, '<rule id="renamed">')
      .replace('hitPolicy="UNIQUE"', 'hitPolicy="FIRST"')
      .replace(/<output id="([^"]+)" name="grade" typeRef="string"/, '<output id="$1" name="mark" typeRef="number"');
    const out = diffDmn(seed, changed);
    expect(out.join('\n')).toContain(`/@id: expected "${rule}", generated "renamed"`);
    expect(diffDmn(seed, seed.replace(/<rule id="[^"]+">[\s\S]*?<\/rule>/, '')).join('\n')).toContain(`rule[${rule}]`);
    expect(out.join('\n')).toContain('@hitPolicy: expected "UNIQUE", generated "FIRST"');
    expect(out.join('\n')).toContain('@name: expected "grade", generated "mark"');
    expect(out.join('\n')).toContain('@typeRef: expected "string", generated "number"');
    expect(diffDmn(seed, seed.replace('<informationRequirement', '<informationRequirement id="extra"><requiredInput href="#nothing" /></informationRequirement><informationRequirement'))).not.toEqual([]);
  });

  it('treats the default hit policy and integer-vs-number type names as the same', () => {
    expect(diffDmn(seed, seed.replace(' hitPolicy="UNIQUE"', '').replace(/typeRef="number"/g, 'typeRef="integer"'))).toEqual([]);
  });

  it('detects the DMN version of a file', () => {
    expect(detectDmnVersion(seed)).toBe('1.3');
    expect(detectDmnVersion(readFileSync(join(corpus, 'N01-negative/models/legacy-discount.dmn'), 'utf8'))).toBe('1.1');
    expect(detectDmnVersion('<definitions/>')).toBeUndefined();
  });
});
