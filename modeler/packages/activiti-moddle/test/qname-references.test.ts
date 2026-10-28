import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exportXml, importXml } from './support/moddle';
import { lostFacts } from './support/xml-facts';

/**
 * A standard BPMN document may write a QName reference with the prefix of its target namespace (`tns:incRequest`); the Activiti
 * Designer does, and N01-negative/engine/variants/web-service-task-wsdl.bpmn20.xml too. bpmn-moddle resolves references by plain id,
 * so it dropped such a reference with the warning "unresolved reference" and the fact was lost on export. Importing a valid BPMN
 * must not lose facts, so the descriptor keeps the references of the web service wiring as strings (like the engine does).
 */
describe('QName references with a namespace prefix', () => {
  const xml = readFileSync(join(__dirname, 'fixtures/qname/prefixed-references.bpmn20.xml'), 'utf8');

  it('import without a warning', async () => {
    const imported = await importXml(xml);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);
  });

  it('round-trip without losing a fact', async () => {
    const out = await exportXml(await importXml(xml));
    expect(lostFacts(xml, out)).toEqual([]);
    for (const ref of ['tns:incRequest', 'tns:incResponse', 'tns:incError', 'tns:incOperation']) expect(out).toContain(ref);
  });

  it('keeps plain ids as they are', async () => {
    const plain = xml.replaceAll('tns:inc', 'inc').replaceAll('tns:intItem', 'intItem').replaceAll('tns:Counter', 'Counter');
    const imported = await importXml(plain);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);
    expect(lostFacts(plain, await exportXml(imported))).toEqual([]);
  });
});
