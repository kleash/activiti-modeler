import { afterEach, describe, expect, it } from 'vitest';

import { importProcess } from '../../export';
import { createBuilt, type Built } from '../../../test-support/builder';
import { type ExtensionsStore } from '../extensions';
import { ACCESSORS, type PropertyAccessors, AccessorError } from '.';
import { ACCESSOR_CASES, SCENE, type AccessorCase } from './accessor-cases';

let t: Built | undefined;
let again: Built | undefined;
afterEach(() => {
  t?.destroy();
  again?.destroy();
  t = again = undefined;
});

// naming a shape leaves an empty BPMNLabel in the DI after undo; it carries no information
const normalize = (xml: string | undefined): string => (xml ?? '').replace(/<bpmndi:BPMNLabel\b[^>]*?(?:\/>|>[\s\S]*?<\/bpmndi:BPMNLabel>)/g, '').replace(/\n\s*\n/g, '\n');

async function state(b: Built): Promise<{ xml: string; json: string }> {
  return { xml: normalize((await b.modeler.saveXML({ format: true })).xml), json: JSON.stringify(b.get<ExtensionsStore>('extensionsStore').model) };
}

async function build(c: AccessorCase): Promise<Built> {
  const b = await createBuilt();
  for (const need of c.needs ?? []) SCENE[need]!(b.builder);
  c.prepare?.(b.builder);
  return b;
}

const accessors = (b: Built): PropertyAccessors => b.get<PropertyAccessors>('propertyAccessors');

function checkGet(actual: unknown, c: AccessorCase): void {
  const expected = 'get' in c ? c.get : c.value;
  if (typeof expected === 'function') (expected as (v: unknown) => void)(actual);
  else expect(actual).toEqual(expected);
}

const matches = (xml: string, pattern: string | RegExp): boolean => (typeof pattern === 'string' ? xml.includes(pattern) : pattern.test(xml));

describe('property accessors: one case per accessor', () => {
  it('has a case for every accessor and no case for an unknown one', () => {
    const keys = new Set(ACCESSORS.map((a) => a.key));
    const cases = new Set(ACCESSOR_CASES.map((c) => c.key));
    expect([...keys].filter((k) => !cases.has(k))).toEqual([]);
    expect([...cases].filter((k) => !keys.has(k))).toEqual([]);
    expect(ACCESSOR_CASES.length).toBeGreaterThanOrEqual(keys.size);
    // the core set of FEATURE_MATRIX §B
    expect(keys.size).toBeGreaterThanOrEqual(110);
  });

  it('puts every accessor in a FEATURE_MATRIX §B group and says whether it writes XML or the extensions JSON', () => {
    const groups = new Set(ACCESSORS.map((a) => a.group));
    for (const group of [
      'General', 'Documentation', 'Candidate starters', 'Process variables', 'Messages / Signals / Errors', 'Event listeners', 'Execution listeners',
      'Start initiator / form', 'User assignment', 'Form', 'Task listeners', 'Implementation', 'Field injection', 'Mail / Shell fields', 'Decision',
      'Input / output mapping', 'Constants', 'Template', 'Script', 'Called element', 'Multi-instance', 'Asynchronous continuation', 'Job execution', 'Error mapping',
      'Timer', 'Message / Signal / Error / Link / Compensation / Terminate', 'Condition', 'Data object', 'Skip expression', 'Event definitions',
    ]) {
      expect(groups.has(group), group).toBe(true);
    }
    expect(ACCESSORS.filter((a) => (a as { writes: string }).writes === 'ext').map((a) => a.key).sort()).toEqual(
      ['constants.values', 'decision.info', 'decision.pick', 'decision.table', 'mapping.ephemeral', 'mapping.inputs', 'mapping.outputs', 'mapping.type', 'variables.list', 'variables.usage'],
    );
  });

  describe.each(ACCESSOR_CASES.map((c) => [c.key, c] as const))('%s', (_key, c) => {
    it('writes exactly the expected XML / JSON, returns the value after a re-import, and undo / redo restore it', async () => {
      t = await build(c);
      const before = await state(t);
      accessors(t).set(c.element, c.key, c.value);
      const after = await state(t);
      const exported = await t.builder.export('case');

      for (const pattern of c.xml ?? []) expect(matches(exported.xml, pattern), `XML lacks ${String(pattern)}\n${exported.xml}`).toBe(true);
      for (const pattern of c.notXml ?? []) expect(matches(exported.xml, pattern), `XML must not contain ${String(pattern)}`).toBe(false);
      if (c.json) c.json(JSON.parse(exported.extensionsJson).extensions['Process_1']);
      // no camunda / zeebe artefacts, whatever the accessor does
      expect(exported.xml).not.toMatch(/camunda|zeebe/i);

      const id = c.idAfter ?? c.element;
      checkGet(accessors(t).get(id, c.key), c);

      // get after import: a fresh modeler loaded with the exported files
      again = await createBuilt();
      await importProcess(again.modeler as never, { xml: exported.xml, extensionsJson: exported.extensionsJson });
      checkGet(accessors(again).get(id, c.key), c);
      // and the files survive a second export unchanged
      const second = await again.builder.export('case');
      expect(second.xml).toBe(exported.xml);
      expect(second.extensionsJson).toBe(exported.extensionsJson);

      // undo restores the state before, redo the state after
      t.commandStack.undo();
      expect(await state(t)).toEqual(before);
      t.commandStack.redo();
      expect(await state(t)).toEqual(after);
    });

    it.each((c.invalid ?? []).map((i) => [JSON.stringify(i[0]).slice(0, 60), i] as const))('refuses %s without changing anything', async (_label, [value, message]) => {
      t = await build(c);
      const before = await state(t);
      const undoable = t.commandStack.canUndo();
      let error: unknown;
      try {
        accessors(t).set(c.element, c.key, value);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AccessorError);
      expect((error as Error).message).toMatch(message);
      expect(await state(t)).toEqual(before);
      // the failed attempt leaves nothing to undo or redo
      expect(t.commandStack.canUndo()).toBe(undoable);
      expect(t.commandStack.canRedo()).toBe(false);
    });
  });
});

describe('PropertyAccessors service', () => {
  it('applies accessors by element type and refuses the others', async () => {
    t = await createBuilt();
    SCENE['svc']!(t.builder);
    SCENE['u']!(t.builder);
    const service = accessors(t);
    expect(service.has('u', 'user.assignee')).toBe(true);
    expect(service.has('svc', 'user.assignee')).toBe(false);
    expect(() => service.set('svc', 'user.assignee', 'x')).toThrow('does not apply');
    expect(() => service.get('svc', 'user.assignee')).toThrow('does not apply');
    expect(() => service.set('nope', 'general.name', 'x')).toThrow('no element with id nope');
    expect(() => service.accessor('no.such.key')).toThrow('unknown accessor');
    expect(service.applicable('u').map((a) => a.key)).toContain('user.assignee');
    expect(service.applicable('u').map((a) => a.key)).not.toContain('impl.class');
    expect(service.keys()).toEqual(ACCESSORS.map((a) => a.key));
  });

  it('limits the job and error-mapping groups to the elements the engine honours them on', async () => {
    t = await createBuilt();
    for (const id of ['u', 'svc', 'svcc', 'call', 'script']) SCENE[id]!(t.builder);
    const service = accessors(t);
    // failedJobRetryTimeCycle: service tasks only (R1 §3, lint L31)
    expect(['u', 'svc', 'svcc', 'call', 'script'].filter((id) => service.has(id, 'job.failedJobRetryTimeCycle'))).toEqual(['svc', 'svcc']);
    // mapException: activiti:class service tasks and call activities only (lint L32)
    expect(['u', 'svc', 'svcc', 'call', 'script'].filter((id) => service.has(id, 'errors.mapExceptions'))).toEqual(['svcc', 'call']);
  });

  it('writes a mapException without an exception class: the default entry that maps every other exception (C08)', async () => {
    t = await createBuilt();
    SCENE['svcc']!(t.builder);
    const service = accessors(t);
    service.set('svcc', 'errors.mapExceptions', [
      { errorCode: 'ILLEGAL_STATE', exceptionClass: 'java.lang.IllegalStateException' },
      { errorCode: 'UNEXPECTED', exceptionClass: '' },
    ]);
    const { xml } = await t.builder.export('c');
    expect(xml).toMatch(/<activiti:mapException errorCode="ILLEGAL_STATE">java\.lang\.IllegalStateException<\/activiti:mapException>/);
    expect(xml).toMatch(/<activiti:mapException errorCode="UNEXPECTED"\s*\/>/);
    expect(service.get('svcc', 'errors.mapExceptions')).toEqual([
      { errorCode: 'ILLEGAL_STATE', exceptionClass: 'java.lang.IllegalStateException', includeChildExceptions: false },
      { errorCode: 'UNEXPECTED', exceptionClass: '', includeChildExceptions: false },
    ]);
    expect(() => service.set('svcc', 'errors.mapExceptions', [{ errorCode: '', exceptionClass: '' }])).toThrow(/needs an errorCode/);
  });

  it('refuses event types the support matrix does not offer in that place', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'subProcess', id: 'esp', triggeredByEvent: true });
    t.builder.createShape({ type: 'startEvent', id: 'esp_start', parent: 'esp', eventDefinition: 'message', allowHidden: true });
    t.builder.createShape({ type: 'endEvent', id: 'plainEnd' });
    const service = accessors(t);
    expect(() => service.set('esp_start', 'event.definition', 'signal')).toThrow(/Signal or timer start in an event sub process/);
    expect(() => service.set('esp_start', 'event.definition', 'timer')).toThrow(/allowed here: message, error/);
    expect(() => service.set('plainEnd', 'event.definition', 'cancel')).toThrow(/not offered in a process/);
    service.set('esp_start', 'event.definition', 'error');
    expect(service.get('esp_start', 'event.definition')).toBe('error');
    service.set('plainEnd', 'event.definition', 'terminate');
    expect(service.get('plainEnd', 'event.definition')).toBe('terminate');
    service.set('plainEnd', 'event.definition', 'none');
    expect(service.get('plainEnd', 'event.definition')).toBe('none');
  });

  it('describes the switch of implementation types as one undo step and keeps the id', async () => {
    t = await createBuilt();
    SCENE['svc']!(t.builder);
    const service = accessors(t);
    service.set('svc', 'impl.type', 'class');
    service.set('svc', 'impl.class', 'a.B');
    service.set('svc', 'impl.type', 'expression');
    expect(service.get('svc', 'impl.type')).toBe('expression');
    expect(service.get('svc', 'impl.class')).toBeUndefined();
    t.commandStack.undo();
    expect(service.get('svc', 'impl.type')).toBe('class');
    expect(service.get('svc', 'impl.class')).toBe('a.B');
  });
});

describe('multi-instance in the standard form (loopDataInputRef / inputDataItem)', () => {
  // a loop as another tool or a hand-written file names its collection and element: the engine reads these into the fields that
  // activiti:collection and activiti:elementVariable fill, and reads the elements after the attributes (engine finding 3)
  const STANDARD = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:userTask id="u" activiti:assignee="\${person}">
      <bpmn:multiInstanceLoopCharacteristics isSequential="true">
        <bpmn:loopDataInputRef>people</bpmn:loopDataInputRef>
        <bpmn:inputDataItem name="person" />
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="Process_1">
    <bpmndi:BPMNShape id="u_di" bpmnElement="u"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

  it('the collection and the element variable fields show the standard form, which is kept as it is', async () => {
    t = await createBuilt(STANDARD);
    expect(accessors(t).get('u', 'mi.collection')).toBe('people');
    expect(accessors(t).get('u', 'mi.elementVariable')).toBe('person');
    const { xml } = await t.builder.export('standard');
    expect(xml).toMatch(/<bpmn:loopDataInputRef>people<\/bpmn:loopDataInputRef>\s*<bpmn:inputDataItem name="person" \/>/);
    expect(xml).not.toContain('activiti:collection');
  });

  it('a value written replaces the standard element, which the engine would read instead, each in one undo step', async () => {
    t = await createBuilt(STANDARD);
    const service = accessors(t);
    service.set('u', 'mi.collection', 'reviewers');
    service.set('u', 'mi.elementVariable', 'reviewer');
    expect(service.get('u', 'mi.collection')).toBe('reviewers');
    expect(service.get('u', 'mi.elementVariable')).toBe('reviewer');
    const { xml } = await t.builder.export('written');
    expect(xml).toMatch(/<bpmn:multiInstanceLoopCharacteristics isSequential="true" activiti:collection="reviewers" activiti:elementVariable="reviewer" \/>/);
    expect(xml).not.toMatch(/loopDataInputRef|inputDataItem/);
    t.commandStack.undo();
    expect(service.get('u', 'mi.elementVariable')).toBe('person');
    expect(service.get('u', 'mi.collection')).toBe('reviewers');
    t.commandStack.undo();
    expect(service.get('u', 'mi.collection')).toBe('people');
    expect((await t.builder.export('undone')).xml).toMatch(/<bpmn:loopDataInputRef>people<\/bpmn:loopDataInputRef>\s*<bpmn:inputDataItem name="person" \/>/);
  });
});
