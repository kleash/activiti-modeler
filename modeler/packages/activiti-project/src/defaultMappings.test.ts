import { describe, expect, it } from 'vitest';

import { defaultMappingType, wantsDefaultMapping, type MappingHostFacts } from './defaultMappings';

const host = (type: string, extra: Partial<MappingHostFacts> = {}): MappingHostFacts => ({ type, eventDefinitions: [], multiInstance: false, inEventSubProcess: false, ...extra });

describe('default mappings (ADR 0006)', () => {
  it('user tasks and call activities get MAP_ALL', () => {
    for (const type of ['userTask', 'callActivity']) {
      expect(wantsDefaultMapping(host(type))).toBe(true);
      expect(defaultMappingType(host(type))).toBe('MAP_ALL');
    }
  });

  it('a multi-instance user task gets MAP_ALL_OUTPUTS, a multi-instance call activity MAP_ALL', () => {
    expect(defaultMappingType(host('userTask', { multiInstance: true }))).toBe('MAP_ALL_OUTPUTS');
    expect(defaultMappingType(host('callActivity', { multiInstance: true }))).toBe('MAP_ALL');
  });

  it('message catch events get MAP_ALL: intermediate, boundary and the start of an event sub process', () => {
    const message = ['messageEventDefinition'];
    expect(wantsDefaultMapping(host('intermediateCatchEvent', { eventDefinitions: message }))).toBe(true);
    expect(wantsDefaultMapping(host('boundaryEvent', { eventDefinitions: message }))).toBe(true);
    expect(wantsDefaultMapping(host('startEvent', { eventDefinitions: message, inEventSubProcess: true }))).toBe(true);
    expect(wantsDefaultMapping(host('startEvent', { eventDefinitions: message }))).toBe(false);
    expect(defaultMappingType(host('intermediateCatchEvent', { eventDefinitions: message }))).toBe('MAP_ALL');
  });

  it('signal catch events and other elements get none', () => {
    const signal = ['signalEventDefinition'];
    expect(wantsDefaultMapping(host('intermediateCatchEvent', { eventDefinitions: signal }))).toBe(false);
    expect(wantsDefaultMapping(host('boundaryEvent', { eventDefinitions: signal }))).toBe(false);
    expect(wantsDefaultMapping(host('startEvent', { eventDefinitions: signal, inEventSubProcess: true }))).toBe(false);
    expect(wantsDefaultMapping(host('serviceTask'))).toBe(false);
    expect(wantsDefaultMapping(host('intermediateThrowEvent', { eventDefinitions: ['messageEventDefinition'] }))).toBe(false);
  });
});
