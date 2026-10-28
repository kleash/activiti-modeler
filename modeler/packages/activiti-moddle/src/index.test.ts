import { describe, expect, it } from 'vitest';

import { ACTIVITI_NAMESPACE, activitiModdleDescriptor } from './index';

describe('activiti moddle', () => {
  it('uses the Activiti BPMN namespace', () => {
    expect(ACTIVITI_NAMESPACE).toEqual({ prefix: 'activiti', uri: 'http://activiti.org/bpmn' });
  });

  it('describes a package named after the namespace', () => {
    expect(activitiModdleDescriptor.prefix).toBe('activiti');
    expect(activitiModdleDescriptor.uri).toBe(ACTIVITI_NAMESPACE.uri);
  });
});
