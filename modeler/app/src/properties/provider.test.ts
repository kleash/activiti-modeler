// @vitest-environment jsdom
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ElementRegistry, ExtensionsStore, ProjectCatalog, PropertyAccessors } from '@activiti-modeler/bpmn-js-activiti';
import { afterEach, describe, expect, it } from 'vitest';

import '../../../packages/bpmn-js-activiti/test-support/setup';
import { buildKitchenSink } from '../../../packages/bpmn-js-activiti/test-support/kitchen-sink';
import { createBuilt, type Built } from '../../../packages/bpmn-js-activiti/test-support/builder';
import type { Definition } from './builders';
import { PanelEnv } from './env';
import { HELP } from './help';
import { loadPanelLayout, PANEL_LAYOUT_KEY, sanitizePanelLayout, savePanelLayout } from './layoutStore';
import { groupsFor } from './provider';

let t: Built | undefined;
afterEach(() => {
  t?.destroy();
  t = undefined;
});

const envOf = (b: Built): PanelEnv =>
  new PanelEnv(b.get<PropertyAccessors>('propertyAccessors'), b.get<ElementRegistry>('elementRegistry'), b.get<ExtensionsStore>('extensionsStore'), { fire: () => undefined, on: () => undefined }, ((fn: unknown) => fn) as never, b.get<ProjectCatalog>('projectCatalog'));

const groupIds = (b: Built, id: string): string[] => groupsFor(envOf(b), b.element(id)).map((g) => g.id);

/** Every entry id of the groups, with those inside list items. */
function entryIds(groups: Definition[]): string[] {
  const out: string[] = [];
  const walk = (entries: unknown): void => {
    for (const e of (entries as Array<Record<string, unknown>> | undefined) ?? []) out.push(e.id as string);
  };
  for (const g of groups) {
    walk(g.entries);
    for (const item of (g.items as Array<{ id: string; entries: unknown }> | undefined) ?? []) {
      out.push(item.id);
      walk(item.entries);
    }
  }
  return out;
}

describe('groups per element type', () => {
  it('a process offers the process level groups only', async () => {
    t = await createBuilt();
    const ids = groupIds(t, 'Process_1');
    expect(ids).toEqual(expect.arrayContaining(['general', 'documentation', 'starters', 'messages', 'signals', 'errors', 'eventListeners', 'dataObjects']));
    expect(ids).not.toContain('implementation');
    expect(ids).not.toContain('userAssignment');
  });

  it('a user task has assignment, form and task listeners, no implementation', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    const ids = groupIds(t, 'u');
    expect(ids).toEqual(expect.arrayContaining(['general', 'userAssignment', 'form', 'taskListeners', 'executionListeners', 'multiInstance', 'async']));
    expect(ids).not.toContain('implementation');
    expect(ids).not.toContain('job');
  });

  it('a service task has the implementation, fields and the job and error mapping groups where they work', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 's', attrs: { 'activiti:class': 'org.example.Do' } });
    const ids = groupIds(t, 's');
    expect(ids).toEqual(expect.arrayContaining(['implementation', 'fields', 'job', 'async', 'multiInstance']));
    expect(ids).not.toContain('taskListeners');
    expect(ids).not.toContain('userAssignment');
  });

  it('a script task has the script group, a call activity the called element group', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'scriptTask', id: 'sc' });
    t.builder.createShape({ type: 'callActivity', id: 'ca' });
    expect(groupIds(t, 'sc')).toContain('script');
    expect(groupIds(t, 'ca')).toContain('calledElement');
    expect(groupIds(t, 'ca')).toContain('errorMapping');
    expect(groupIds(t, 'sc')).not.toContain('calledElement');
  });

  it('a timer boundary event has the timer group; a message throw event the message group', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'boundaryEvent', id: 'bt', eventDefinition: 'timer', attachedTo: 'u' });
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'tm', eventDefinition: 'message' });
    expect(groupIds(t, 'bt')).toContain('timer');
    expect(groupIds(t, 'tm')).toContain('message');
    expect(groupIds(t, 'tm')).not.toContain('timer');
  });

  it('a sequence flow leaving a gateway has a condition, a task has none', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'exclusiveGateway', id: 'gw' });
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'userTask', id: 'u2' });
    t.builder.connect('gw', 'u', { id: 'f1' });
    t.builder.connect('u', 'u2', { id: 'f0' });
    expect(groupIds(t, 'f1')).toContain('condition');
    expect(groupIds(t, 'u')).not.toContain('condition');
  });

  it('a process offers the process variables, a task the template group', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 's' });
    t.builder.createShape({ type: 'userTask', id: 'u' });
    expect(groupIds(t, 'Process_1')).toContain('variables');
    expect(groupIds(t, 's')).toContain('template');
    expect(groupIds(t, 'u')).not.toContain('template');
    expect(groupIds(t, 's')).not.toContain('variables');
  });

  it('the mapping and constants groups appear where the engine reads a mapping', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'conn', attrs: { implementation: 'crm.LOOKUP' } });
    t.builder.createShape({ type: 'serviceTask', id: 'cls', attrs: { 'activiti:class': 'a.B' } });
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    t.builder.createShape({ type: 'userTask', id: 'u' });
    t.builder.createShape({ type: 'callActivity', id: 'call' });
    t.builder.createShape({ type: 'startEvent', id: 'startMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'catchSig', eventDefinition: 'signal' });
    t.builder.createShape({ type: 'intermediateThrowEvent', id: 'throwMsg', eventDefinition: 'message' });
    t.builder.createShape({ type: 'intermediateCatchEvent', id: 'timer', eventDefinition: 'timer' });
    for (const id of ['conn', 'dec', 'u', 'call', 'throwMsg']) {
      expect(groupIds(t, id), id).toContain('mapping');
      expect(groupIds(t, id), id).toContain('constants');
    }
    // events that only receive a payload have no constants; a signal has the note only; a class task and a timer have none
    expect(groupIds(t, 'startMsg')).toContain('mapping');
    expect(groupIds(t, 'startMsg')).not.toContain('constants');
    expect(groupIds(t, 'catchSig')).toContain('mapping');
    for (const id of ['cls', 'timer']) expect(groupIds(t, id), id).not.toContain('mapping');
    expect(groupIds(t, 'dec')).toContain('decision');
    expect(groupIds(t, 'conn')).not.toContain('decision');
  });

  it('shows nothing for a label or an element the matrix hides', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'complexGateway', id: 'cg', allowHidden: true });
    expect(groupIds(t, 'cg')).not.toContain('implementation');
  });
});

describe('entry ids', () => {
  it('are stable, unique per element and follow the scheme (accessor key, or <list>[<i>].<field>)', async () => {
    t = await createBuilt();
    const samples = buildKitchenSink(t.builder);
    t.builder.setProperty('Process_1', 'definitions.messages', [{ id: 'm1', name: 'one' }]);
    const env = envOf(t);
    const pattern = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*(\[\d+\](\.[A-Za-z0-9]+)*)?$/;
    for (const id of ['Process_1', ...samples.filter((s) => !s.hidden).map((s) => s.id)]) {
      const ids = entryIds(groupsFor(env, t.element(id)));
      expect(new Set(ids).size, `entry ids of ${id} are unique`).toBe(ids.length);
      for (const entry of ids) expect(entry, `entry id ${entry} of ${id}`).toMatch(pattern);
      // a second build produces the same ids
      expect(entryIds(groupsFor(env, t.element(id)))).toEqual(ids);
    }
  });

  it('start with an accessor key unless the entry is a note or a list item', async () => {
    t = await createBuilt();
    const samples = buildKitchenSink(t.builder);
    const env = envOf(t);
    const accessors = t.get<PropertyAccessors>('propertyAccessors');
    const hasKey = (owner: ReturnType<Built['element']>, key: string): boolean => {
      try {
        return accessors.has(owner, key);
      } catch {
        return false; // not an accessor key (a sub entry such as timer.definition.type)
      }
    };
    const noteSuffix = /\.(hint|preview|usage|note|warning|info|sources|help)$/;
    for (const sample of samples.filter((s) => !s.hidden)) {
      const element = t.element(sample.id);
      for (const entry of entryIds(groupsFor(env, element))) {
        if (noteSuffix.test(entry)) continue;
        const key = entry.replace(/\[\d+\].*$/, '');
        const owner = /^(definitions|data\.objects)/.test(key) ? t.element('Process_1') : element;
        const base = key.split('.');
        let found = false;
        for (let n = base.length; n > 0 && !found; n -= 1) found = hasKey(owner, base.slice(0, n).join('.'));
        expect(found, `entry ${entry} of ${sample.id} has an accessor`).toBe(true);
      }
    }
  });
});

describe('help pages', () => {
  it('every tooltip points to a page of the user guide', () => {
    const dir = resolve(__dirname, '../../../../docs/user-guide/properties');
    const pages = new Set(readdirSync(dir).map((f) => f.replace(/\.md$/, '')));
    for (const [key, help] of Object.entries(HELP)) expect(pages.has(help.page), `${key} -> ${help.page}.md`).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('panel layout store', () => {
  const memory = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[PANEL_LAYOUT_KEY, initial]]);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it('keeps only the open flags of groups', () => {
    expect(sanitizePanelLayout({ groups: { general: { open: true, x: 1 }, bad: { open: 'yes' }, other: 5 }, junk: 1 })).toEqual({ groups: { general: { open: true } } });
    expect(sanitizePanelLayout(null)).toEqual({ groups: {} });
    expect(sanitizePanelLayout('text')).toEqual({ groups: {} });
  });

  it('round-trips and survives broken or missing storage', () => {
    const store = memory();
    savePanelLayout({ groups: { timer: { open: true }, form: { open: false } } }, store);
    expect(loadPanelLayout(store)).toEqual({ groups: { timer: { open: true }, form: { open: false } } });
    expect(loadPanelLayout(memory('{not json'))).toEqual({ groups: {} });
    expect(loadPanelLayout(undefined)).toEqual({ groups: {} });
    expect(() => savePanelLayout({ groups: {} }, { getItem: () => null, setItem: () => { throw new Error('full'); } })).not.toThrow();
  });
});
