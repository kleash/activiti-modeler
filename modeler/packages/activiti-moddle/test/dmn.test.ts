import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DmnModdle } from 'dmn-moddle';
import { describe, expect, it } from 'vitest';

import { activitiDmnModdleDescriptor } from '../src';
import { lostFacts } from './support/xml-facts';

const SAMPLES = join(__dirname, 'fixtures/dmn');

async function roundTrip(xml: string): Promise<{ out: string; warnings: string[] }> {
  const moddle = new DmnModdle({ activiti: activitiDmnModdleDescriptor as never });
  const { rootElement, warnings } = await moddle.fromXML(xml);
  const { xml: out } = await moddle.toXML(rootElement, { format: true });
  return { out, warnings: warnings.map((w) => w.message) };
}

// Activiti 6 era table (moved to the DMN 1.3 namespace, as @bpmn-io/dmn-migrate does) with activiti: and foreign attributes on several elements
const ACTIVITI_TABLE = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:activiti="http://activiti.org/dmn" xmlns:other="urn:other"
  id="definition_1" name="Order" namespace="http://activiti.org/schema/1.0/dmn" other:flag="x">
  <decision id="decision1" name="Discount" other:note="kept">
    <decisionTable id="decisionTable1" hitPolicy="FIRST" other:tableAttr="t">
      <input id="input1" label="Order size" activiti:inputVariable="orderSize" activiti:unknownAttr="u" other:in="i">
        <inputExpression id="inputExpression1" typeRef="number"><text>orderSize</text></inputExpression>
      </input>
      <output id="output1" label="Discount" name="discount" typeRef="number" other:out="o"/>
      <rule id="rule1" other:rule="r"><inputEntry id="e1"><text>&gt; 10</text></inputEntry><outputEntry id="o1"><text>0.1</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe('DMN descriptor', () => {
  it('types activiti:inputVariable and round-trips every foreign attribute', async () => {
    const { out, warnings } = await roundTrip(ACTIVITI_TABLE);
    expect(warnings.filter((w) => !w.includes('unknown attribute <activiti:unknownAttr>'))).toEqual([]);
    expect(out).toContain('activiti:inputVariable="orderSize"');
    for (const kept of ['other:flag="x"', 'other:note="kept"', 'other:tableAttr="t"', 'other:in="i"', 'other:out="o"', 'other:rule="r"', 'activiti:unknownAttr="u"']) {
      expect(out, kept).toContain(kept);
    }
    expect(lostFacts(ACTIVITI_TABLE, out)).toEqual([]);
  });

  it.each(['drd13.dmn', 'hp13.dmn'])('round-trips the DMN 1.3 sample %s without losing an attribute', async (file) => {
    const xml = readFileSync(join(SAMPLES, file), 'utf8');
    const { out, warnings } = await roundTrip(xml);
    expect(warnings).toEqual([]);
    expect(lostFacts(xml, out)).toEqual([]);
  });
});
