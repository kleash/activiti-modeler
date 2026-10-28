import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../test-support/builder';

let t: Built | undefined;
afterEach(() => t?.destroy());

describe('DiagramBuilder', () => {
  it('builds a process with shapes, flows and accessor properties and exports valid files', async () => {
    t = await createBuilt();
    const b = t.builder;
    const task = b.appendShape('StartEvent_1', { type: 'userTask', id: 'review', name: 'Review' });
    b.setProperty('review', 'user.assignee', 'kermit');
    const gw = b.appendShape('review', { type: 'exclusiveGateway', id: 'gw' });
    expect(gw.flow).toMatch(/^Flow_|^SequenceFlow_/);
    const exported = await b.export('demo');
    expect(exported.xml).toContain('activiti:assignee="kermit"');
    expect(exported.processIds).toEqual(['Process_1']);
    expect(task.id).toBe('review');
  });

  it('places a shape at a given centre and size, so a sub process can hold the shapes created in it', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'subProcess', id: 'sp', at: { x: 500, y: 300 }, size: { width: 600, height: 240 } });
    expect(t.element('sp')).toMatchObject({ x: 200, y: 180, width: 600, height: 240 });
    t.builder.createShape({ type: 'userTask', id: 'inside', parent: 'sp', at: { x: 500, y: 300 } });
    expect(t.element('inside').parent?.id).toBe('sp');
  });
});
