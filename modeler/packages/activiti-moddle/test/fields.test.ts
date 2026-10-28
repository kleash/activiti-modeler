import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIVITI_CHECKLIST } from '../src';
import { exportXml, importXml } from './support/moddle';
import { lostFacts } from './support/xml-facts';

/**
 * Activiti 9.0.0 reads `activiti:field` in two places: inside `extensionElements` and as a direct child of the element.
 * BpmnXMLUtil.parseChildElements runs the registered child parser in either place, and FieldExtensionParser.accepts()
 * lists the parents (service task, send task, execution / task listener, message event definition). The moddle has to
 * import both forms without a warning and without losing a field.
 */
const FIXTURES = join(__dirname, 'fixtures/fields');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('activiti:field on a message event definition, service task and send task', () => {
  it.each(['message_field_extension_elements.bpmn20.xml', 'message_field_direct_child.bpmn20.xml'])('%s imports without warnings and round-trips without losing a fact', async (file) => {
    const xml = read(file);
    const imported = await importXml(xml);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);
    const out = await exportXml(imported);
    expect(lostFacts(xml, out)).toEqual([]);
    expect(await exportXml(await importXml(out))).toBe(out);
  });

  it('puts a field inside extensionElements into the extension values, and a direct one into `fields`', async () => {
    const inside = await importXml(read('message_field_extension_elements.bpmn20.xml'));
    const definition = (find(inside.definitions, 'throwTagged').get('eventDefinitions') as Array<{ get(n: string): unknown }>)[0]!;
    const values = (definition.get('extensionElements') as { get(n: string): Array<{ $type: string }> }).get('values');
    expect(values.map((v) => v.$type)).toEqual(['activiti:Field', 'activiti:Field']);
    expect(definition.get('activiti:fields')).toEqual([]);

    const direct = await importXml(read('message_field_direct_child.bpmn20.xml'));
    const directDefinition = (find(direct.definitions, 'throwTagged').get('eventDefinitions') as Array<{ get(n: string): unknown }>)[0]!;
    expect((directDefinition.get('activiti:fields') as Array<{ name: string }>).map((f) => f.name)).toEqual(['tag', 'note']);
    expect(directDefinition.get('extensionElements')).toBeUndefined();
  });

  it('records in the checklist that the engine reads the field in both places', () => {
    const fieldEntries = ACTIVITI_CHECKLIST.entries.filter((e) => e.kind === 'element' && e.name === 'field');
    expect(fieldEntries.map((e) => e.element).sort()).toEqual(['executionListener', 'messageEventDefinition', 'sendTask', 'serviceTask', 'taskListener']);
    for (const entry of fieldEntries) expect(entry.note, entry.id).toMatch(/inside extensionElements and as a direct child/);
  });
});

function find(root: { get(n: string): unknown }, id: string): { get(n: string): unknown } {
  const process = (root.get('rootElements') as Array<{ $type: string; get(n: string): unknown }>).find((r) => r.$type === 'bpmn:Process')!;
  return (process.get('flowElements') as Array<{ id: string; get(n: string): unknown }>).find((f) => f.id === id)!;
}
