// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeDmn } from '@activiti-modeler/activiti-project';
import { beforeEach, describe, expect, it } from 'vitest';

import { installSvgPolyfills } from '../../packages/bpmn-js-activiti/test-support/jsdom-svg';
import { createDmnTestApi } from './dmnTestApi';

installSvgPolyfills();
// diagram-js measures text through a canvas in a few places; jsdom has none
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), '../../../corpus');
const seed = (project: string, file: string): string => readFileSync(join(corpus, project, 'seed/processes', file), 'utf8');

let refreshed = 0;
let api: ReturnType<typeof createDmnTestApi>;

beforeEach(() => {
  api?.reset();
  refreshed = 0;
  api = createDmnTestApi(async () => void (refreshed += 1));
});

const attrs = (xml: string, element: string, attribute: string): string[] => [...xml.matchAll(new RegExp(`<${element}\\b[^>]*?\\b${attribute}="([^"]*)"`, 'g'))].map((m) => m[1]!);

describe('the DMN part of the test API: dmn-js modeling commands, not XML text', () => {
  it('builds a decision table with a DRD around it: input data, hit policy, columns, allowed values, rules with their ids', async () => {
    await api.createDmn('grade', { id: 'Definitions_uniqueGrade' });
    await api.addInputData('grade', { id: 'InputData_score', name: 'score', typeRef: 'number' });
    await api.addDecisionTable('grade', {
      id: 'uniqueGrade',
      variableType: 'string',
      hitPolicy: 'PRIORITY',
      inputs: [{ label: 'Score', expression: 'score', typeRef: 'number' }],
      outputs: [{ name: 'grade', typeRef: 'string', allowedValues: ['"high"', '"low"'] }],
      rules: [
        { id: 'uniqueGrade_high', inputs: ['>= 80'], outputs: ['"high"'], annotation: 'top' },
        { id: 'uniqueGrade_low', inputs: ['< 80'], outputs: ['"low"'] },
      ],
    });
    await api.addRequirement('grade', 'InputData_score', 'uniqueGrade', 'information');
    const xml = await api.currentDmnXml('grade');
    expect(xml).toContain('id="Definitions_uniqueGrade" name="grade"');
    expect(xml).toMatch(/<decision id="uniqueGrade" name="uniqueGrade">\s*<variable id="[^"]+" name="uniqueGrade" typeRef="string" \/>/);
    expect(xml).toMatch(/<decisionTable id="[^"]+" hitPolicy="PRIORITY">/);
    expect(xml).toMatch(/<input id="[^"]+" label="Score">\s*<inputExpression id="[^"]+" typeRef="number">\s*<text>score<\/text>/);
    expect(xml).toMatch(/<output id="[^"]+" name="grade" typeRef="string">\s*<outputValues id="[^"]+">\s*<text>"high","low"<\/text>/);
    expect(attrs(xml, 'rule', 'id')).toEqual(['uniqueGrade_high', 'uniqueGrade_low']);
    expect(xml).toMatch(/<description>top<\/description>/);
    expect(xml).toMatch(/<requiredInput href="#InputData_score" \/>/);
    // a DRD shape for the decision and the input data, and an edge for the requirement
    expect(attrs(xml, 'dmndi:DMNShape', 'dmnElementRef')).toEqual(expect.arrayContaining(['uniqueGrade', 'InputData_score']));
    expect(attrs(xml, 'dmndi:DMNEdge', 'dmnElementRef')).toHaveLength(1);
    expect(refreshed).toBeGreaterThanOrEqual(4);
    // what it described is what the decision tester and the picker read
    const d = describeDmn(xml).decisions[0]!;
    expect(d).toMatchObject({ id: 'uniqueGrade', kind: 'table', hitPolicy: 'PRIORITY' });
    expect(d.inputs).toEqual([{ name: 'score', type: 'number', source: 'inputData' }]);
  });

  it('reproduces a hand-written seed of the corpus: the semantic diff is empty', async () => {
    await api.createDmn('unique-grade', { id: 'Definitions_uniqueGrade' });
    await api.addInputData('unique-grade', { id: 'InputData_score', name: 'score', typeRef: 'number' });
    await api.addDecisionTable('unique-grade', {
      id: 'uniqueGrade',
      variableType: 'string',
      hitPolicy: 'UNIQUE',
      inputs: [{ label: 'Score', expression: 'score', typeRef: 'number' }],
      outputs: [{ name: 'grade', typeRef: 'string' }],
      rules: [
        { id: 'uniqueGrade_low', inputs: ['< 50'], outputs: ['"low"'] },
        { id: 'uniqueGrade_mid', inputs: ['[50..80)'], outputs: ['"mid"'] },
        { id: 'uniqueGrade_high', inputs: ['>= 80'], outputs: ['"high"'] },
      ],
    });
    await api.addRequirement('unique-grade', 'InputData_score', 'uniqueGrade');
    const generated = await api.currentDmnXml('unique-grade');
    expect(api.diffDmn(seed('C16-dmn-hit-policies', 'unique-grade.dmn'), generated)).toEqual([]);
    // a different rule entry is found
    await api.renameDmnElement('unique-grade', 'uniqueGrade', { name: 'grading' });
    const changed = await api.currentDmnXml('unique-grade');
    expect(api.diffDmn(seed('C16-dmn-hit-policies', 'unique-grade.dmn'), changed).join('\n')).toContain('@name: expected "uniqueGrade", generated "grading"');
  });

  it('sets every hit policy and aggregator, and adds columns and rules to an existing table', async () => {
    await api.createDmn('policies');
    await api.addInputData('policies', { id: 'InputData_amount', name: 'amount', typeRef: 'number' });
    await api.addDecisionTable('policies', { id: 'pol', inputs: [{ expression: 'amount', typeRef: 'number' }], outputs: [{ name: 'flag', typeRef: 'string' }], rules: [] });
    const policies: Array<[string, string | undefined]> = [['UNIQUE', undefined], ['FIRST', undefined], ['PRIORITY', undefined], ['ANY', undefined], ['COLLECT', undefined], ['COLLECT', 'SUM'], ['COLLECT', 'MIN'], ['COLLECT', 'MAX'], ['COLLECT', 'COUNT'], ['RULE ORDER', undefined], ['OUTPUT ORDER', undefined]];
    for (const [policy, aggregation] of policies) {
      await api.setHitPolicy('policies', 'pol', policy, aggregation);
      const xml = await api.currentDmnXml('policies');
      const wanted = policy === 'UNIQUE' ? /<decisionTable id="[^"]+"(?: hitPolicy="UNIQUE")?>/ : new RegExp(`<decisionTable id="[^"]+" hitPolicy="${policy}"${aggregation ? ` aggregation="${aggregation}"` : '>'}`);
      expect(xml, `${policy} ${aggregation ?? ''}`).toMatch(wanted);
    }
    await api.addTableInput('policies', 'pol', { label: 'Region', expression: 'region', typeRef: 'string', allowedValues: ['"EU"', '"US"'] });
    await api.addTableOutput('policies', 'pol', { name: 'note', typeRef: 'string' });
    await api.addTableRule('policies', 'pol', { id: 'pol_big', inputs: ['> 1000', '"EU"'], outputs: ['"big"', '"check"'] });
    const xml = await api.currentDmnXml('policies');
    expect(attrs(xml, 'input', 'label')).toEqual(expect.arrayContaining(['Region']));
    expect(xml).toMatch(/<inputValues id="[^"]+">\s*<text>"EU","US"<\/text>/);
    expect(attrs(xml, 'output', 'name')).toEqual(['flag', 'note']);
    expect(xml).toMatch(/<rule id="pol_big">/);
    // a rule that does not fit the columns is refused with the numbers
    await expect(api.addTableRule('policies', 'pol', { id: 'pol_bad', inputs: ['1'], outputs: ['"x"', '"y"'] })).rejects.toThrow('rule pol_bad has 1 input and 2 output entries, the table has 2 and 2 columns');
  });

  it('builds literal expressions, business knowledge models, boxed contexts, knowledge sources and annotations, and checks the requirement rules', async () => {
    await api.createDmn('pricing', { id: 'Definitions_pricing' });
    await api.addInputData('pricing', { id: 'InputData_basePrice', name: 'basePrice', typeRef: 'number' });
    await api.addInputData('pricing', { id: 'InputData_loyaltyYears', name: 'loyaltyYears', typeRef: 'number' });
    await api.addLiteralDecision('pricing', { id: 'doubled', variableType: 'number', expression: 'basePrice * 2', expressionType: 'number' });
    await api.addBusinessKnowledgeModel('pricing', { id: 'discountRate', parameters: [{ name: 'years', typeRef: 'number' }], expression: 'if years >= 5 then 0.1 else 0', expressionType: 'number' });
    await api.addContextDecision('pricing', {
      id: 'finalPrice',
      variableType: 'number',
      entries: [{ name: 'rate', typeRef: 'number', invocation: { function: 'discountRate', bindings: [{ parameter: 'years', expression: 'loyaltyYears' }] } }, { expression: 'basePrice * (1 - rate)' }],
    });
    await api.addKnowledgeSource('pricing', { id: 'policy', name: 'Pricing policy' });
    await api.addTextAnnotation('pricing', { id: 'note', text: 'prices in euro' });
    const kinds = {
      information: await api.addRequirement('pricing', 'InputData_basePrice', 'finalPrice', 'information'),
      knowledge: await api.addRequirement('pricing', 'discountRate', 'finalPrice', 'knowledge'),
      authority: await api.addRequirement('pricing', 'policy', 'finalPrice', 'authority'),
      association: await api.addRequirement('pricing', 'note', 'finalPrice'),
    };
    expect(kinds.information).toMatch(/^InformationRequirement_/);
    expect(kinds.knowledge).toMatch(/^KnowledgeRequirement_/);
    expect(kinds.authority).toMatch(/^AuthorityRequirement_/);
    expect(kinds.association).toMatch(/^Association_/);
    const xml = await api.currentDmnXml('pricing');
    expect(xml).toMatch(/<literalExpression id="[^"]+" typeRef="number">\s*<text>basePrice \* 2<\/text>/);
    expect(xml).toMatch(/<businessKnowledgeModel id="discountRate" name="discountRate">\s*<variable [^>]*name="discountRate" \/>\s*<encapsulatedLogic id="[^"]+">\s*<formalParameter [^>]*name="years" typeRef="number" \/>/);
    expect(xml).toMatch(/<invocation id="finalPrice_invocation">\s*<literalExpression id="[^"]+">\s*<text>discountRate<\/text>/);
    expect(xml).toMatch(/<knowledgeSource id="policy" name="Pricing policy"/);
    expect(xml).toMatch(/<textAnnotation id="note">\s*<text>prices in euro<\/text>/);
    expect(xml).toMatch(/<requiredKnowledge href="#discountRate" \/>/);
    expect(xml).toMatch(/<requiredAuthority href="#policy" \/>/);
    // the lint and the tester know what only KIE runs
    expect(describeDmn(xml).kieOnly).toEqual(expect.arrayContaining(['businessKnowledgeModel discountRate', 'context finalPrice']));
    // the rules of the DRD refuse what is no requirement
    await expect(api.addRequirement('pricing', 'discountRate', 'InputData_basePrice')).rejects.toThrow('discountRate cannot be connected to InputData_basePrice');
    await expect(api.addRequirement('pricing', 'InputData_loyaltyYears', 'finalPrice', 'knowledge')).rejects.toThrow('is a dmn:InformationRequirement, not a dmn:KnowledgeRequirement');
    await expect(api.addRequirement('pricing', 'nothing', 'finalPrice')).rejects.toThrow('the DRD has no element nothing');
  });

  it('undoes a command, makes the saved form portable (the normalizer runs on every export) and reports what only the user can fix', async () => {
    await api.createDmn('raw');
    await api.addDecisionTable('raw', { id: 'raw', name: 'Raw', inputs: [{ expression: 'age', typeRef: 'integer' }], outputs: [{ typeRef: 'string' }], rules: [{ id: 'raw_r1', inputs: [''], outputs: ['"x"'] }] });
    // no input data, an integer, an unnamed output, an empty entry: the file the API exports has none of that
    const { files, warnings } = await api.files();
    expect(warnings).toEqual([]);
    const xml = files[0]!.content;
    expect(xml).toContain('typeRef="number"');
    expect(xml).not.toContain('integer');
    expect(xml).toMatch(/<inputData id="InputData_age" name="age">/);
    expect(xml).toMatch(/<output id="[^"]+" typeRef="string" name="Raw" \/>/);
    // the new input data is drawn, with its requirement
    expect(attrs(xml, 'dmndi:DMNShape', 'dmnElementRef')).toEqual(['raw', 'InputData_age']);
    expect(attrs(xml, 'dmndi:DMNEdge', 'dmnElementRef')).toEqual(['raw_req_InputData_age']);
    expect(xml).toMatch(/<inputEntry id="[^"]+">\s*<text>-<\/text>/);
    // undo takes the last command back
    await api.setHitPolicy('raw', 'raw', 'FIRST');
    expect(await api.currentDmnXml('raw')).toContain('hitPolicy="FIRST"');
    await api.undoDmn('raw');
    expect(await api.currentDmnXml('raw')).not.toContain('hitPolicy="FIRST"');
    // PRIORITY without allowed output values is reported
    await api.setHitPolicy('raw', 'raw', 'PRIORITY');
    expect((await api.files()).warnings.join('\n')).toContain('PRIORITY needs the allowed output values');
  });

  it('refuses a second file of the same name and an operation on a file that was never created', async () => {
    await api.createDmn('a');
    await expect(api.createDmn('a')).rejects.toThrow('a DMN file "a" already exists in the project');
    await expect(api.addInputData('b', { id: 'x' })).rejects.toThrow('no DMN file "b": call createDmn("b") first');
    await expect(api.setHitPolicy('a', 'missing', 'FIRST')).rejects.toThrow('has no view for "missing"');
  });
});

describe('openDmn: an existing file is opened the way the DMN editor opens a tab', () => {
  const legacy = readFileSync(join(corpus, 'N01-negative/models/legacy-discount.dmn'), 'utf8');

  it('migrates a DMN 1.1 file with @bpmn-io/dmn-migrate and saves it in the portable DMN 1.3 form', async () => {
    const opened = await api.openDmn('legacy-discount', legacy);
    expect(opened).toEqual({ migratedFrom: '1.1', warnings: [] });
    const xml = await api.currentDmnXml('legacy-discount');
    expect(xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
    expect(xml).not.toContain('camunda.org');
    expect(attrs(xml, 'output', 'name')).toEqual(['Discount']);
    expect(attrs(xml, 'output', 'typeRef')).toEqual(['number']);
    expect(attrs(xml, 'rule', 'id')).toEqual(['rule1']);
    // the migrated file is a file of the project: it is exported with the others
    expect((await api.files()).files.map((f) => f.name)).toEqual(['legacy-discount']);
    expect(refreshed).toBeGreaterThanOrEqual(1);
  });

  it('opens a DMN 1.3 file as it is, and refuses a second file of the same name and a file that is no DMN', async () => {
    const current = seed('C16-dmn-hit-policies', 'unique-grade.dmn');
    expect(await api.openDmn('unique-grade', current)).toEqual({ warnings: [] });
    expect(attrs(await api.currentDmnXml('unique-grade'), 'decision', 'id')).toEqual(['uniqueGrade']);
    await expect(api.openDmn('unique-grade', current)).rejects.toThrow('a DMN file "unique-grade" already exists in the project');
    await expect(api.openDmn('text', '<hello/>')).rejects.toThrow('is not a DMN document');
  });
});
