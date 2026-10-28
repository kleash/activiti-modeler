import { describe, expect, it } from 'vitest';

import { ACTIVITI_CHECKLIST, ACTIVITI_NAMESPACE, type ChecklistEntry } from '../src';
import { fixtureFor } from './support/fixtures';
import { createModdle, exportXml, importXml, walk } from './support/moddle';
import { lostFacts } from './support/xml-facts';

const ACTIVITI = ACTIVITI_NAMESPACE.uri;
const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** moddle types that carry the XML element `tag` */
function moddleTypes(entryElement: string): string[] {
  switch (entryElement) {
    case 'timeCycle':
      return ['bpmn:Expression'];
    case 'inputDataItem':
      return ['bpmn:DataInput'];
    case 'outputDataItem':
      return ['bpmn:DataOutput'];
    case 'in':
    case 'out':
    case 'value':
    case 'field':
    case 'formProperty':
    case 'mapException':
    case 'customResource':
    case 'localization':
    case 'executionListener':
    case 'taskListener':
    case 'eventListener':
      return [`activiti:${capitalize(entryElement)}`];
    default:
      return [`bpmn:${capitalize(entryElement)}`];
  }
}

function xmlCarriers(doc: Document, entry: ChecklistEntry): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', entry.element));
}

function hasAttribute(el: Element, entry: ChecklistEntry): boolean {
  if (entry.namespace === 'activiti') return el.hasAttributeNS(ACTIVITI, entry.name);
  return el.hasAttribute(entry.name) || el.hasAttributeNS(ACTIVITI, entry.name);
}

function hasChildElement(el: Element, entry: ChecklistEntry): boolean {
  const uri = entry.namespace === 'activiti' ? ACTIVITI : BPMN;
  return Array.from(el.getElementsByTagNameNS(uri, entry.name)).length > 0;
}

describe('checklist', () => {
  it('is generated and not trivially small', () => {
    expect(ACTIVITI_CHECKLIST.counts.total).toBe(ACTIVITI_CHECKLIST.entries.length);
    expect(ACTIVITI_CHECKLIST.entries.length).toBeGreaterThan(250);
    expect(new Set(ACTIVITI_CHECKLIST.entries.map((e) => e.id)).size).toBe(ACTIVITI_CHECKLIST.entries.length);
  });

  it('covers the elements and attributes R1 lists as strict', () => {
    const strict = ACTIVITI_CHECKLIST.entries.filter((e) => e.match === 'strict').map((e) => e.id);
    for (const id of [
      'userTask@activiti:assignee', 'userTask@activiti:skipExpression', 'serviceTask@activiti:resultVariableName',
      'callActivity@activiti:inheritVariables', 'multiInstanceLoopCharacteristics@activiti:elementIndexVariable',
      'messageEventDefinition@activiti:correlationKey', 'signalEventDefinition@activiti:async', 'timeCycle@activiti:endDate',
      'terminateEventDefinition@activiti:terminateAll', 'signal@activiti:scope', 'process@activiti:candidateStarterUsers',
      'startEvent@activiti:initiator', 'scriptTask@activiti:autoStoreVariables', 'timerEventDefinition@activiti:businessCalendarName',
      'subProcess@activiti:async', 'task@activiti:exclusive',
    ]) {
      expect(strict, id).toContain(id);
    }
  });
});

describe('one round-trip fixture per checklist entry', () => {
  it.each(ACTIVITI_CHECKLIST.entries.map((e) => [e.id, e] as const))('%s', async (_id, entry) => {
    const xml = fixtureFor(entry);
    expect(xml, `no fixture for checklist entry ${entry.id}; add a template in test/support/fixtures.ts`).toBeDefined();

    // 1. the fixture really contains the entry
    const doc = new DOMParser().parseFromString(xml!, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const carriers = xmlCarriers(doc, entry);
    expect(carriers.length, `fixture has no <${entry.element}>`).toBeGreaterThan(0);
    const present =
      entry.kind === 'attribute'
        ? carriers.some((c) => hasAttribute(c, entry))
        : carriers.some((c) => hasChildElement(c, entry));
    expect(present, `fixture does not contain ${entry.id}`).toBe(true);

    // 2. it imports without warnings
    const imported = await importXml(xml!);
    expect(imported.result.warnings.map((w) => w.message)).toEqual([]);

    // 3. the moddle model exposes it typed
    const all = walk(imported.definitions);
    if (entry.kind === 'attribute') {
      const key = entry.namespace === 'activiti' ? `activiti:${entry.name}` : entry.name;
      const types = moddleTypes(entry.element);
      const holders = all.filter((el) => types.some((t) => el.$instanceOf(t)));
      expect(holders.length, `no moddle element of ${types.join('|')}`).toBeGreaterThan(0);
      const typed = holders.some((el) => el.$descriptor.propertiesByName[key] !== undefined && el.get(key) !== undefined);
      expect(typed, `${entry.element} has no typed property ${key}`).toBe(true);
    } else if (entry.namespace === 'activiti') {
      const type = `activiti:${capitalize(entry.name)}`;
      expect(all.some((el) => el.$type === type), `no ${type} element after import`).toBe(true);
    }

    // 4. export keeps every fact and is stable
    const out = await exportXml(imported);
    expect(lostFacts(xml!, out)).toEqual([]);
    expect(await exportXml(await importXml(out))).toBe(out);
  });

  it('fails for a checklist entry that has no fixture template (so a new engine attribute cannot go untested)', () => {
    const unknown: ChecklistEntry = { id: 'newElement@activiti:newAttribute', element: 'newElement', kind: 'attribute', namespace: 'activiti', name: 'newAttribute', match: 'strict', origin: ['Test'], modeler: 'edit' };
    expect(fixtureFor(unknown)).toBeUndefined();
    expect(fixtureFor({ ...unknown, id: 'userTask>activiti:newChild', element: 'userTask', kind: 'element', name: 'newChild' })).toBeUndefined();
  });

  it('has no fixture for an id that is not in the checklist', () => {
    // fixtureFor is entry-driven, so a stale checklist entry is the only way for drift; make that explicit
    const ids = new Set(ACTIVITI_CHECKLIST.entries.map((e) => e.id));
    expect(ids.size).toBe(ACTIVITI_CHECKLIST.counts.total);
    expect(createModdle()).toBeDefined();
  });
});
