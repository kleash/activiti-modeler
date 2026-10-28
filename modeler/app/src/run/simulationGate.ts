import type { Problem } from '@activiti-modeler/bpmnlint-plugin-activiti';

/**
 * The lint rules that report a construct the modeler hides (FEATURE_MATRIX section C, `HIDDEN_COVERAGE` of the lint plugin): a business rule
 * task, a complex gateway, an ad-hoc sub process, an unsupported event definition... Token simulation follows the BPMN specification
 * and would happily play a diagram the Activiti engine does not run that way (a complex gateway becomes an exclusive one, an ad-hoc sub
 * process hangs), so it is only offered when the diagram has none of them (feature U16).
 */
export const HIDDEN_CONSTRUCT_RULES: Readonly<Record<string, string>> = {
  businessRuleTask: 'activiti/no-business-rule-task',
  complexGateway: 'bpmnlint/no-complex-gateway',
  adHocSubProcess: 'activiti/no-ad-hoc-sub-process',
  unparsedEventDefinition: 'activiti/no-unsupported-event-definition',
  signalOrTimerStartInEventSubProcess: 'activiti/no-signal-start-in-event-subprocess',
  signalEnd: 'activiti/no-signal-end-event',
  linkCompensateEscalationEnd: 'activiti/no-unsupported-end-event',
  unsupportedServiceTaskType: 'activiti/unsupported-service-task-type',
  webServiceTask: 'activiti/no-web-service-task',
  standardLoop: 'activiti/no-standard-loop',
  group: 'activiti/no-group',
  scriptFormat: 'activiti/unsupported-script-format',
  typedStartInEmbeddedSubProcess: 'activiti/subprocess-start-event-event-definition-not-allowed',
  parallelEventBasedGateway: 'activiti/no-instantiating-event-gateway',
};

const HIDDEN = new Set(Object.values(HIDDEN_CONSTRUCT_RULES));

export interface SimulationGate {
  allowed: boolean;
  /** The lint errors about hidden constructs in this file. */
  blockers: Problem[];
}

/** May the diagram at `path` be simulated? Not while the lint reports an error about a hidden construct in it. */
export function simulationGate(problems: readonly Problem[], path: string): SimulationGate {
  const blockers = problems.filter((p) => p.path === path && p.severity === 'error' && HIDDEN.has(p.rule));
  return { allowed: blockers.length === 0, blockers };
}

/** The sentence that explains why simulation is not offered. */
export function gateExplanation(gate: SimulationGate): string {
  if (gate.allowed) return '';
  const first = gate.blockers[0]!;
  const more = gate.blockers.length > 1 ? ` (and ${gate.blockers.length - 1} more)` : '';
  return `Token simulation plays the diagram by the BPMN specification, but this diagram has ${gate.blockers.length === 1 ? 'a construct' : 'constructs'} Activiti does not run that way${more}: ${first.message}. Fix it (see Problems), then simulate.`;
}
