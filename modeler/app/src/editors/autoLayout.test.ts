// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { lacksDiagram, layoutWhenMissing } from './autoLayout';

/** U18: a file without a diagram gets one when it is opened. */

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn" id="D" targetNamespace="http://example.com">`;

/** Hand-written: no diagram, and no `incoming` / `outgoing` references. */
const NO_DI = `${HEAD}
  <bpmn:process id="order" isExecutable="true" activiti:candidateStarterGroups="sales">
    <bpmn:startEvent id="start" activiti:initiator="requester" />
    <bpmn:userTask id="review" name="Review" activiti:assignee="\${requester}">
      <bpmn:extensionElements><activiti:taskListener event="create" class="a.B" /></bpmn:extensionElements>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="ok" default="no" />
    <bpmn:serviceTask id="ship" activiti:expression="\${shipper.ship(order)}" />
    <bpmn:endEvent id="done" />
    <bpmn:endEvent id="refused" />
    <bpmn:boundaryEvent id="late" attachedToRef="review"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review" />
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="ok" />
    <bpmn:sequenceFlow id="yes" sourceRef="ok" targetRef="ship"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="no" sourceRef="ok" targetRef="refused" />
    <bpmn:sequenceFlow id="f3" sourceRef="ship" targetRef="done" />
    <bpmn:sequenceFlow id="f4" sourceRef="late" targetRef="refused" />
  </bpmn:process>
</bpmn:definitions>`;

const WITH_DI = NO_DI.replace(
  '</bpmn:process>',
  `</bpmn:process>
  <bpmndi:BPMNDiagram xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="order"><bpmndi:BPMNShape id="s_di" bpmnElement="start"><dc:Bounds x="0" y="0" width="36" height="36" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
);

function shapes(xml: string): string[] {
  return Array.from(xml.matchAll(/<bpmndi:BPMNShape [^>]*bpmnElement="([^"]+)"/g), (m) => m[1]!);
}
function edges(xml: string): string[] {
  return Array.from(xml.matchAll(/<bpmndi:BPMNEdge [^>]*bpmnElement="([^"]+)"/g), (m) => m[1]!);
}
/** The model without the diagram and without the redundant flow references: what the layout must not change. */
function semantics(xml: string): string {
  return xml
    .replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '')
    .replace(/\s*<bpmn:(incoming|outgoing)>[^<]*<\/bpmn:\1>/g, '')
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/\s+xmlns:\w+="[^"]*"/g, '')
    .replace(/<([\w:]+)((?:\s[^<>]*?)?)\/>/g, '<$1$2></$1>')
    .replace(/\s+/g, '');
}

describe('U18 lacksDiagram', () => {
  it('is true for a process without any shape, false once it has one, false for XML that is not a process', () => {
    expect(lacksDiagram(NO_DI)).toBe(true);
    expect(lacksDiagram(WITH_DI)).toBe(false);
    expect(lacksDiagram('<not-xml')).toBe(false);
    expect(lacksDiagram(`${HEAD}</bpmn:definitions>`)).toBe(false);
  });
});

describe('U18 layoutWhenMissing', () => {
  it('draws every flow node and every sequence flow, boundary events included, although the file has no incoming / outgoing references', async () => {
    const result = await layoutWhenMissing(NO_DI);
    expect(result.laidOut).toBe(true);
    expect(shapes(result.xml).sort()).toEqual(['done', 'late', 'ok', 'refused', 'review', 'ship', 'start']);
    expect(edges(result.xml).sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'no', 'yes']);
  });

  it('changes nothing but the diagram and the flow references: attributes, extension elements, conditions and defaults survive', async () => {
    const result = await layoutWhenMissing(NO_DI);
    expect(semantics(result.xml)).toBe(semantics(NO_DI));
    expect(result.xml).toContain('activiti:candidateStarterGroups="sales"');
    expect(result.xml).toContain('activiti:assignee="${requester}"');
    expect(result.xml).toMatch(/<activiti:taskListener event="create" class="a\.B"\s*\/>/);
    expect(result.xml).toContain('default="no"');
  });

  it('gives each shape a size and a position, and no two flow nodes the same place', async () => {
    const result = await layoutWhenMissing(NO_DI);
    const bounds = Array.from(result.xml.matchAll(/<bpmndi:BPMNShape [^>]*>\s*<dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g), (m) => `${m[1]},${m[2]}`);
    expect(bounds).toHaveLength(7);
    expect(new Set(bounds).size).toBe(7);
  });

  it('leaves a file that has a diagram alone', async () => {
    const result = await layoutWhenMissing(WITH_DI);
    expect(result).toEqual({ xml: WITH_DI, laidOut: false });
  });

  it('does not run on a collaboration with several participants and says why', async () => {
    const collaboration = NO_DI.replace('<bpmn:process', '<bpmn:collaboration id="c"><bpmn:participant id="a" processRef="order" /><bpmn:participant id="b" processRef="other" /></bpmn:collaboration><bpmn:process');
    const result = await layoutWhenMissing(collaboration);
    expect(result.laidOut).toBe(false);
    expect(result.xml).toBe(collaboration);
    expect(result.note).toContain('several processes or participants');
  });

  it('keeps the file and reports the failure when the layout throws', async () => {
    const result = await layoutWhenMissing(NO_DI, async () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ xml: NO_DI, laidOut: false, note: 'The automatic layout failed: boom' });
  });

  it('notes what the layout leaves out (message flows, groups, annotations)', async () => {
    const annotated = NO_DI.replace('</bpmn:process>', '<bpmn:textAnnotation id="n"><bpmn:text>x</bpmn:text></bpmn:textAnnotation></bpmn:process>');
    const result = await layoutWhenMissing(annotated);
    expect(result.laidOut).toBe(true);
    expect(result.note).toContain('not drawn');
  });

  it('lays out a sub process and a process with a parallel split and join', async () => {
    const xml = `${HEAD}
  <bpmn:process id="p" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:parallelGateway id="fork" />
    <bpmn:subProcess id="sub"><bpmn:startEvent id="ss" /><bpmn:task id="inner" /><bpmn:endEvent id="se" />
      <bpmn:sequenceFlow id="i1" sourceRef="ss" targetRef="inner" /><bpmn:sequenceFlow id="i2" sourceRef="inner" targetRef="se" /></bpmn:subProcess>
    <bpmn:task id="b" />
    <bpmn:parallelGateway id="join" />
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="a1" sourceRef="s" targetRef="fork" /><bpmn:sequenceFlow id="a2" sourceRef="fork" targetRef="sub" /><bpmn:sequenceFlow id="a3" sourceRef="fork" targetRef="b" />
    <bpmn:sequenceFlow id="a4" sourceRef="sub" targetRef="join" /><bpmn:sequenceFlow id="a5" sourceRef="b" targetRef="join" /><bpmn:sequenceFlow id="a6" sourceRef="join" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`;
    const result = await layoutWhenMissing(xml);
    expect(result.laidOut).toBe(true);
    expect(shapes(result.xml)).toEqual(expect.arrayContaining(['s', 'fork', 'sub', 'b', 'join', 'e']));
    expect(edges(result.xml)).toEqual(expect.arrayContaining(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']));
  });
});
