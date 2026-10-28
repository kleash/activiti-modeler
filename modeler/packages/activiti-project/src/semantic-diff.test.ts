import { describe, expect, it } from 'vitest';

import { diffBpmn, diffExtensions } from './semantic-diff';

const SEED = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" targetNamespace="http://activiti.org/bpmn/corpus/C04">
  <message id="approveMessage" name="approveOrder"/>
  <process id="p" name="P" isExecutable="true">
    <documentation>Doc</documentation>
    <startEvent id="start"/>
    <sequenceFlow id="f_start_gw" sourceRef="start" targetRef="gw"/>
    <exclusiveGateway id="gw" name="Route" default="f_gw_other"/>
    <sequenceFlow id="f_gw_a" name="a" sourceRef="gw" targetRef="endA">
      <extensionElements><activiti:executionListener event="take" class="a.B"/></extensionElements>
      <conditionExpression xsi:type="tFormalExpression">\${amount &lt; 100}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f_gw_b" name="b" sourceRef="gw" targetRef="endB"><conditionExpression xsi:type="tFormalExpression">\${amount &gt;= 100}</conditionExpression></sequenceFlow>
    <sequenceFlow id="f_gw_other" sourceRef="gw" targetRef="endC"/>
    <endEvent id="endA"/><endEvent id="endB"/><endEvent id="endC"/>
    <intermediateCatchEvent id="wait"><messageEventDefinition messageRef="approveMessage" activiti:correlationKey="\${orderId}"/></intermediateCatchEvent>
    <subProcess id="sub"><multiInstanceLoopCharacteristics isSequential="false" activiti:collection="items"/></subProcess>
  </process>
  <bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="p"><bpmndi:BPMNShape id="s_di" bpmnElement="start"><dc:Bounds x="1" y="2" width="36" height="36"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;

/** The same model as the editor writes it: prefixes, attribute order, incoming / outgoing, event definition ids, other layout. */
const GENERATED = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_1" targetNamespace="http://activiti.org/bpmn/corpus/C04">
  <bpmn:message id="approveMessage" name="approveOrder" />
  <bpmn:process id="p" name="P" isExecutable="true">
    <bpmn:documentation>Doc</bpmn:documentation>
    <bpmn:startEvent id="start"><bpmn:outgoing>f_start_gw</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sequenceFlow id="f_start_gw" sourceRef="start" targetRef="gw" />
    <bpmn:exclusiveGateway default="f_gw_other" name="Route" id="gw"><bpmn:incoming>f_start_gw</bpmn:incoming></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="f_gw_a" name="a" sourceRef="gw" targetRef="endA">
      <bpmn:extensionElements><activiti:executionListener class="a.B" event="take" /></bpmn:extensionElements>
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\${amount &lt; 100}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f_gw_b" name="b" sourceRef="gw" targetRef="endB"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\${amount &gt;= 100}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f_gw_other" sourceRef="gw" targetRef="endC" />
    <bpmn:endEvent id="endC" /><bpmn:endEvent id="endB" /><bpmn:endEvent id="endA" />
    <bpmn:intermediateCatchEvent id="wait"><bpmn:messageEventDefinition id="MessageEventDefinition_0abc123" messageRef="approveMessage" activiti:correlationKey="\${orderId}" /></bpmn:intermediateCatchEvent>
    <bpmn:subProcess id="sub"><bpmn:multiInstanceLoopCharacteristics activiti:collection="items" /></bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="p"><bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="500" y="600" width="36" height="36" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('diffBpmn', () => {
  it('finds no difference between a seed and the same model as the editor writes it', () => {
    expect(diffBpmn(SEED, GENERATED)).toEqual([]);
  });

  it('reports a changed attribute, with the element it is on', () => {
    expect(diffBpmn(SEED, GENERATED.replace('name="Route"', 'name="Router"'))).toEqual(['definitions/process[p]/exclusiveGateway[gw]/@name: expected "Route", generated "Router"']);
    expect(diffBpmn(SEED, GENERATED.replace('default="f_gw_other" ', ''))).toEqual(['definitions/process[p]/exclusiveGateway[gw]/@default: expected "f_gw_other", generated no attribute']);
  });

  it('reports a changed condition, listener and message correlation', () => {
    expect(diffBpmn(SEED, GENERATED.replace('amount &lt; 100', 'amount &lt; 101'))).toEqual([
      'definitions/process[p]/sequenceFlow[f_gw_a]/conditionExpression: expected text "${amount < 100}", generated "${amount < 101}"',
    ]);
    expect(diffBpmn(SEED, GENERATED.replace('event="take"', 'event="start"'))).toEqual([
      'definitions/process[p]/sequenceFlow[f_gw_a]/extensionElements/executionListener/@event: expected "take", generated "start"',
    ]);
    expect(diffBpmn(SEED, GENERATED.replace('${orderId}', '${id}'))[0]).toContain('@correlationKey');
  });

  it('reports elements that are missing or extra', () => {
    expect(diffBpmn(SEED, GENERATED.replace('<bpmn:endEvent id="endB" />', ''))).toEqual(['definitions/process[p]/endEvent[endB]: missing in the generated model']);
    expect(diffBpmn(SEED, GENERATED.replace('<bpmn:endEvent id="endB" />', '<bpmn:endEvent id="endB" /><bpmn:endEvent id="endD" />'))).toEqual(['definitions/process[p]/endEvent[endD]: only in the generated model']);
  });

  it('reports sequence flows that leave a gateway in another order, because the first true condition wins', () => {
    const swapped = GENERATED.replace(/(<bpmn:sequenceFlow id="f_gw_a"[\s\S]*?<\/bpmn:sequenceFlow>)(\s*)(<bpmn:sequenceFlow id="f_gw_b"[\s\S]*?<\/bpmn:sequenceFlow>)/, '$3$2$1');
    expect(diffBpmn(SEED, swapped)).toEqual(['definitions/process[p]: sequence flows leaving gw are in another order: expected f_gw_a, f_gw_b, f_gw_other, generated f_gw_b, f_gw_a, f_gw_other']);
  });

  it('treats a default attribute like an absent one, but not another value', () => {
    expect(diffBpmn(SEED, GENERATED.replace('<bpmn:multiInstanceLoopCharacteristics ', '<bpmn:multiInstanceLoopCharacteristics isSequential="false" '))).toEqual([]);
    expect(diffBpmn(SEED, GENERATED.replace('<bpmn:multiInstanceLoopCharacteristics ', '<bpmn:multiInstanceLoopCharacteristics isSequential="true" '))).toEqual([
      'definitions/process[p]/subProcess[sub]/multiInstanceLoopCharacteristics/@isSequential: expected no attribute, generated "true"',
    ]);
  });

  it('keeps an event definition id when the seed has one (links refer to it) and ignores a generated one when it has none', () => {
    const withId = SEED.replace('<messageEventDefinition ', '<messageEventDefinition id="mine" ');
    expect(diffBpmn(withId, GENERATED)).toEqual(['definitions/process[p]/intermediateCatchEvent[wait]/messageEventDefinition[mine]/@id: expected "mine", generated "MessageEventDefinition_0abc123"']);
  });

  it('ignores the xsi:type the editor writes on timer and loop expressions, but not on a condition', () => {
    const seed = SEED.replace('<subProcess id="sub">', '<subProcess id="sub"><multiInstanceLoopCharacteristics><loopCardinality>3</loopCardinality></multiInstanceLoopCharacteristics>').replace('<multiInstanceLoopCharacteristics isSequential="false" activiti:collection="items"/>', '');
    const generated = GENERATED.replace('<bpmn:multiInstanceLoopCharacteristics activiti:collection="items" />', '<bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>');
    expect(diffBpmn(seed, generated)).toEqual([]);
    const noType = GENERATED.replace(' xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${amount &lt; 100}', '>${amount &lt; 100}');
    expect(diffBpmn(SEED, noType)).toEqual(['definitions/process[p]/sequenceFlow[f_gw_a]/conditionExpression/@type: expected "{http://www.omg.org/spec/BPMN/20100524/MODEL}tFormalExpression", generated no attribute']);
  });

  it('reads the attributes of an activiti: element by name, qualified or not (customResource accepts both)', () => {
    const seed = SEED.replace('<startEvent id="start"/>', '<startEvent id="start"><extensionElements><activiti:customResource activiti:name="supervisor"/></extensionElements></startEvent>');
    const generated = GENERATED.replace('<bpmn:startEvent id="start">', '<bpmn:startEvent id="start"><bpmn:extensionElements><activiti:customResource name="supervisor" /></bpmn:extensionElements>');
    expect(diffBpmn(seed, generated)).toEqual([]);
    // an attribute of a BPMN element is still told apart from the unqualified one
    expect(diffBpmn(SEED.replace('<startEvent id="start"/>', '<startEvent id="start" activiti:formKey="a"/>'), GENERATED.replace('<bpmn:startEvent id="start">', '<bpmn:startEvent id="start" formKey="a">'))).toHaveLength(2);
  });

  it('can ignore elements that only exist because of how the editor draws something', () => {
    const extra = GENERATED.replace('<bpmn:endEvent id="endC" />', '<bpmn:endEvent id="endC" /><bpmn:dataObjectReference id="ref" dataObjectRef="o" />');
    expect(diffBpmn(SEED, extra)).toEqual(['definitions/process[p]/dataObjectReference[ref]: only in the generated model']);
    expect(diffBpmn(SEED, extra, { ignoreElements: ['dataObjectReference'] })).toEqual([]);
  });

  it('rejects text that is not XML', () => {
    expect(() => diffBpmn(SEED, '<a>')).toThrow('the generated BPMN is not well-formed XML');
  });
});

describe('diffExtensions', () => {
  const seed = JSON.stringify({
    id: 'seed',
    extensions: {
      p: {
        properties: { p1: { id: 'p1', name: 'decision', type: 'string' } },
        mappings: { decide: { outputs: { decision: { type: 'VARIABLE', value: 'decision' } } } },
      },
    },
  });
  const generated = JSON.stringify({
    id: 'process-x',
    extensions: {
      p: {
        properties: { 'b6c9-uuid': { id: 'b6c9-uuid', name: 'decision', type: 'string', required: false } },
        mappings: { decide: { outputs: { decision: { type: 'variable', value: 'decision' } } } },
        constants: {},
      },
    },
  });

  it('compares variables by name, mapping types ignoring case, and treats Java defaults and empty maps as absent', () => {
    expect(diffExtensions(seed, generated)).toEqual([]);
  });

  it('reports a different type, a different mapping and a mapping that should not be there', () => {
    const other = JSON.parse(generated);
    other.extensions.p.properties['b6c9-uuid'].type = 'integer';
    other.extensions.p.mappings.decide.outputs.decision.value = 'verdict';
    other.extensions.p.mappings.review = { mappingType: 'MAP_ALL' };
    expect(diffExtensions(seed, JSON.stringify(other))).toEqual([
      'extensions[p].mappings.decide.outputs.decision.value: expected "decision", generated "verdict"',
      'extensions[p].mappings.review: only in the generated model ({"mappingType":"MAP_ALL"})',
      'extensions[p].properties.decision.type: expected "string", generated "integer"',
    ]);
  });

  it('treats a seed without an extensions file as an empty one, so a generated default mapping shows up', () => {
    expect(diffExtensions(undefined, JSON.stringify({ id: 'x', extensions: { p: { properties: {}, mappings: {}, constants: {} } } }))).toEqual([]);
    expect(diffExtensions(undefined, JSON.stringify({ id: 'x', extensions: { p: { mappings: { review: { mappingType: 'MAP_ALL' } } } } }))).toEqual([
      'extensions[p].mappings: only in the generated model ({"review":{"mappingType":"MAP_ALL"}})',
    ]);
  });
});
