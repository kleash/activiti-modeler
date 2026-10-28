import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIVITI_CHECKLIST, ACTIVITI_NAMESPACE, activitiDmnModdleDescriptor, activitiModdleDescriptor } from '../src';
import { createModdle, exportXml, importXml, walk } from './support/moddle';

const ROOT = join(__dirname, '..');
const wrap = (body: string, defs = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn" id="D" targetNamespace="http://activiti.org/bpmn">${defs}
<process id="P" isExecutable="true">${body}</process></definitions>`;

describe('descriptor', () => {
  it('is the activiti package', () => {
    expect(activitiModdleDescriptor).toMatchObject({ name: 'Activiti', prefix: 'activiti', uri: ACTIVITI_NAMESPACE.uri });
    expect(activitiModdleDescriptor.xml.tagAlias).toBe('lowerCase');
  });

  it('contains no Camunda or Zeebe namespace, type or property', () => {
    for (const source of [
      JSON.stringify(activitiModdleDescriptor),
      JSON.stringify(activitiDmnModdleDescriptor),
      readFileSync(join(ROOT, 'support/activiti-attributes.json'), 'utf8'),
      readFileSync(join(ROOT, 'src/generated/types.ts'), 'utf8'),
    ]) {
      expect(source).not.toMatch(/camunda/i);
      expect(source).not.toMatch(/zeebe/i);
    }
  });

  it('drops the Camunda-only concepts of the upstream activiti descriptor', () => {
    const names = new Set((activitiModdleDescriptor.types as Array<{ name: string }>).map((t) => t.name));
    for (const removed of ['Connector', 'InputOutput', 'InputParameter', 'OutputParameter', 'DmnCapable', 'ExternalCapable', 'JobPriorized', 'TaskPriorized', 'FormData', 'FormField', 'Properties']) {
      expect(names.has(removed), removed).toBe(false);
    }
    const attributes = new Set<string>();
    for (const type of activitiModdleDescriptor.types as Array<{ properties: Array<{ name: string }> }>) {
      for (const p of type.properties) attributes.add(p.name);
    }
    for (const removed of ['asyncBefore', 'asyncAfter', 'jobPriority', 'historyTimeToLive', 'versionTag', 'followUpDate', 'topic', 'decisionRef', 'variables', 'local']) {
      expect(attributes.has(removed), removed).toBe(false);
    }
  });

  it('is in sync with the generated TypeScript types', () => {
    expect(() => execFileSync('node', [join(ROOT, 'scripts/generate-types.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('registers cleanly and every defined type resolves', () => {
    const moddle = createModdle();
    for (const type of activitiModdleDescriptor.types as Array<{ name: string }>) {
      expect(() => moddle.getTypeDescriptor(`activiti:${type.name}`), type.name).not.toThrow();
    }
  });

  it('has checklist entries for the unqualified attributes of the extension elements', () => {
    const modeled = new Set(ACTIVITI_CHECKLIST.entries.filter((e) => e.kind === 'attribute' && e.namespace === 'none').map((e) => `${e.element}@${e.name}`));
    for (const id of ['executionListener@onTransaction', 'eventListener@throwEvent', 'in@sourceExpression', 'customResource@name']) {
      expect(modeled.has(id), id).toBe(true);
    }
  });
});

describe('serialisation the Activiti parser depends on', () => {
  it('writes loopDataInputRef / loopDataOutputRef as plain variable names in the BPMN namespace', async () => {
    const xml = wrap(`<userTask id="u">
<multiInstanceLoopCharacteristics activiti:collection="people" activiti:elementVariable="person">
<loopDataInputRef>people</loopDataInputRef><loopDataOutputRef>results</loopDataOutputRef><outputDataItem name="res"/>
</multiInstanceLoopCharacteristics>
</userTask>`);
    const imported = await importXml(xml);
    const mi = walk(imported.definitions).find((e) => e.$type === 'bpmn:MultiInstanceLoopCharacteristics')!;
    expect(mi.get('loopDataInputRef')).toBe('people');
    expect(mi.get('loopDataOutputRef')).toBe('results');
    const out = await exportXml(imported);
    expect(out).toContain('<loopDataInputRef>people</loopDataInputRef>');
    expect(out).toContain('<loopDataOutputRef>results</loopDataOutputRef>');
    expect(out).not.toContain('activiti:loopData');
  });

  it('writes <formalExpression> inside resource assignments (Activiti matches that name)', async () => {
    const moddle = createModdle();
    const { rootElement } = await moddle.fromXML(wrap('<userTask id="u"/>'));
    const process = (rootElement.get('rootElements') as Array<{ get(n: string): unknown[] }>)[0]!;
    const task = (process.get('flowElements') as Array<{ get(n: string): unknown; set(n: string, v: unknown): void }>)[0]!;
    const expression = moddle.create('bpmn:FormalExpression', { body: 'user(kermit)' });
    const assignment = moddle.create('bpmn:ResourceAssignmentExpression', { formalExpression: expression });
    const performer = moddle.create('bpmn:HumanPerformer', { resourceAssignmentExpression: assignment });
    task.set('resources', [performer]);
    const { xml } = await moddle.toXML(rootElement, { format: true });
    expect(xml).toMatch(/<humanPerformer>\s*<resourceAssignmentExpression>\s*<formalExpression>user\(kermit\)<\/formalExpression>/);
    expect(xml).not.toContain('xsi:type');
  });

  it('keeps data object types as the strings Activiti parses, without resolving them as references', async () => {
    const xml = wrap('<dataObject id="d" name="amount" itemSubjectRef="xsd:int"><extensionElements><activiti:value>5</activiti:value></extensionElements></dataObject>');
    const imported = await importXml(xml);
    expect(imported.result.warnings).toEqual([]);
    const out = await exportXml(imported);
    expect(out).toContain('itemSubjectRef="xsd:int"');
    expect(out).toContain('<activiti:value>5</activiti:value>');
  });

  it('writes activiti attributes qualified on BPMN elements and unqualified on activiti elements', async () => {
    const imported = await importXml(wrap(`<serviceTask id="s" activiti:class="a.B" activiti:async="true" activiti:exclusive="false">
<extensionElements><activiti:field name="to"><activiti:string>a@b</activiti:string></activiti:field>
<activiti:executionListener event="start" expression="\${x}" onTransaction="committed"/></extensionElements></serviceTask>`));
    const out = await exportXml(imported);
    expect(out).toContain('activiti:class="a.B"');
    expect(out).toContain('activiti:async="true"');
    expect(out).toContain('activiti:exclusive="false"');
    expect(out).toContain('<activiti:field name="to">');
    expect(out).toContain('<activiti:executionListener event="start" expression="${x}" onTransaction="committed" />');
  });

  it('keeps both field value forms (child element and attribute)', async () => {
    const xml = wrap(`<serviceTask id="s" activiti:class="a.B"><extensionElements>
<activiti:field name="a" stringValue="x"/><activiti:field name="b" expression="\${y}"/>
<activiti:field name="c"><activiti:expression>\${z}</activiti:expression></activiti:field></extensionElements></serviceTask>`);
    const out = await exportXml(await importXml(xml));
    expect(out).toContain('<activiti:field name="a" stringValue="x" />');
    expect(out).toContain('<activiti:field name="b" expression="${y}" />');
    expect(out).toContain('<activiti:expression>${z}</activiti:expression>');
  });

  it('keeps an unqualified skipExpression on a flow readable (the engine accepts it, R1 §2.3)', async () => {
    const imported = await importXml(wrap('<task id="a"/><task id="b"/><sequenceFlow id="f" sourceRef="a" targetRef="b" skipExpression="${true}"/>'));
    expect(imported.result.warnings).toEqual([]);
    const flow = walk(imported.definitions).find((e) => e.$type === 'bpmn:SequenceFlow')!;
    expect(flow.get('activiti:skipExpression')).toBe('${true}');
  });

  it('keeps foreign attributes and elements as opaque data, without interpreting them', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:c="urn:foreign" id="D" targetNamespace="x">
<process id="P" isExecutable="true"><userTask id="u" c:assignee="kermit"><extensionElements><c:inputOutput><c:inputParameter name="a">1</c:inputParameter></c:inputOutput></extensionElements></userTask></process></definitions>`;
    const imported = await importXml(xml);
    expect(imported.result.warnings).toEqual([]);
    const task = walk(imported.definitions).find((e) => e.$type === 'bpmn:UserTask')!;
    expect(task.get('activiti:assignee')).toBeUndefined();
    expect(task.$attrs['c:assignee']).toBe('kermit');
    const out = await exportXml(imported);
    expect(out).toContain('c:assignee="kermit"');
    expect(out).toContain('<c:inputParameter name="a">1</c:inputParameter>');
  });
});
