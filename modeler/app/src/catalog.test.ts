import { describe, expect, it } from 'vitest';

import { CatalogBuilder } from './catalog';

const DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="Grading" namespace="http://x">
  <decision id="grade" name="Grade">
    <informationRequirement><requiredDecision href="#score"/></informationRequirement>
    <decisionTable id="t" hitPolicy="COLLECT" aggregation="SUM">
      <input id="i"><inputExpression typeRef="string"><text>region</text></inputExpression></input>
      <input id="i2"><inputExpression typeRef="integer"><text>scoreValue</text></inputExpression></input>
      <output id="o" name="points" typeRef="integer"/>
    </decisionTable>
  </decision>
  <decision id="score" name="scoreValue">
    <decisionTable id="t2"><input id="j"><inputExpression typeRef="integer"><text>age</text></inputExpression></input><output id="p" name="scoreValue" typeRef="integer"/></decisionTable>
  </decision>
</definitions>`;

const CONNECTOR = '{"name":"crm","version":"3","actions":{"LOOKUP":{"id":"LOOKUP","name":"Look up","inputs":[{"id":"cid","name":"cid","type":"string"}],"outputs":[]}}}';

describe('the project catalog of the app', () => {
  const files = [
    { path: 'connectors/crm.json', content: CONNECTOR },
    { path: 'processes/grading.dmn', content: DMN },
    { path: 'processes/loan.bpmn20.xml', content: '<bpmn:process id="loan" isExecutable="true"/>' },
    { path: 'scenarios/a.scenario.json', content: '{}' },
  ];

  it('reads the connectors, the decisions with what they read and return, and the process ids', () => {
    const data = new CatalogBuilder().build(files);
    expect(data.connectors.map((c) => [c.name, c.version, Object.keys(c.actions)])).toEqual([['crm', '3', ['LOOKUP']]]);
    expect(data.processes).toEqual([{ id: 'loan', path: 'processes/loan.bpmn20.xml' }]);
    const [file] = data.dmn;
    expect(file).toMatchObject({ path: 'processes/grading.dmn', baseName: 'grading', name: 'Grading' });
    const grade = file!.decisions.find((d) => d.id === 'grade')!;
    // the input a required decision feeds is not a process input; the required decision's own input is
    expect(grade).toMatchObject({ inputs: ['region', 'age'], hitPolicy: 'COLLECT', aggregation: 'SUM', sink: true });
    expect(grade.outputs).toEqual([{ id: 'o', name: 'points', type: 'integer' }]);
    expect(file!.decisions.find((d) => d.id === 'score')!.sink).toBe(false);
  });

  it('parses a file again only when its text changed', () => {
    const builder = new CatalogBuilder();
    const first = builder.build(files);
    const second = builder.build(files);
    expect(second.connectors[0]).toBe(first.connectors[0]);
    expect(second.dmn[0]).toBe(first.dmn[0]);
    const changed = builder.build([{ path: 'connectors/crm.json', content: CONNECTOR.replace('"3"', '"4"') }]);
    expect(changed.connectors[0]!.version).toBe('4');
    expect(changed.dmn).toEqual([]);
  });

  it('takes the template version of a connector from project.json (ADR 0003), which wins over the descriptor, and follows its changes', () => {
    const clean = '{"name":"crm","actions":{"LOOKUP":{"id":"LOOKUP","name":"Look up","inputs":[],"outputs":[]}}}';
    const builder = new CatalogBuilder();
    const project = (version: string): string => `{"name":"p","connectors":{"crm":{"version":"${version}","config":[{"name":"url","value":"http://x"}]}}}`;
    const first = builder.build([{ path: 'connectors/crm.json', content: clean }, { path: 'project.json', content: project('5') }]);
    expect(first.connectors[0]).toMatchObject({ name: 'crm', version: '5', config: [{ name: 'url', value: 'http://x' }] });
    expect(builder.build([{ path: 'connectors/crm.json', content: clean }, { path: 'project.json', content: project('6') }]).connectors[0]!.version).toBe('6');
    expect(builder.build([{ path: 'connectors/crm.json', content: CONNECTOR }, { path: 'project.json', content: project('7') }]).connectors[0]!.version).toBe('7');
    expect(builder.build([{ path: 'connectors/crm.json', content: clean }, { path: 'project.json', content: 'not json' }]).connectors[0]!.version).toBeUndefined();
  });

  it('skips a connector file that is not a JSON object', () => {
    expect(new CatalogBuilder().build([{ path: 'connectors/bad.json', content: 'nope' }]).connectors).toEqual([]);
  });
});
