import { describe, expect, it } from 'vitest';

import { ActivitiModule, activitiModdleExtensions } from './index';

describe('bpmn-js-activiti', () => {
  it('registers the activiti moddle package under its prefix', () => {
    expect(activitiModdleExtensions.activiti.prefix).toBe('activiti');
    expect(activitiModdleExtensions.activiti.uri).toBe('http://activiti.org/bpmn');
  });

  it('exposes one didi module that depends on the Activiti modules and nothing from Camunda or Zeebe', () => {
    expect(ActivitiModule.__depends__).toHaveLength(12);
    const names = JSON.stringify(Object.keys(Object.assign({}, ...(ActivitiModule.__depends__ as object[]))));
    expect(names).not.toMatch(/camunda|zeebe/i);
  });
});
