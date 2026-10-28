import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import type { ModdleElement } from '../../types';

let t: Built | undefined;
afterEach(() => t?.destroy());

const definitionOf = (b: Built, id: string): ModdleElement => (b.element(id).businessObject.get('eventDefinitions') as ModdleElement[])[0]!;
const sourceIds = (b: Built, id: string): string[] => ((definitionOf(b, id).get('source') as ModdleElement[] | undefined) ?? []).map((s) => s.id as string);

async function twoThrowsOneCatch(): Promise<Built> {
  const b = await createBuilt();
  b.builder.createShape({ type: 'intermediateThrowEvent', id: 'jumpA', eventDefinition: 'link' });
  b.builder.createShape({ type: 'intermediateThrowEvent', id: 'jumpB', eventDefinition: 'link' });
  b.builder.createShape({ type: 'intermediateCatchEvent', id: 'entry', eventDefinition: 'link' });
  b.builder.createShape({ type: 'intermediateCatchEvent', id: 'otherEntry', eventDefinition: 'link' });
  for (const id of ['jumpA', 'jumpB', 'entry', 'otherEntry']) b.builder.setProperty(id, 'event.definitionId', `${id}Def`);
  b.commandStack.clear();
  return b;
}

describe('link events', () => {
  it('writes both ends of a link, with the ids the XML refers to', async () => {
    t = await twoThrowsOneCatch();
    t.builder.setProperty('jumpA', 'link.target', 'entry');
    t.builder.setProperty('jumpB', 'link.target', 'entry');
    t.builder.setProperty('jumpA', 'link.name', 'Pay');
    expect(t.builder.getProperty('jumpA', 'link.target')).toBe('entry');
    expect(sourceIds(t, 'entry')).toEqual(['jumpADef', 'jumpBDef']);
    const { xml } = await t.builder.export('links');
    expect(xml).toMatch(/<bpmn:linkEventDefinition id="entryDef">\s*<bpmn:source>jumpADef<\/bpmn:source>\s*<bpmn:source>jumpBDef<\/bpmn:source>\s*<\/bpmn:linkEventDefinition>/);
    expect(xml).toMatch(/<bpmn:linkEventDefinition id="jumpADef" name="Pay">\s*<bpmn:target>entryDef<\/bpmn:target>/);
  });

  it('moves a throw event to another catch event, removing it from the old source list; one undo per change', async () => {
    t = await twoThrowsOneCatch();
    t.builder.setProperty('jumpA', 'link.target', 'entry');
    t.builder.setProperty('jumpA', 'link.target', 'otherEntry');
    expect(sourceIds(t, 'entry')).toEqual([]);
    expect(sourceIds(t, 'otherEntry')).toEqual(['jumpADef']);
    t.commandStack.undo();
    expect(sourceIds(t, 'entry')).toEqual(['jumpADef']);
    expect(sourceIds(t, 'otherEntry')).toEqual([]);
    expect(t.builder.getProperty('jumpA', 'link.target')).toBe('entry');
    t.commandStack.redo();
    expect(t.builder.getProperty('jumpA', 'link.target')).toBe('otherEntry');
  });

  it('clears the link when the target is set to undefined', async () => {
    t = await twoThrowsOneCatch();
    t.builder.setProperty('jumpA', 'link.target', 'entry');
    t.builder.setProperty('jumpA', 'link.target', undefined);
    expect(t.builder.getProperty('jumpA', 'link.target')).toBeUndefined();
    expect(sourceIds(t, 'entry')).toEqual([]);
  });

  it('removes a deleted throw event from the source list and a deleted catch event from the throw events, undoably', async () => {
    t = await twoThrowsOneCatch();
    t.builder.setProperty('jumpA', 'link.target', 'entry');
    t.builder.setProperty('jumpB', 'link.target', 'entry');
    t.commandStack.clear();
    t.modeling.removeElements([t.element('jumpA')]);
    expect(sourceIds(t, 'entry')).toEqual(['jumpBDef']);
    t.commandStack.undo();
    expect(sourceIds(t, 'entry')).toEqual(['jumpADef', 'jumpBDef']);
    expect(t.registry.get('jumpA')).toBeDefined();

    t.modeling.removeElements([t.element('entry')]);
    expect(t.builder.getProperty('jumpA', 'link.target')).toBeUndefined();
    expect(t.builder.getProperty('jumpB', 'link.target')).toBeUndefined();
    const { xml } = await t.builder.export('links');
    expect(xml).not.toContain('entryDef');
    t.commandStack.undo();
    expect(t.builder.getProperty('jumpA', 'link.target')).toBe('entry');
  });

  it('survives a delete of both ends at once', async () => {
    t = await twoThrowsOneCatch();
    t.builder.setProperty('jumpA', 'link.target', 'entry');
    t.modeling.removeElements([t.element('jumpA'), t.element('entry')]);
    const { xml } = await t.builder.export('links');
    expect(xml).not.toMatch(/<bpmn:(source|target)>/);
  });

  it('refuses a target that is not a link catch event, and applies to link throw events only', async () => {
    t = await twoThrowsOneCatch();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'timerCatch', eventDefinition: 'timer' });
    expect(() => t!.builder.setProperty('jumpA', 'link.target', 'timerCatch')).toThrow(/not a link catch event/);
    expect(() => t!.builder.setProperty('jumpA', 'link.target', 'jumpB')).toThrow(/not a link catch event/);
    expect(() => t!.builder.setProperty('entry', 'link.target', 'otherEntry')).toThrow(/does not apply/);
  });
});

describe('ids of nested elements', () => {
  it('keeps the id registry exact through undo and redo of an event definition id', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'timer' });
    const ids = t.get<{ ids: { assigned(id: string): unknown } }>('moddle').ids;
    const old = definitionOf(t, 'wait').id as string;
    t.builder.setProperty('wait', 'event.definitionId', 'waitTimer');
    expect(ids.assigned('waitTimer')).toBeTruthy();
    expect(ids.assigned(old)).toBeFalsy();
    t.commandStack.undo();
    expect(ids.assigned('waitTimer')).toBeFalsy();
    expect(ids.assigned(old)).toBeTruthy();
    // the id is free again, so another element can take it
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'waitTimer', eventDefinition: 'timer' });
    expect(() => t!.builder.setProperty('wait', 'event.definitionId', 'waitTimer')).toThrow(/already used/);
  });

  it('names the data object of a reference apart from the reference itself', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'dataObjectReference', id: 'regionRef' });
    t.builder.setProperty('regionRef', 'data.id', 'regionObject');
    t.builder.setProperty('regionRef', 'data.name', 'region');
    t.builder.setProperty('regionRef', 'data.type', 'xsd:string');
    t.builder.setProperty('regionRef', 'data.value', 'EU');
    expect(t.builder.getProperty('regionRef', 'data.id')).toBe('regionObject');
    const { xml } = await t.builder.export('data');
    expect(xml).toMatch(/<bpmn:dataObject id="regionObject" name="region" itemSubjectRef="xsd:string">\s*<bpmn:extensionElements>\s*<activiti:value>EU<\/activiti:value>/);
    expect(xml).toContain('dataObjectRef="regionObject"');
    // the prefix of itemSubjectRef is declared, or the engine parser rejects the whole deployment (UndeclaredPrefix)
    expect(xml).toContain('xmlns:xsd="http://www.w3.org/2001/XMLSchema"');
  });

  it('declares the xsd prefix with the type, once, and takes it back with an undo', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'dataObjectReference', id: 'ref' });
    expect((await t.builder.export('d')).xml).not.toContain('xmlns:xsd');
    t.builder.setProperty('ref', 'data.type', 'xsd:int');
    t.builder.setProperty('ref', 'data.type', 'xsd:string');
    expect((await t.builder.export('d')).xml.match(/xmlns:xsd=/g)).toHaveLength(1);
    t.commandStack.undo();
    t.commandStack.undo();
    expect((await t.builder.export('d')).xml).not.toContain('xmlns:xsd');
  });
});

describe('definitions-level lists with chosen ids', () => {
  it('creates a message with the id given, reuses it by name for events, and refuses a bad or used id', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'wait', eventDefinition: 'message' });
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }]);
    t.builder.setProperty('wait', 'message.ref', 'approveOrder');
    const { xml } = await t.builder.export('messages');
    expect(xml).toContain('<bpmn:message id="approveMessage" name="approveOrder" />');
    expect(xml).toContain('messageRef="approveMessage"');
    expect(xml.match(/<bpmn:message /g)).toHaveLength(1);
    expect(() => t!.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }, { id: 'bad id', name: 'x' }])).toThrow(/not a valid NCName/);
    expect(() => t!.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'approveMessage', name: 'approveOrder' }, { id: 'wait', name: 'x' }])).toThrow(/already used/);
    expect(t.builder.getProperty('Process_1', 'definitions.messages')).toEqual([{ id: 'approveMessage', name: 'approveOrder' }]);
  });
});

describe('data objects of a container (no shape, no diagram interchange)', () => {
  it('creates, updates and removes data objects of a process, one undo step each', async () => {
    t = await createBuilt();
    const set = (value: unknown[]): void => t!.builder.setProperty('Process_1', 'data.objects', value);
    set([{ id: 'regionObject', name: 'region', type: 'xsd:string', value: 'EU' }]);
    const { xml } = await t.builder.export('d');
    expect(xml).toMatch(/<bpmn:dataObject id="regionObject" name="region" itemSubjectRef="xsd:string">\s*<bpmn:extensionElements>\s*<activiti:value>EU<\/activiti:value>/);
    // nothing is drawn: the diagram interchange knows nothing of the data object, which Activiti 9 would report as DI_INVALID_REFERENCE
    expect(xml).not.toContain('regionObject_di');
    expect(xml).not.toContain('dataObjectReference');

    set([{ id: 'regionObject', name: 'region', type: 'xsd:string', value: 'US' }, { name: 'limit', type: 'xsd:int' }]);
    const list = t.builder.getProperty('Process_1', 'data.objects') as Array<{ id: string; name: string; type?: string; value?: string }>;
    expect(list.map((d) => [d.name, d.type, d.value])).toEqual([['region', 'xsd:string', 'US'], ['limit', 'xsd:int', undefined]]);
    expect(list[1]!.id).toMatch(/^DataObject_/);

    set([{ id: 'regionObject', name: 'region' }]);
    expect(t.builder.getProperty('Process_1', 'data.objects')).toEqual([{ id: 'regionObject', name: 'region' }]);
    t.commandStack.undo();
    expect((t.builder.getProperty('Process_1', 'data.objects') as unknown[]).length).toBe(2);
    t.commandStack.undo();
    expect((t.builder.getProperty('Process_1', 'data.objects') as Array<{ value: string }>)[0]!.value).toBe('EU');
    t.commandStack.undo();
    expect(t.builder.getProperty('Process_1', 'data.objects')).toEqual([]);
  });

  it('puts data objects into a sub process and into the process of a pool, and keeps the ids unique across the diagram', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'subProcess', id: 'sub' });
    t.builder.setProperty('sub', 'data.objects', [{ id: 'scoreObject', name: 'subScore', type: 'xsd:int', value: '7' }]);
    expect((await t.builder.export('d')).xml).toMatch(/<bpmn:subProcess id="sub">[\s\S]*<bpmn:dataObject id="scoreObject" name="subScore"[\s\S]*<\/bpmn:subProcess>/);
    expect(() => t!.builder.setProperty('Process_1', 'data.objects', [{ id: 'scoreObject', name: 'other' }])).toThrow(/already used/);
  });

  it('refuses to remove a data object that is drawn, and says which shape to delete', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'dataObjectReference', id: 'ref' });
    const [object] = t.builder.getProperty('Process_1', 'data.objects') as Array<{ id: string; name: string }>;
    expect(object).toBeDefined();
    expect(() => t!.builder.setProperty('Process_1', 'data.objects', [])).toThrow(/is drawn as ref; delete the shape first/);
    expect(t.builder.getProperty('Process_1', 'data.objects')).toHaveLength(1);
  });

  it('warns on export about a drawn data object, whose shape Activiti 9 reports as an invalid diagram reference', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'dataObjectReference', id: 'ref' });
    const out = await t.builder.export('d');
    expect(out.warnings.join('\n')).toMatch(/dataObjectReference "ref".*DI_INVALID_REFERENCE/);
  });
});
