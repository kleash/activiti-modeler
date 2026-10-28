import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { findUnknownFields } from '../packages/activiti-project/src/runtime-model';
import { ModelerApi } from './support/modelerApi';

test('builds a process entirely through the test API, exports it, and the files carry exactly what was set', async ({ page }, testInfo) => {
  const api = await ModelerApi.open(page);
  await api.createProject('approval-demo');
  await api.newProcess('approval', 'Approval');

  // start -> user task -> exclusive gateway -> (approved) connector service task -> end
  //                                          -> (rejected) end
  //                                          -> default      end
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Request received' });
  await api.setProperty('start', 'start.initiator', 'applicant');
  await api.appendShape('start', { type: 'userTask', id: 'review', name: 'Review request' });
  await api.setProperty('review', 'user.assignee', 'kermit');
  await api.setProperty('review', 'user.candidateGroups', 'managers,reviewers');

  await api.appendShape('review', { type: 'exclusiveGateway', id: 'decide', name: 'Approved?' });
  await api.appendShape('decide', { type: 'serviceTask', id: 'notify', name: 'Notify applicant', dy: -110 }, { id: 'flow_approved', name: 'approved' });
  await api.setProperty('flow_approved', 'flow.condition', '${approved == true}');
  await api.setProperty('notify', 'impl.type', 'connector');
  await api.setProperty('notify', 'impl.connector', 'mailer.SEND');
  await api.setExtensions({
    elementId: 'notify',
    inputs: { to: { type: 'VARIABLE', value: 'applicantEmail' }, subject: { type: 'VALUE', value: 'Your request was approved' } },
    outputs: { notificationId: { type: 'VARIABLE', value: 'messageId', declareType: 'string' } },
    constants: { retries: 3 },
  });
  await api.appendShape('notify', { type: 'endEvent', id: 'approved_end', name: 'Approved' });

  await api.appendShape('decide', { type: 'endEvent', id: 'rejected_end', name: 'Rejected', dy: 110 }, { id: 'flow_rejected', name: 'rejected' });
  await api.setProperty('flow_rejected', 'flow.condition', '${approved == false}');
  await api.connect('decide', 'rejected_end', 'flow_default');
  await api.setProperty('flow_default', 'flow.default', true);
  await api.setExtensions({ properties: [{ name: 'approved', type: 'boolean' }, { name: 'applicantEmail', type: 'string' }] });

  // the same code that the UI uses refuses what Activiti does not run
  await expect(api.createShape({ type: 'businessRuleTask', id: 'rule' })).rejects.toThrow(/Business rule task/);
  await expect(api.connect('decide', 'review', 'bad', { type: 'messageFlow' })).rejects.toThrow(/not allowed/);

  // the canvas shows the result
  await expect(page.locator('.djs-element[data-element-id="notify"]')).toBeVisible();

  const projectDir = testInfo.outputPath('project');
  const { paths, project } = await api.writeProject(projectDir);
  expect(project.files.map((f) => f.path)).toEqual(['project.json', 'processes/Approval.bpmn20.xml', 'processes/Approval-extensions.json']);
  expect(paths).toHaveLength(3);

  const xml = await readFile(`${projectDir}/processes/Approval.bpmn20.xml`, 'utf8');
  expect(xml).toContain('<bpmn:process id="approval" name="Approval" isExecutable="true">');
  expect(xml).toContain('activiti:initiator="applicant"');
  expect(xml).toMatch(/<bpmn:userTask id="review" name="Review request" activiti:assignee="kermit" activiti:candidateGroups="managers,reviewers">/);
  expect(xml).toMatch(/<bpmn:exclusiveGateway id="decide" name="Approved\?" default="flow_default">/);
  expect(xml).toContain('<bpmn:serviceTask id="notify" name="Notify applicant" implementation="mailer.SEND">');
  expect(xml).toMatch(/<bpmn:sequenceFlow id="flow_approved" name="approved" sourceRef="decide" targetRef="notify">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved == true\}<\/bpmn:conditionExpression>/);
  expect(xml).toMatch(/<bpmn:sequenceFlow id="flow_rejected" name="rejected" sourceRef="decide" targetRef="rejected_end">\s*<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{approved == false\}/);
  expect(xml).toMatch(/<bpmn:sequenceFlow id="flow_default" sourceRef="decide" targetRef="rejected_end" \/>/);
  expect(xml).not.toMatch(/camunda|zeebe/i);
  expect(xml.split('\n').length).toBeGreaterThan(30);

  const extensions = JSON.parse(await readFile(`${projectDir}/processes/Approval-extensions.json`, 'utf8'));
  // only fields the Activiti 9.0.0 model classes know: a host without Spring Boot's JSON auto-configuration fails on any other
  // (UnrecognizedPropertyException on an APA-style top-level name / type)
  expect(Object.keys(extensions)).toEqual(['id', 'extensions']);
  expect(extensions.id).toBe('process-Approval');
  expect(findUnknownFields(extensions)).toEqual([]);
  const process = extensions.extensions['approval'];
  // the user task is new, so it flows its completion variables by default (ADR 0006); the connector task has an explicit mapping
  expect(process.mappings.review).toEqual({ mappingType: 'MAP_ALL' });
  expect(process.mappings.notify).toEqual({
    inputs: { to: { type: 'VARIABLE', value: 'applicantEmail' }, subject: { type: 'VALUE', value: 'Your request was approved' } },
    outputs: { notificationId: { type: 'VARIABLE', value: 'messageId' } },
  });
  expect(process.constants.notify).toEqual({ retries: { value: 3 } });
  // the output target is declared (the runtime skips undeclared targets), next to the variables set explicitly
  expect(Object.values(process.properties).map((p) => (p as { name: string; type: string }).name).sort()).toEqual(['applicantEmail', 'approved', 'notificationId']);
  expect((Object.values(process.properties) as Array<{ name: string; type: string }>).find((p) => p.name === 'notificationId')!.type).toBe('string');

  const projectJson = JSON.parse(await readFile(`${projectDir}/project.json`, 'utf8'));
  expect(projectJson).toMatchObject({ name: 'approval-demo', version: '1.0.0', activiti: '9.0.0' });
});

test('refuses what the accessors refuse and what the serializer guarantees forbid', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.createProject('broken');
  await api.newProcess('broken_process', 'Broken');
  await api.createShape({ type: 'userTask', id: 'u' });
  await expect(api.setProperty('u', 'general.id', 'not valid')).rejects.toThrow(/not a valid NCName/);
  await expect(api.setProperty('u', 'impl.class', 'a.B')).rejects.toThrow(/does not apply/);
  await expect(api.setProperty('u', 'no.such.accessor', 1)).rejects.toThrow(/unknown accessor/);

  // an imported model with a Camunda attribute: export fails with a clear error instead of writing the file
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="D" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="foreign" isExecutable="true"><bpmn:userTask id="t" camunda:assignee="kermit" /></bpmn:process>
  <bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="foreign"><bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
  expect((await api.importXml(xml)).warnings).toEqual([]);
  await expect(api.exportProject()).rejects.toThrow(/FOREIGN_ATTRIBUTE/);
  await expect(api.exportProject()).rejects.toThrow(/camunda\.org/);
});

test('keeps several processes of a project and re-opens them with their extensions', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.createProject('multi');
  await api.newProcess('parent', 'Parent');
  await api.createShape({ type: 'startEvent', id: 'p_start' });
  await api.appendShape('p_start', { type: 'callActivity', id: 'call' });
  await api.setProperty('call', 'call.calledElement', 'child');
  await api.setExtensions({ elementId: 'call', mappingType: 'MAP_ALL' });
  await api.newProcess('child', 'Child');
  await api.createShape({ type: 'startEvent', id: 'c_start' });
  await api.openProcess('Parent');
  expect(await api.getProperty('call', 'call.calledElement')).toBe('child');
  const { files } = await api.exportProject();
  expect(files.map((f) => f.path).sort()).toEqual(['processes/Child-extensions.json', 'processes/Child.bpmn20.xml', 'processes/Parent-extensions.json', 'processes/Parent.bpmn20.xml', 'project.json']);
  const parent = JSON.parse(files.find((f) => f.path === 'processes/Parent-extensions.json')!.content);
  expect(parent.extensions.parent.mappings.call).toEqual({ mappingType: 'MAP_ALL' });
});

test('gives new user tasks, call activities and catch events MAP_ALL, switches it off per project, and takes it back with the element on undo', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.createProject('defaults', { defaultMappings: 'none' });
  await api.newProcess('flow', 'Flow');
  await api.createShape({ type: 'userTask', id: 'u1' });
  await api.createShape({ type: 'callActivity', id: 'c1' });
  let { files } = await api.exportProject();
  expect(JSON.parse(files.find((f) => f.path.endsWith('-extensions.json'))!.content).extensions.flow.mappings).toEqual({});

  await api.createProject('defaults-on');
  await api.newProcess('flow', 'Flow');
  await api.createShape({ type: 'userTask', id: 'u1' });
  await api.createShape({ type: 'callActivity', id: 'c1' });
  await api.createShape({ type: 'intermediateCatchEvent', id: 'm1', eventDefinition: 'message' });
  await api.createShape({ type: 'intermediateThrowEvent', id: 't1', eventDefinition: 'message' });
  await api.createShape({ type: 'serviceTask', id: 's1' });
  ({ files } = await api.exportProject());
  expect(JSON.parse(files.find((f) => f.path.endsWith('-extensions.json'))!.content).extensions.flow.mappings).toEqual({
    u1: { mappingType: 'MAP_ALL' },
    c1: { mappingType: 'MAP_ALL' },
    m1: { mappingType: 'MAP_ALL' },
  });
  // one undo takes the element and its mapping away together
  await api.undo();
  await api.undo();
  await api.undo();
  ({ files } = await api.exportProject());
  expect(JSON.parse(files.find((f) => f.path.endsWith('-extensions.json'))!.content).extensions.flow.mappings).toEqual({ u1: { mappingType: 'MAP_ALL' }, c1: { mappingType: 'MAP_ALL' } });
});

test('warns about extensions fields the runtime does not know when a file is opened, and drops them when it is exported', async ({ page }) => {
  const api = await ModelerApi.open(page);
  await api.createProject('apa');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="apaProcess" isExecutable="true"><bpmn:userTask id="t" /></bpmn:process>
  <bpmndi:BPMNDiagram id="BD"><bpmndi:BPMNPlane id="BP" bpmnElement="apaProcess"><bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
  const apaStyle = JSON.stringify({ id: 'process-1', type: 'PROCESS', name: 'apa', extensions: { apaProcess: { properties: {}, mappings: { t: { mappingType: 'MAP_ALL', note: 1 } }, constants: {} } } });
  const { warnings } = await api.importXml(xml, apaStyle);
  expect(warnings).toEqual([
    'apaProcess-extensions.json: field $.type is not known to Activiti 9.0.0 and will be dropped on export',
    'apaProcess-extensions.json: field $.name is not known to Activiti 9.0.0 and will be dropped on export',
    'apaProcess-extensions.json: field $.extensions.apaProcess.mappings.t.note is not known to Activiti 9.0.0 and will be dropped on export',
  ]);
  const project = await api.exportProject();
  expect(project.warnings.filter((w) => w.includes('dropped field'))).toHaveLength(3);
  const written = JSON.parse(project.files.find((f) => f.path.endsWith('-extensions.json'))!.content);
  expect(written).toEqual({ id: 'process-1', extensions: { apaProcess: { properties: {}, mappings: { t: { mappingType: 'MAP_ALL' } }, constants: {} } } });
  // the imported user task keeps exactly the mapping it had; nothing is added
  expect(findUnknownFields(written)).toEqual([]);
});
