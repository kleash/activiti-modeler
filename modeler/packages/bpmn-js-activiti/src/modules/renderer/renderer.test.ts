import { afterEach, describe, expect, it } from 'vitest';

import { createBuilt, type Built } from '../../../test-support/builder';
import type { DiagramElement } from '../../types';
import { taskKindOf } from './ActivitiRenderer';

let t: Built | undefined;
afterEach(() => t?.destroy());

const icons = (t: Built, id: string): string[] => {
  const gfx = t.get<{ getGraphics(el: DiagramElement): SVGElement }>('elementRegistry').getGraphics(t.element(id));
  return Array.from(gfx.querySelectorAll('.activiti-task-icon')).map((n) => n.getAttribute('class')!.replace('activiti-task-icon ', ''));
};

describe('ActivitiRenderer', () => {
  it('draws a decision table icon on the decision task, an envelope on mail and a terminal on shell tasks', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    t.builder.createShape({ type: 'serviceTask', id: 'mail', attrs: { 'activiti:type': 'mail' } });
    t.builder.createShape({ type: 'serviceTask', id: 'shell', attrs: { 'activiti:type': 'shell' } });
    t.builder.createShape({ type: 'serviceTask', id: 'plain' });
    t.builder.createShape({ type: 'userTask', id: 'user' });
    expect(icons(t, 'dec')).toEqual(['activiti-task-decision']);
    expect(icons(t, 'mail')).toEqual(['activiti-task-mail']);
    expect(icons(t, 'shell')).toEqual(['activiti-task-shell']);
    expect(icons(t, 'plain')).toEqual([]);
    expect(icons(t, 'user')).toEqual([]);
  });

  it('replaces the generic gear on typed tasks and keeps it on a plain service task', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    t.builder.createShape({ type: 'serviceTask', id: 'plain' });
    const circles = (id: string): number => t!.get<{ getGraphics(el: DiagramElement): SVGElement }>('elementRegistry').getGraphics(t!.element(id)).querySelectorAll('circle').length;
    // the gear is two filled circles and two paths; the typed task draws none of them
    expect(circles('plain')).toBe(2);
    expect(circles('dec')).toBe(0);
  });

  it('follows the implementation when it changes', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'svc' });
    t.builder.setProperty('svc', 'impl.type', 'mail');
    expect(icons(t, 'svc')).toEqual(['activiti-task-mail']);
    t.builder.setProperty('svc', 'impl.type', 'decision');
    expect(icons(t, 'svc')).toEqual(['activiti-task-decision']);
    t.builder.setProperty('svc', 'impl.type', 'class');
    expect(icons(t, 'svc')).toEqual([]);
  });

  it('classifies tasks', async () => {
    t = await createBuilt();
    t.builder.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
    t.builder.createShape({ type: 'sendTask', id: 'send' });
    expect(taskKindOf(t.element('dec'))).toBe('decision');
    // a send task keeps bpmn-js' envelope
    expect(taskKindOf(t.element('send'))).toBeUndefined();
  });

  it('draws the icon of the template a task was created from, and nothing for an unknown template id', async () => {
    t = await createBuilt();
    const link = (id: string): Record<string, string> => ({ 'activiti:templateId': id, 'activiti:templateVersion': '1' });
    t.builder.createShape({ type: 'serviceTask', id: 'conn', attrs: { implementation: 'crm.LOOKUP', ...link('crm.LOOKUP') } });
    t.builder.createShape({ type: 'serviceTask', id: 'cls', attrs: { 'activiti:class': 'a.B', ...link('builtin/class') } });
    t.builder.createShape({ type: 'serviceTask', id: 'expr', attrs: { 'activiti:expression': '${x}', ...link('builtin/expression') } });
    t.builder.createShape({ type: 'serviceTask', id: 'del', attrs: { 'activiti:delegateExpression': '${x}', ...link('builtin/delegateExpression') } });
    t.builder.createShape({ type: 'serviceTask', id: 'odd', attrs: link('builtin/nonsense') });
    expect(icons(t, 'conn')).toEqual(['activiti-task-connector']);
    expect(icons(t, 'cls')).toEqual(['activiti-task-class']);
    expect(icons(t, 'expr')).toEqual(['activiti-task-expression']);
    expect(icons(t, 'del')).toEqual(['activiti-task-delegateExpression']);
    expect(icons(t, 'odd')).toEqual([]);
    expect(taskKindOf(t.element('conn'))).toBe('connector');
  });
});
