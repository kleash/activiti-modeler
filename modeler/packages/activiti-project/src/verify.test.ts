import { describe, expect, it } from 'vitest';

import { assertBpmnExportable, ExportVerificationError, verifyBpmnXml } from './verify';

const NS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" ' +
  'xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"';

const doc = (processBody: string, processAttrs = 'isExecutable="true"', extra = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://activiti.org/bpmn"${extra}>
  <bpmn:process id="Process_1" ${processAttrs}>
${processBody}
  </bpmn:process>
</bpmn:definitions>
`;

const GOOD_BODY = `    <bpmn:startEvent id="start" />
    <bpmn:userTask id="task" activiti:assignee="kermit" bioc:stroke="#000" color:background-color="#fff">
      <bpmn:multiInstanceLoopCharacteristics isSequential="false" activiti:collection="people">
        <bpmn:loopCardinality>3</bpmn:loopCardinality>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="flow" sourceRef="start" targetRef="task" />
    <bpmn:textAnnotation id="note"><bpmn:text>n</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="assoc" sourceRef="task" targetRef="note" />`;

const codes = (xml: string): string[] => verifyBpmnXml(xml).violations.map((v) => v.code);

describe('verifyBpmnXml: accepts what bpmn-js writes', () => {
  it('passes a well-formed, executable, pretty-printed process with allowed colour attributes', () => {
    expect(verifyBpmnXml(doc(GOOD_BODY))).toEqual({ violations: [], warnings: [] });
  });
});

describe('guarantee 1: isExecutable', () => {
  it.each(['isExecutable="false"', '', 'isExecutable="TRUE"'])('rejects %j', (attrs) => {
    expect(codes(doc(GOOD_BODY, attrs))).toContain('NOT_EXECUTABLE');
  });
});

describe('guarantee 2: line break after multiInstanceLoopCharacteristics', () => {
  const minified = GOOD_BODY.replace(/\n\s*/g, '');

  it('catches minified XML, where the engine parser would swallow the closing task tag', () => {
    const result = verifyBpmnXml(doc(minified));
    expect(result.violations.map((v) => v.code)).toEqual(['MULTI_INSTANCE_WHITESPACE']);
    expect(result.violations[0]!.message).toContain('swallow the closing tag');
    expect(result.violations[0]!.elementId).toBe('task');
  });

  it('catches a self-closing loop element glued to the task end tag', () => {
    const xml = doc('<bpmn:userTask id="t"><bpmn:multiInstanceLoopCharacteristics activiti:collection="c"/></bpmn:userTask>');
    expect(codes(xml)).toContain('MULTI_INSTANCE_WHITESPACE');
  });

  it('accepts a line break with or without indentation, and CRLF', () => {
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:multiInstanceLoopCharacteristics activiti:collection="c"/>\n</bpmn:userTask>'))).toEqual([]);
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:multiInstanceLoopCharacteristics activiti:collection="c"/>\r\n    </bpmn:userTask>'))).toEqual([]);
  });

  it('rejects spaces without a line break', () => {
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:multiInstanceLoopCharacteristics activiti:collection="c"/>   </bpmn:userTask>'))).toContain('MULTI_INSTANCE_WHITESPACE');
  });
});

describe('guarantee 3: XSD child order', () => {
  it('rejects an artifact before a flow element', () => {
    const body = `    <bpmn:startEvent id="s" />
    <bpmn:task id="t" />
    <bpmn:association id="a" sourceRef="t" targetRef="n" />
    <bpmn:textAnnotation id="n" />
    <bpmn:sequenceFlow id="f" sourceRef="s" targetRef="t" />`;
    const result = verifyBpmnXml(doc(body));
    expect(result.violations.map((v) => v.code)).toEqual(['CHILD_ORDER']);
    expect(result.violations[0]!.message).toContain('artifacts');
  });

  it('rejects a laneSet after flow elements', () => {
    const body = `    <bpmn:task id="t" />
    <bpmn:laneSet id="ls"><bpmn:lane id="l"><bpmn:flowNodeRef>t</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>`;
    expect(codes(doc(body))).toContain('CHILD_ORDER');
  });

  it('accepts laneSet, flow elements, artifacts in that order', () => {
    const body = `    <bpmn:laneSet id="ls"><bpmn:lane id="l"><bpmn:flowNodeRef>t</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:task id="t" />
    <bpmn:textAnnotation id="n" />`;
    expect(codes(doc(body))).toEqual([]);
  });

  it('rejects extensionElements after other children and documentation after extensionElements', () => {
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:incoming>x</bpmn:incoming><bpmn:extensionElements /></bpmn:userTask>'))).toContain('CHILD_ORDER');
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:extensionElements /><bpmn:documentation>d</bpmn:documentation></bpmn:userTask>'))).toContain('CHILD_ORDER');
    expect(codes(doc('<bpmn:userTask id="t"><bpmn:documentation>d</bpmn:documentation><bpmn:extensionElements /></bpmn:userTask>'))).toEqual([]);
  });

  it('applies the same order inside sub processes', () => {
    const body = `<bpmn:subProcess id="sp"><bpmn:task id="t" /><bpmn:textAnnotation id="n" /><bpmn:task id="u" /></bpmn:subProcess>`;
    expect(codes(doc(body))).toContain('CHILD_ORDER');
  });
});

describe('guarantee 4: ids', () => {
  it.each(['1abc', 'has space', 'a:b', 'a#b', ''])('rejects the NCName violation %j', (id) => {
    expect(codes(doc(`<bpmn:task id="${id}" />`))).toContain('INVALID_ID');
  });

  it('accepts ids with dots, dashes, underscores and unicode letters', () => {
    expect(codes(doc('<bpmn:task id="Task_1.a-b" /><bpmn:task id="é_1" />'))).toEqual([]);
  });

  it('rejects ids longer than 255 characters but accepts exactly 255', () => {
    expect(codes(doc(`<bpmn:task id="${'a'.repeat(256)}" />`))).toContain('ID_TOO_LONG');
    expect(codes(doc(`<bpmn:task id="${'a'.repeat(255)}" />`))).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    expect(codes(doc('<bpmn:task id="same" /><bpmn:task id="same" />'))).toContain('DUPLICATE_ID');
  });
});

describe('guarantee 5: attributes', () => {
  it('rejects camunda: and zeebe: attributes on semantic elements', () => {
    const xml = doc('<bpmn:userTask id="t" camunda:assignee="x" />', 'isExecutable="true"', ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"');
    const result = verifyBpmnXml(xml);
    expect(result.violations.map((v) => v.code)).toEqual(['FOREIGN_ATTRIBUTE']);
    expect(result.violations[0]!.message).toContain('camunda.org');
    expect(codes(doc('<bpmn:serviceTask id="t" zeebe:foo="x" />', 'isExecutable="true"', ' xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"'))).toContain('FOREIGN_ATTRIBUTE');
  });

  it('allows bioc: and color: (colour picker) and the diagram namespaces', () => {
    expect(codes(doc('<bpmn:task id="t" bioc:fill="#fff" color:border-color="#000" />'))).toEqual([]);
  });

  it('rejects unqualified Activiti attributes that the engine only reads as activiti:, but allows skipExpression on flows', () => {
    expect(codes(doc('<bpmn:userTask id="t" assignee="kermit" />'))).toContain('UNQUALIFIED_ACTIVITI_ATTRIBUTE');
    expect(codes(doc('<bpmn:task id="a" /><bpmn:task id="b" /><bpmn:sequenceFlow id="f" sourceRef="a" targetRef="b" skipExpression="${x}" />'))).toEqual([]);
  });

  it('requires the prefix "activiti" for the Activiti namespace', () => {
    const xml = doc('<bpmn:userTask id="t" act:assignee="x" />', 'isExecutable="true"', ' xmlns:act="http://activiti.org/bpmn"');
    expect(codes(xml)).toContain('ACTIVITI_PREFIX');
  });

  it('reports foreign extension elements as warnings, not violations', () => {
    const xml = doc('<bpmn:userTask id="t"><bpmn:extensionElements><x:foo xmlns:x="urn:x" /></bpmn:extensionElements></bpmn:userTask>');
    const result = verifyBpmnXml(xml);
    expect(result.violations).toEqual([]);
    expect(result.warnings[0]).toContain('foreign extension element <x:foo>');
  });
});

describe('assertBpmnExportable', () => {
  it('throws one error listing every violation', () => {
    const xml = doc('<bpmn:task id="1bad" />', 'isExecutable="false"');
    expect(() => assertBpmnExportable(xml, 'processes/a.bpmn20.xml')).toThrow(ExportVerificationError);
    try {
      assertBpmnExportable(xml, 'processes/a.bpmn20.xml');
    } catch (e) {
      expect((e as ExportVerificationError).violations.map((v) => v.code).sort()).toEqual(['INVALID_ID', 'NOT_EXECUTABLE']);
      expect((e as Error).message).toContain('processes/a.bpmn20.xml: export refused');
    }
  });

  it('reports malformed XML', () => {
    expect(codes('<bpmn:definitions')).toEqual(['XML_NOT_WELL_FORMED']);
  });
});

describe('guarantee 6: QName attribute values need their prefix declared', () => {
  const dataObject = '<bpmn:dataObject id="d" name="region" itemSubjectRef="xsd:string" />';

  it('catches itemSubjectRef="xsd:string" without xmlns:xsd, which makes the engine reject the whole deployment', () => {
    const result = verifyBpmnXml(doc(dataObject));
    expect(result.violations.map((v) => v.code)).toEqual(['UNDECLARED_PREFIX']);
    expect(result.violations[0]!.message).toContain('xmlns:xsd');
    expect(result.violations[0]!.elementId).toBe('d');
  });

  it('accepts it when the prefix is declared on the root or on the element itself', () => {
    expect(codes(doc(dataObject, 'isExecutable="true"', ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'))).toEqual([]);
    expect(codes(doc('<bpmn:dataObject id="d" itemSubjectRef="xsd:int" xmlns:xsd="http://www.w3.org/2001/XMLSchema" />'))).toEqual([]);
  });

  it('leaves unprefixed values alone', () => {
    expect(codes(doc('<bpmn:dataObject id="d" itemSubjectRef="item1" />'))).toEqual([]);
  });
});

describe('warning: a drawn data object reference', () => {
  const body = '<bpmn:dataObjectReference id="ref" dataObjectRef="obj" /><bpmn:dataObject id="obj" name="region" />';
  const shape = '<bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="Process_1"><bpmndi:BPMNShape id="ref_di" bpmnElement="ref"><dc:Bounds x="0" y="0" width="36" height="50" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>';

  it('is reported, because Activiti 9 flags the shape as DI_INVALID_REFERENCE (the model still deploys)', () => {
    const result = verifyBpmnXml(doc(body).replace('</bpmn:definitions>', `${shape}</bpmn:definitions>`));
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('dataObjectReference "ref" is drawn');
    expect(result.warnings[0]).toContain('DI_INVALID_REFERENCE');
  });

  it('is silent for a data object without a shape', () => {
    expect(verifyBpmnXml(doc(body))).toEqual({ violations: [], warnings: [] });
  });
});
