import type { Problem } from '@activiti-modeler/bpmnlint-plugin-activiti';
import { HIDDEN_RULES } from '@activiti-modeler/bpmn-js-activiti/support-matrix';
import { describe, expect, it } from 'vitest';

import { gateExplanation, HIDDEN_CONSTRUCT_RULES, simulationGate } from './simulationGate';

const problem = (rule: string, severity: Problem['severity'] = 'error', path = 'processes/a.bpmn20.xml'): Problem => ({ id: `${path}|${rule}`, path, rule, severity, message: `${rule} problem`, source: 'client' });

describe('simulation gate (U16)', () => {
  it('knows a rule for every construct the support matrix hides', () => {
    expect(Object.keys(HIDDEN_CONSTRUCT_RULES).sort()).toEqual(HIDDEN_RULES.map((r) => r.id).sort());
  });

  it('allows a diagram without hidden constructs, whatever else the lint says', () => {
    expect(simulationGate([problem('activiti/service-task-missing-implementation'), problem('activiti/no-business-rule-task', 'error', 'processes/other.bpmn20.xml')], 'processes/a.bpmn20.xml').allowed).toBe(true);
  });

  it('blocks on an error about a hidden construct of this file and says why', () => {
    const gate = simulationGate([problem('activiti/no-business-rule-task'), problem('bpmnlint/no-complex-gateway')], 'processes/a.bpmn20.xml');
    expect(gate.allowed).toBe(false);
    expect(gate.blockers).toHaveLength(2);
    expect(gateExplanation(gate)).toContain('activiti/no-business-rule-task problem');
    expect(gateExplanation(gate)).toContain('and 1 more');
  });

  it('does not block on a warning about a hidden construct', () => {
    expect(simulationGate([problem('activiti/no-group', 'warning')], 'processes/a.bpmn20.xml').allowed).toBe(true);
  });
});
