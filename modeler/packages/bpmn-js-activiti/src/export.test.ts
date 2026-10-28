import { ExportVerificationError, verifyBpmnXml } from '@activiti-modeler/activiti-project';
import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../test-support/builder';
import { EMPTY_PROCESS } from '../test-support/modeler';
import { exportProcess, exportProject, importProcess } from './export';
import type { ModdleElement } from './types';

let t: Built | undefined;
afterEach(() => t?.destroy());

const xmlOf = async (b: Built, format: boolean): Promise<string> => (await b.modeler.saveXML({ format })).xml ?? '';

describe('exportProcess', () => {
  it('returns pretty-printed XML that passes every serializer guarantee, plus the extensions JSON', async () => {
    t = await createBuilt();
    t.builder.appendShape('StartEvent_1', { type: 'userTask', id: 'review' });
    t.builder.setProperty('review', 'mi.type', 'parallel');
    t.builder.setProperty('review', 'mi.collection', 'people');
    t.builder.setProperty('review', 'mi.completionCondition', '${nrOfCompletedInstances >= 1}');
    t.builder.setProperty('review', 'user.assignee', '${person}');
    t.builder.appendShape('review', { type: 'endEvent', id: 'done' });
    const out = await exportProcess(t.modeler as never, 'review');
    expect(verifyBpmnXml(out.xml)).toEqual({ violations: [], warnings: [] });
    expect(out.xml).toContain('isExecutable="true"');
    expect(out.xml).toMatch(/<\/bpmn:multiInstanceLoopCharacteristics>\n\s*<\/bpmn:userTask>/);
    expect(out.xml.split('\n').length).toBeGreaterThan(20);
    expect(out.processIds).toEqual(['Process_1']);
    // a multi-instance user task has MAP_ALL_OUTPUTS by default, not MAP_ALL (it would wedge a parallel one, ADR 0006)
    expect(JSON.parse(out.extensionsJson)).toEqual({ id: 'process-review', extensions: { Process_1: { properties: {}, mappings: { review: { mappingType: 'MAP_ALL_OUTPUTS' } }, constants: {} } } });
  });

  it('would catch minified XML: the check the export runs fails on saveXML({ format: false })', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.setProperty('u', 'mi.type', 'sequential');
    t.builder.setProperty('u', 'mi.collection', 'items');
    t.builder.setProperty('u', 'mi.cardinality', '3');
    // bpmn-js can minify: the engine parser would then absorb the following flow elements into the task
    const minified = (await xmlOf(t, false)).replace(/>\s+</g, '><');
    expect(verifyBpmnXml(minified).violations.map((v) => v.code)).toEqual(['MULTI_INSTANCE_WHITESPACE']);
    expect(minified).toMatch(/<\/bpmn:multiInstanceLoopCharacteristics><\/bpmn:userTask>/);
    expect(verifyBpmnXml(await xmlOf(t, true)).violations).toEqual([]);
  });

  it('moves the diagram to the origin without touching the editing session or the undo history', async () => {
    t = await createBuilt();
    const start = t.element('StartEvent_1');
    const before = { x: start.x, y: start.y };
    const undoable = t.commandStack.canUndo();
    const out = await exportProcess(t.modeler as never, 'p');
    expect(out.xml).toMatch(/<dc:Bounds x="0" y="0" width="36" height="36" \/>/);
    expect({ x: start.x, y: start.y }).toEqual(before);
    expect((start.di as unknown as ModdleElement).get('bounds')).toMatchObject({ x: before.x, y: before.y });
    expect(t.commandStack.canUndo()).toBe(undoable);
    // the live diagram still exports at its own position when asked directly
    expect(await xmlOf(t, true)).toContain(`x="${before.x}"`);
  });

  it('writes a text annotation of a pool, and its association, into the process of the pool, the only place Activiti reads them', async () => {
    // what bpmn-js writes for annotations of a collaboration, whether drawn in a pool or not: the collaboration holds them
    const COLLABORATION = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d" targetNamespace="urn:t">
  <bpmn:collaboration id="collab">
    <bpmn:participant id="pool" processRef="p" />
    <bpmn:textAnnotation id="inPool"><bpmn:text>in the pool</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="as_work_inPool" sourceRef="work" targetRef="inPool" />
    <bpmn:textAnnotation id="outside"><bpmn:text>outside every pool</bpmn:text></bpmn:textAnnotation>
    <bpmn:textAnnotation id="kept"><bpmn:text>its association is in the process</bpmn:text></bpmn:textAnnotation>
  </bpmn:collaboration>
  <bpmn:process id="p" isExecutable="true">
    <bpmn:task id="work" />
    <bpmn:association id="as_work_kept" sourceRef="work" targetRef="kept" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia">
    <bpmndi:BPMNPlane id="plane" bpmnElement="collab">
      <bpmndi:BPMNShape id="pool_di" bpmnElement="pool" isHorizontal="true"><dc:Bounds x="100" y="100" width="600" height="250" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="work_di" bpmnElement="work"><dc:Bounds x="200" y="180" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="inPool_di" bpmnElement="inPool"><dc:Bounds x="400" y="120" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="as_di" bpmnElement="as_work_inPool"><di:waypoint x="300" y="200" /><di:waypoint x="400" y="135" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="outside_di" bpmnElement="outside"><dc:Bounds x="400" y="420" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="kept_di" bpmnElement="kept"><dc:Bounds x="550" y="280" width="100" height="30" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="as_kept_di" bpmnElement="as_work_kept"><di:waypoint x="300" y="240" /><di:waypoint x="550" y="295" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
    t = await createBuilt(COLLABORATION);
    const live = await xmlOf(t, true);
    const undoable = t.commandStack.canUndo();
    const out = await exportProcess(t.modeler as never, 'p');
    const section = (xml: string, tag: string): string => new RegExp(`<bpmn:${tag}\\b[\\s\\S]*?</bpmn:${tag}>`).exec(xml)![0];
    const ids = [...section(out.xml, 'process').matchAll(/<bpmn:(task|textAnnotation|association) id="([^"]+)"/g)].map((m) => m[2]);
    // after the flow elements (the order the engine's XSD wants, C18.1); an annotation before the association that connects it
    expect(ids).toEqual(['work', 'kept', 'as_work_kept', 'inPool', 'as_work_inPool']);
    expect(section(out.xml, 'collaboration')).not.toMatch(/inPool|kept/);
    // an annotation that is in no pool belongs to no process: it stays
    expect(section(out.xml, 'collaboration')).toContain('<bpmn:textAnnotation id="outside">');
    expect(verifyBpmnXml(out.xml).violations).toEqual([]);
    // the editing session is as it was
    expect(await xmlOf(t, true)).toBe(live);
    expect((t.element('inPool').businessObject as ModdleElement).$parent?.id).toBe('collab');
    expect(t.commandStack.canUndo()).toBe(undoable);
  });

  it('refuses to export XML that breaks a guarantee, naming the problem', async () => {
    t = await createBuilt();
    // a foreign attribute that survived an import (kept as an opaque attribute)
    const task = t.builder.createShape({ type: 'userTask', id: 'u' });
    (t.element(task).businessObject as ModdleElement).$attrs['camunda:assignee'] = 'kermit';
    const definitions = (t.modeler as unknown as { getDefinitions(): ModdleElement }).getDefinitions();
    definitions.$attrs['xmlns:camunda'] = 'http://camunda.org/schema/1.0/bpmn';
    await expect(exportProcess(t.modeler as never, 'bad')).rejects.toThrow(ExportVerificationError);
    await expect(exportProcess(t.modeler as never, 'bad')).rejects.toThrow(/FOREIGN_ATTRIBUTE/);
  });

  it('refuses to export an invalid id', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'task', id: 'ok' });
    t.element('ok').businessObject.id = '1 bad';
    await expect(exportProcess(t.modeler as never, 'bad')).rejects.toThrow(/INVALID_ID/);
  });

  it('exports every process of the file and fails loudly when a process is not executable', async () => {
    t = await createBuilt();
    const out = await exportProcess(t.modeler as never);
    expect(out.processIds).toEqual(['Process_1']);
    (t.element('Process_1').businessObject as ModdleElement).set('isExecutable', false);
    await expect(exportProcess(t.modeler as never)).rejects.toThrow(/NOT_EXECUTABLE/);
  });
});

describe('exportProject', () => {
  it('lays out the ADR 0003 files with the XML, the extensions and the passthrough files', async () => {
    t = await createBuilt();
    t.builder.appendShape('StartEvent_1', { type: 'serviceTask', id: 'svc' });
    t.builder.setProperty('svc', 'impl.connector', 'mailer.SEND');
    t.builder.setMapping('svc', { inputs: { to: { type: 'VALUE', value: 'a@b.c' } } });
    const { files } = await exportProject(t.modeler as never, {
      project: 'mailing',
      process: 'send',
      dmn: [{ name: 'risk', content: '<definitions/>' }],
      connectors: [{ name: 'mailer', content: '{"name":"mailer"}' }],
      now: () => new Date('2026-10-26T00:00:00Z'),
    });
    expect(files.map((f) => f.path)).toEqual(['project.json', 'processes/send.bpmn20.xml', 'processes/send-extensions.json', 'processes/risk.dmn', 'connectors/mailer.json']);
    const bpmn = files.find((f) => f.path === 'processes/send.bpmn20.xml')!.content;
    expect(bpmn).toContain('implementation="mailer.SEND"');
    const ext = JSON.parse(files.find((f) => f.path === 'processes/send-extensions.json')!.content);
    expect(ext.extensions.Process_1.mappings.svc.inputs.to).toEqual({ type: 'VALUE', value: 'a@b.c' });
    expect(files[3]!.content).toBe('<definitions/>');
  });

  it('writes nothing when the BPMN breaks a guarantee', async () => {
    t = await createBuilt();
    (t.element('Process_1').businessObject as ModdleElement).set('isExecutable', false);
    await expect(exportProject(t.modeler as never, { project: 'p' })).rejects.toThrow(ExportVerificationError);
  });
});

describe('importProcess', () => {
  it('opens the BPMN and its extensions JSON together', async () => {
    t = await createBuilt();
    const { warnings } = await importProcess(t.modeler as never, { xml: EMPTY_PROCESS, extensionsJson: '{"id":"x","extensions":{"Process_1":{"constants":{"StartEvent_1":{"k":{"value":1}}}}}}' });
    expect(warnings).toEqual([]);
    const out = await exportProcess(t.modeler as never, 'x');
    expect(JSON.parse(out.extensionsJson).extensions.Process_1.constants.StartEvent_1).toEqual({ k: { value: 1 } });
  });
});
