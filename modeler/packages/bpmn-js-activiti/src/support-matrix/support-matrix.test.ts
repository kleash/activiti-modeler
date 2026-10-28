import { describe, expect, it } from 'vitest';

import {
  HIDDEN_RULES, MATRIX_ROWS, allowedEventDefinitions, hiddenRuleFor, isAllowed, judge, type ElementSpec, type Placement,
} from './support-matrix';

const def = (name: string): string => `bpmn:${name}EventDefinition`;
const names = (types: Array<string | undefined>): string[] =>
  types.map((t) => (t ? t.replace('bpmn:', '').replace('EventDefinition', '').toLowerCase() : 'none')).sort();

describe('allowed event definitions per event type and context', () => {
  const process: Placement = { container: 'process' };
  it.each([
    ['bpmn:StartEvent', process, ['message', 'none', 'signal', 'timer']],
    ['bpmn:StartEvent', { container: 'subProcess' }, ['none']],
    ['bpmn:StartEvent', { container: 'transaction' }, ['none']],
    // no signal / timer start in an event sub process; none start is not valid there either
    ['bpmn:StartEvent', { container: 'eventSubProcess' }, ['error', 'message']],
    ['bpmn:EndEvent', process, ['error', 'message', 'none', 'terminate']],
    ['bpmn:EndEvent', { container: 'subProcess' }, ['error', 'message', 'none', 'terminate']],
    // cancel end only in a transaction
    ['bpmn:EndEvent', { container: 'transaction' }, ['cancel', 'error', 'message', 'none', 'terminate']],
    ['bpmn:IntermediateCatchEvent', process, ['link', 'message', 'signal', 'timer']],
    ['bpmn:IntermediateThrowEvent', process, ['compensate', 'link', 'message', 'none', 'signal']],
    ['bpmn:BoundaryEvent', { container: 'process', attachedTo: 'bpmn:UserTask' }, ['compensate', 'error', 'message', 'signal', 'timer']],
    // cancel boundary only on a transaction
    ['bpmn:BoundaryEvent', { container: 'process', attachedTo: 'bpmn:Transaction' }, ['cancel', 'compensate', 'error', 'message', 'signal', 'timer']],
    ['bpmn:BoundaryEvent', { container: 'process', attachedTo: 'bpmn:ExclusiveGateway' }, []],
  ] as const)('%s in %j allows %j', (type, placement, expected) => {
    expect(names(allowedEventDefinitions(type, placement as Placement))).toEqual([...expected]);
  });
});

/** One spec per §C construct that the matrix must hide. */
const HIDDEN_EXAMPLES: Record<string, Array<[ElementSpec, Placement]>> = {
  businessRuleTask: [[{ type: 'bpmn:BusinessRuleTask' }, { container: 'process' }]],
  complexGateway: [[{ type: 'bpmn:ComplexGateway' }, { container: 'process' }]],
  adHocSubProcess: [[{ type: 'bpmn:AdHocSubProcess' }, { container: 'process' }]],
  unparsedEventDefinition: [
    [{ type: 'bpmn:IntermediateThrowEvent', eventDefinitionType: def('Escalation') }, { container: 'process' }],
    [{ type: 'bpmn:EndEvent', eventDefinitionType: def('Escalation') }, { container: 'process' }],
    [{ type: 'bpmn:StartEvent', eventDefinitionType: def('Conditional') }, { container: 'process' }],
    [{ type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: def('Message'), multipleDefinitions: true }, { container: 'process' }],
  ],
  signalOrTimerStartInEventSubProcess: [
    [{ type: 'bpmn:StartEvent', eventDefinitionType: def('Signal') }, { container: 'eventSubProcess' }],
    [{ type: 'bpmn:StartEvent', eventDefinitionType: def('Timer') }, { container: 'eventSubProcess' }],
  ],
  signalEnd: [[{ type: 'bpmn:EndEvent', eventDefinitionType: def('Signal') }, { container: 'process' }]],
  linkCompensateEscalationEnd: [
    [{ type: 'bpmn:EndEvent', eventDefinitionType: def('Link') }, { container: 'process' }],
    [{ type: 'bpmn:EndEvent', eventDefinitionType: def('Compensate') }, { container: 'process' }],
  ],
  unsupportedServiceTaskType: [
    [{ type: 'bpmn:ServiceTask', activitiType: 'dmn' }, { container: 'process' }],
    [{ type: 'bpmn:ServiceTask', activitiType: 'camel' }, { container: 'process' }],
    [{ type: 'bpmn:SendTask', activitiType: 'mule' }, { container: 'process' }],
    [{ type: 'bpmn:SendTask', activitiType: 'shell' }, { container: 'process' }],
  ],
  webServiceTask: [[{ type: 'bpmn:ServiceTask', implementation: '##WebService' }, { container: 'process' }]],
  standardLoop: [[{ type: 'bpmn:UserTask', loop: 'standard' }, { container: 'process' }]],
  group: [[{ type: 'bpmn:Group' }, { container: 'process' }]],
  scriptFormat: [[{ type: 'bpmn:ScriptTask', scriptFormat: 'groovy' }, { container: 'process' }]],
  typedStartInEmbeddedSubProcess: [
    [{ type: 'bpmn:StartEvent', eventDefinitionType: def('Timer') }, { container: 'subProcess' }],
    [{ type: 'bpmn:StartEvent', eventDefinitionType: def('Message') }, { container: 'transaction' }],
  ],
  parallelEventBasedGateway: [
    [{ type: 'bpmn:EventBasedGateway', instantiate: true }, { container: 'process' }],
    [{ type: 'bpmn:EventBasedGateway', eventGatewayType: 'Parallel' }, { container: 'process' }],
  ],
};

describe('FEATURE_MATRIX §C: hidden constructs', () => {
  it('has an example for every rule', () => {
    expect(Object.keys(HIDDEN_EXAMPLES).sort()).toEqual(HIDDEN_RULES.map((r) => r.id).sort());
  });

  it.each(Object.entries(HIDDEN_EXAMPLES).flatMap(([id, examples]) => examples.map((e) => [id, ...e] as const)))('%s hides %j in %j', (id, spec, placement) => {
    expect(hiddenRuleFor(spec, placement)?.id).toBe(id);
    expect(isAllowed(spec, placement)).toBe(false);
    expect(judge(spec, placement).reason).toContain(HIDDEN_RULES.find((r) => r.id === id)!.label);
  });

  it('gives every rule a label and an R1 reference', () => {
    for (const rule of HIDDEN_RULES) {
      expect(rule.label.length).toBeGreaterThan(3);
      expect(rule.why.length).toBeGreaterThan(5);
    }
  });
});

describe('FEATURE_MATRIX §A: creatable rows', () => {
  const exampleFor = (row: (typeof MATRIX_ROWS)[number]): [ElementSpec, Placement] => {
    const spec: ElementSpec = { type: 'bpmn:Task' };
    const probes: Array<[ElementSpec, Placement]> = [];
    const types = ['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent'];
    const definitions = [undefined, ...['Message', 'Timer', 'Signal', 'Error', 'Terminate', 'Cancel', 'Compensate', 'Link'].map(def)];
    const containers = ['process', 'subProcess', 'eventSubProcess', 'transaction', 'collaboration'] as const;
    const baseTypes = ['bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:ManualTask', 'bpmn:CallActivity',
      'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway', 'bpmn:EventBasedGateway', 'bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:SequenceFlow',
      'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:MessageFlow', 'bpmn:TextAnnotation', 'bpmn:Association',
      'bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'];
    for (const container of containers) {
      for (const type of [...types, ...baseTypes]) {
        for (const eventDefinitionType of types.includes(type) ? definitions : [undefined]) {
          for (const flags of [{}, { triggeredByEvent: true }, { implementation: 'dmn-connector.EXECUTE_TABLE' }, { isInterrupting: false }]) {
            const candidate: ElementSpec = { ...spec, type, ...flags };
            if (eventDefinitionType) candidate.eventDefinitionType = eventDefinitionType;
            probes.push([candidate, { container, attachedTo: type === 'bpmn:BoundaryEvent' ? (eventDefinitionType === def('Cancel') ? 'bpmn:Transaction' : 'bpmn:UserTask') : undefined }]);
          }
        }
      }
    }
    const hit = probes.find(([s, p]) => row.matches(s) && judge(s, p).rows.includes(row));
    if (!hit) throw new Error(`no allowed example for row ${row.id}`);
    return hit;
  };

  it.each(MATRIX_ROWS.map((r) => [r.id, r] as const))('row %s is creatable somewhere', (_id, row) => {
    const [spec, placement] = exampleFor(row);
    expect(judge(spec, placement).allowed).toBe(true);
  });

  it('lists every FEATURE_MATRIX §A id', () => {
    const ids = new Set(MATRIX_ROWS.map((r) => r.id));
    for (const id of [...Array.from({ length: 26 }, (_, i) => `E${i + 1}`), 'T1', 'T2', 'T6', 'T9', 'T10', 'T11', 'T12', 'T13', 'T14', 'G1', 'G2', 'G3', 'G4', 'S1', 'S2', 'S3', 'F1', 'D1', 'D2']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('decision task and plain service task are different rows', () => {
    const decision = judge({ type: 'bpmn:ServiceTask', implementation: 'dmn-connector.EXECUTE_TABLE' }, { container: 'process' });
    const service = judge({ type: 'bpmn:ServiceTask' }, { container: 'process' });
    expect(decision.rows.map((r) => r.id)).toEqual(['T6']);
    expect(service.rows.map((r) => r.id)).toEqual(['T2']);
  });

  it('allows a mail or shell service task and a mail send task', () => {
    expect(isAllowed({ type: 'bpmn:ServiceTask', activitiType: 'mail' }, { container: 'process' })).toBe(true);
    expect(isAllowed({ type: 'bpmn:ServiceTask', activitiType: 'shell' }, { container: 'process' })).toBe(true);
    expect(isAllowed({ type: 'bpmn:SendTask', activitiType: 'mail' }, { container: 'process' })).toBe(true);
  });

  it('keeps cancel end events inside transactions and cancel boundaries on transactions', () => {
    expect(isAllowed({ type: 'bpmn:EndEvent', eventDefinitionType: def('Cancel') }, { container: 'process' })).toBe(false);
    expect(isAllowed({ type: 'bpmn:EndEvent', eventDefinitionType: def('Cancel') }, { container: 'transaction' })).toBe(true);
    expect(isAllowed({ type: 'bpmn:BoundaryEvent', eventDefinitionType: def('Cancel') }, { container: 'process', attachedTo: 'bpmn:UserTask' })).toBe(false);
    expect(isAllowed({ type: 'bpmn:BoundaryEvent', eventDefinitionType: def('Cancel') }, { container: 'process', attachedTo: 'bpmn:Transaction' })).toBe(true);
  });

  it('makes the error boundary interrupting only', () => {
    expect(isAllowed({ type: 'bpmn:BoundaryEvent', eventDefinitionType: def('Error'), cancelActivity: false }, { container: 'process', attachedTo: 'bpmn:UserTask' })).toBe(false);
    expect(isAllowed({ type: 'bpmn:BoundaryEvent', eventDefinitionType: def('Timer'), cancelActivity: false }, { container: 'process', attachedTo: 'bpmn:UserTask' })).toBe(true);
  });
});
