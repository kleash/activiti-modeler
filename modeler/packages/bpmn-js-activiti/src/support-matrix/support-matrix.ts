/**
 * Data-driven description of FEATURE_MATRIX §A (what the modeler creates) and §C (what it hides), for Activiti 9.0.0.
 * Palette, context pad, replace menu, create/append menus and the creation / connection rules are all derived from
 * this one file, so the next change to what Activiti executes is made here only.
 */
import type { ModdleElement } from 'bpmn-moddle';

export const DMN_DECISION_IMPLEMENTATION = 'dmn-connector.EXECUTE_TABLE';
export const DMN_TABLE_CONSTANT = '_activiti_dmn_table_';

/** Script formats with an engine on the default Activiti 9 classpath (R1 §8.2). Others need a JSR-223 engine. */
export const SUPPORTED_SCRIPT_FORMATS: readonly string[] = ['juel', 'javascript', 'js', 'ecmascript', 'nashorn'];
export const SERVICE_TASK_TYPES: readonly string[] = ['mail', 'shell'];

export type ContainerKind = 'process' | 'subProcess' | 'eventSubProcess' | 'transaction' | 'adHocSubProcess' | 'collaboration';
export type Via = 'palette' | 'append' | 'replace' | 'connect' | 'accessor' | 'template' | 'context-pad';

/** What a creation / replacement produces. Mirrors the `target` objects of bpmn-js' replace options. */
export interface ElementSpec {
  type: string;
  /** `bpmn:TimerEventDefinition`, ...; undefined for a none event. */
  eventDefinitionType?: string;
  /** More than one event definition (multiple / parallel multiple events). */
  multipleDefinitions?: boolean;
  isInterrupting?: boolean;
  cancelActivity?: boolean;
  triggeredByEvent?: boolean;
  isExpanded?: boolean;
  /** `implementation` of a service task. */
  implementation?: string;
  /** `activiti:type` of a service or send task. */
  activitiType?: string;
  scriptFormat?: string;
  loop?: 'standard' | 'parallel' | 'sequential';
  /** event-based gateway that instantiates the process */
  instantiate?: boolean;
  eventGatewayType?: string;
}

/** Where the element is created. */
export interface Placement {
  container: ContainerKind;
  /** For boundary events: the bpmn: type of the activity they attach to. */
  attachedTo?: string;
}

export interface MatrixRow {
  /** FEATURE_MATRIX id, e.g. `E2`. */
  id: string;
  label: string;
  tier: 'M' | 'S';
  matches: (spec: ElementSpec) => boolean;
  /** Containers the element may be created in; defaults to every flow container. */
  containers?: readonly ContainerKind[];
  /** Hosts a boundary event may attach to. */
  hosts?: (hostType: string) => boolean;
  /** How the UI reaches it (the reachability test asserts the UI paths, the accessor tests the others). */
  via: readonly Via[];
}

export interface HiddenRule {
  /** FEATURE_MATRIX §C construct. */
  id: string;
  label: string;
  /** R1 evidence. */
  why: string;
  hides: (spec: ElementSpec, placement: Placement) => boolean;
}

const FLOW_CONTAINERS: readonly ContainerKind[] = ['process', 'subProcess', 'eventSubProcess', 'transaction'];
const PROCESS_LEVEL: readonly ContainerKind[] = ['process'];
const SUB: readonly ContainerKind[] = ['subProcess', 'transaction'];
const ACTIVITY_TYPES = [
  'bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:ManualTask',
  'bpmn:CallActivity', 'bpmn:SubProcess', 'bpmn:Transaction',
];
const isActivityHost = (type: string): boolean => ACTIVITY_TYPES.includes(type);

const def = (name: string): string => `bpmn:${name}EventDefinition`;
const eventRow = (
  id: string,
  label: string,
  type: string,
  definition: string | undefined,
  extra: Partial<MatrixRow> & { filter?: (s: ElementSpec) => boolean } = {},
  tier: 'M' | 'S' = 'M',
): MatrixRow => {
  const { filter, ...rest } = extra;
  return {
    id,
    label,
    tier,
    matches: (s) => s.type === type && s.eventDefinitionType === (definition ? def(definition) : undefined) && (filter ? filter(s) : true),
    via: ['palette', 'replace', 'append'],
    ...rest,
  };
};

const taskRow = (id: string, label: string, type: string, via: readonly Via[], extra: Partial<MatrixRow> = {}, filter?: (s: ElementSpec) => boolean): MatrixRow => ({
  id,
  label,
  tier: 'M',
  matches: (s) => s.type === type && (filter ? filter(s) : true),
  via,
  ...extra,
});

/** FEATURE_MATRIX §A, one row per creatable variant. */
export const MATRIX_ROWS: readonly MatrixRow[] = [
  // --- A.1 events
  eventRow('E1', 'None start event', 'bpmn:StartEvent', undefined, { containers: ['process', 'subProcess', 'transaction'] }),
  eventRow('E2', 'Timer start event', 'bpmn:StartEvent', 'Timer', { containers: PROCESS_LEVEL, via: ['replace'] }),
  eventRow('E3', 'Message start event', 'bpmn:StartEvent', 'Message', { containers: PROCESS_LEVEL, via: ['replace'] }),
  eventRow('E4', 'Signal start event', 'bpmn:StartEvent', 'Signal', { containers: PROCESS_LEVEL, via: ['replace'] }),
  eventRow('E5', 'Error start event (event sub process)', 'bpmn:StartEvent', 'Error', { containers: ['eventSubProcess'], via: ['replace'] }),
  eventRow('E6', 'Message start event (event sub process, interrupting or not)', 'bpmn:StartEvent', 'Message', { containers: ['eventSubProcess'], via: ['replace'] }),
  eventRow('E7', 'None end event', 'bpmn:EndEvent', undefined, { containers: FLOW_CONTAINERS }),
  eventRow('E8', 'Error end event', 'bpmn:EndEvent', 'Error', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E9', 'Terminate end event', 'bpmn:EndEvent', 'Terminate', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E10', 'Cancel end event (inside a transaction)', 'bpmn:EndEvent', 'Cancel', { containers: ['transaction'], via: ['replace'] }),
  eventRow('E11', 'Message end event', 'bpmn:EndEvent', 'Message', { containers: FLOW_CONTAINERS, via: ['replace'] }, 'S'),
  eventRow('E12', 'Intermediate catch timer', 'bpmn:IntermediateCatchEvent', 'Timer', { containers: FLOW_CONTAINERS, via: ['replace', 'append'] }),
  eventRow('E13', 'Intermediate catch message', 'bpmn:IntermediateCatchEvent', 'Message', { containers: FLOW_CONTAINERS, via: ['replace', 'append'] }),
  eventRow('E14', 'Intermediate catch signal', 'bpmn:IntermediateCatchEvent', 'Signal', { containers: FLOW_CONTAINERS, via: ['replace', 'append'] }),
  eventRow('E15', 'Intermediate catch link', 'bpmn:IntermediateCatchEvent', 'Link', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E16', 'Intermediate throw none', 'bpmn:IntermediateThrowEvent', undefined, { containers: FLOW_CONTAINERS }),
  eventRow('E17', 'Intermediate throw signal', 'bpmn:IntermediateThrowEvent', 'Signal', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E18', 'Intermediate throw compensate', 'bpmn:IntermediateThrowEvent', 'Compensate', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E19', 'Intermediate throw link', 'bpmn:IntermediateThrowEvent', 'Link', { containers: FLOW_CONTAINERS, via: ['replace'] }),
  eventRow('E20', 'Intermediate throw message', 'bpmn:IntermediateThrowEvent', 'Message', { containers: FLOW_CONTAINERS, via: ['replace'] }, 'S'),
  eventRow('E21', 'Boundary timer (interrupting / non-interrupting)', 'bpmn:BoundaryEvent', 'Timer', { hosts: isActivityHost, via: ['replace', 'context-pad'] }),
  eventRow('E22', 'Boundary error', 'bpmn:BoundaryEvent', 'Error', { hosts: isActivityHost, via: ['replace'], filter: (s) => s.cancelActivity !== false }),
  eventRow('E23', 'Boundary message (interrupting / non-interrupting)', 'bpmn:BoundaryEvent', 'Message', { hosts: isActivityHost, via: ['replace'] }),
  eventRow('E24', 'Boundary signal (interrupting / non-interrupting)', 'bpmn:BoundaryEvent', 'Signal', { hosts: isActivityHost, via: ['replace'] }),
  eventRow('E25', 'Boundary cancel (transaction only)', 'bpmn:BoundaryEvent', 'Cancel', { hosts: (t) => t === 'bpmn:Transaction', via: ['replace'] }),
  eventRow('E26', 'Boundary compensate', 'bpmn:BoundaryEvent', 'Compensate', { hosts: isActivityHost, via: ['replace'] }),

  // --- A.2 tasks
  taskRow('T1', 'User task', 'bpmn:UserTask', ['palette', 'replace', 'append']),
  taskRow('T2', 'Service task (Java class, expression, delegate expression, connector)', 'bpmn:ServiceTask', ['palette', 'replace', 'append', 'accessor', 'template'], {}, (s) => !s.implementation || s.implementation !== DMN_DECISION_IMPLEMENTATION),
  taskRow('T6', 'Decision task (DMN)', 'bpmn:ServiceTask', ['palette', 'append', 'accessor'], {}, (s) => s.implementation === DMN_DECISION_IMPLEMENTATION),
  taskRow('T9', 'Script task', 'bpmn:ScriptTask', ['replace', 'append']),
  taskRow('T10', 'Send task (mail; the type is set by a behaviour)', 'bpmn:SendTask', ['replace']),
  taskRow('T11', 'Receive task', 'bpmn:ReceiveTask', ['replace']),
  taskRow('T12', 'Manual task', 'bpmn:ManualTask', ['replace']),
  taskRow('T13', 'Task', 'bpmn:Task', ['palette', 'replace', 'append']),
  taskRow('T14', 'Call activity', 'bpmn:CallActivity', ['replace']),

  // --- A.3 gateways, structure, data, artifacts
  taskRow('G1', 'Exclusive gateway', 'bpmn:ExclusiveGateway', ['palette', 'replace', 'append']),
  taskRow('G2', 'Parallel gateway', 'bpmn:ParallelGateway', ['replace']),
  taskRow('G3', 'Inclusive gateway', 'bpmn:InclusiveGateway', ['replace']),
  taskRow('G4', 'Event-based gateway', 'bpmn:EventBasedGateway', ['replace'], {}, (s) => !s.instantiate && (s.eventGatewayType === undefined || s.eventGatewayType === 'Exclusive')),
  taskRow('S1', 'Embedded sub process', 'bpmn:SubProcess', ['palette', 'replace'], {}, (s) => !s.triggeredByEvent),
  taskRow('S2', 'Event sub process', 'bpmn:SubProcess', ['replace'], {}, (s) => s.triggeredByEvent === true && s.isExpanded !== false),
  taskRow('S3', 'Transaction', 'bpmn:Transaction', ['replace'], {}, (s) => s.isExpanded !== false),
  taskRow('F1', 'Sequence flow', 'bpmn:SequenceFlow', ['connect', 'context-pad']),
  taskRow('D1', 'Data object', 'bpmn:DataObjectReference', ['palette', 'replace']),
  taskRow('D2', 'Data store reference', 'bpmn:DataStoreReference', ['palette', 'replace'], {}, undefined),
  taskRow('P3a', 'Pool / participant', 'bpmn:Participant', ['palette', 'replace'], { containers: ['collaboration', 'process'] }),
  taskRow('P3b', 'Lane', 'bpmn:Lane', ['context-pad'], { containers: ['collaboration', 'process'] }),
  taskRow('P3c', 'Message flow', 'bpmn:MessageFlow', ['connect', 'context-pad']),
  taskRow('A1a', 'Text annotation', 'bpmn:TextAnnotation', ['palette', 'append', 'context-pad']),
  taskRow('A1b', 'Association', 'bpmn:Association', ['connect', 'context-pad']),
  taskRow('D2b', 'Data input association', 'bpmn:DataInputAssociation', ['connect']),
  taskRow('D2c', 'Data output association', 'bpmn:DataOutputAssociation', ['connect']),
];

/** FEATURE_MATRIX §C. A spec that one of these hides is neither creatable nor offered in any menu. */
export const HIDDEN_RULES: readonly HiddenRule[] = [
  { id: 'businessRuleTask', label: 'Business rule task', why: 'NullPointerException at deployment (R1 §0.1-2)', hides: (s) => s.type === 'bpmn:BusinessRuleTask' },
  { id: 'complexGateway', label: 'Complex gateway', why: 'becomes an exclusive gateway (R1 §0.1-4)', hides: (s) => s.type === 'bpmn:ComplexGateway' },
  { id: 'adHocSubProcess', label: 'Ad-hoc sub process', why: 'hangs at run time (R1 §0.1-5)', hides: (s) => s.type === 'bpmn:AdHocSubProcess' },
  {
    id: 'unparsedEventDefinition',
    label: 'Escalation, conditional, multiple and parallel event definitions',
    why: 'not parsed or degraded (R1 §0.1-8)',
    hides: (s) =>
      s.eventDefinitionType === def('Escalation') || s.eventDefinitionType === def('Conditional') || s.multipleDefinitions === true,
  },
  {
    id: 'signalOrTimerStartInEventSubProcess',
    label: 'Signal or timer start in an event sub process',
    why: 'signal: no behaviour, timer: rejected by the validator (R1 §0.1-6)',
    hides: (s, p) =>
      s.type === 'bpmn:StartEvent' && p.container === 'eventSubProcess' && (s.eventDefinitionType === def('Signal') || s.eventDefinitionType === def('Timer')),
  },
  { id: 'signalEnd', label: 'Signal end event', why: 'the signal is not thrown (R1 §0.1-7)', hides: (s) => s.type === 'bpmn:EndEvent' && s.eventDefinitionType === def('Signal') },
  {
    id: 'linkCompensateEscalationEnd',
    label: 'Link, compensate and escalation end events',
    why: 'become a none end event (R1 §3.2)',
    hides: (s) => s.type === 'bpmn:EndEvent' && [def('Link'), def('Compensate'), def('Escalation')].includes(s.eventDefinitionType ?? ''),
  },
  {
    id: 'unsupportedServiceTaskType',
    label: 'serviceTask / sendTask activiti:type other than mail or shell',
    why: 'dmn: silently skipped, camel / mule: class missing (R1 §0.1-3, §0.1-9)',
    hides: (s) =>
      (s.type === 'bpmn:ServiceTask' || s.type === 'bpmn:SendTask') &&
      s.activitiType !== undefined &&
      !(s.type === 'bpmn:ServiceTask' ? SERVICE_TASK_TYPES : ['mail']).includes(s.activitiType),
  },
  {
    id: 'webServiceTask',
    label: 'Web service task (##WebService)',
    why: 'no CXF importer in 9.0.0 (R1 §0.1-9)',
    hides: (s) => (s.type === 'bpmn:ServiceTask' || s.type === 'bpmn:SendTask') && s.implementation === '##WebService',
  },
  { id: 'standardLoop', label: 'Standard loop marker', why: 'ignored, the task runs once (R1 §0.1-11)', hides: (s) => s.loop === 'standard' },
  { id: 'group', label: 'Group', why: 'dropped by the converter (R1 §0.1-11)', hides: (s) => s.type === 'bpmn:Group' },
  {
    id: 'scriptFormat',
    label: 'Script format without an engine',
    why: "groovy and others need a JSR-223 engine on the classpath (R1 §8.2)",
    hides: (s) => s.type === 'bpmn:ScriptTask' && s.scriptFormat !== undefined && !SUPPORTED_SCRIPT_FORMATS.includes(s.scriptFormat.toLowerCase()),
  },
  {
    id: 'typedStartInEmbeddedSubProcess',
    label: 'Typed start event inside an embedded sub process',
    why: 'SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED',
    hides: (s, p) => s.type === 'bpmn:StartEvent' && SUB.includes(p.container) && s.eventDefinitionType !== undefined,
  },
  {
    id: 'parallelEventBasedGateway',
    label: 'Instantiating (parallel) event-based gateway',
    why: 'the engine has no instantiating event gateway',
    hides: (s) => s.type === 'bpmn:EventBasedGateway' && (s.instantiate === true || s.eventGatewayType === 'Parallel'),
  },
];

export function hiddenRuleFor(spec: ElementSpec, placement: Placement): HiddenRule | undefined {
  return HIDDEN_RULES.find((rule) => rule.hides(spec, placement));
}

export function rowsFor(spec: ElementSpec, placement: Placement): MatrixRow[] {
  return MATRIX_ROWS.filter((row) => {
    if (!row.matches(spec)) return false;
    if (spec.type === 'bpmn:BoundaryEvent') return placement.attachedTo !== undefined && (row.hosts?.(placement.attachedTo) ?? false);
    if (row.containers && !row.containers.includes(placement.container)) return false;
    return true;
  });
}

export interface Verdict {
  allowed: boolean;
  rows: MatrixRow[];
  hiddenBy?: HiddenRule;
  reason?: string;
}

/** Can this variant be created (offered in a menu, dropped on the canvas) in this place? */
export function judge(spec: ElementSpec, placement: Placement): Verdict {
  const hiddenBy = hiddenRuleFor(spec, placement);
  if (hiddenBy) return { allowed: false, rows: [], hiddenBy, reason: `${hiddenBy.label}: ${hiddenBy.why}` };
  const rows = rowsFor(spec, placement);
  if (rows.length === 0) return { allowed: false, rows, reason: `${spec.type}${spec.eventDefinitionType ? ` (${spec.eventDefinitionType})` : ''} is not offered in a ${placement.container}` };
  return { allowed: true, rows };
}

export const isAllowed = (spec: ElementSpec, placement: Placement): boolean => judge(spec, placement).allowed;

/**
 * Event definitions allowed per event kind and place, as bpmn: type names; `undefined` stands for the none event.
 * Derived from the rows, e.g. no signal / timer start in an event sub process.
 */
export function allowedEventDefinitions(
  type: 'bpmn:StartEvent' | 'bpmn:EndEvent' | 'bpmn:IntermediateCatchEvent' | 'bpmn:IntermediateThrowEvent' | 'bpmn:BoundaryEvent',
  placement: Placement,
): Array<string | undefined> {
  const candidates: Array<string | undefined> = [
    undefined, ...['Message', 'Timer', 'Signal', 'Error', 'Terminate', 'Cancel', 'Compensate', 'Link', 'Escalation', 'Conditional'].map(def),
  ];
  return candidates.filter((eventDefinitionType) => isAllowed({ type, eventDefinitionType }, placement));
}

// --- from the model -------------------------------------------------------------------------------------------

const instanceOf = (el: ModdleElement | undefined, type: string): boolean => el?.$instanceOf(type) === true;

export function containerKindOf(parent: ModdleElement | undefined): ContainerKind {
  if (!parent) return 'process';
  if (instanceOf(parent, 'bpmn:AdHocSubProcess')) return 'adHocSubProcess';
  if (instanceOf(parent, 'bpmn:Transaction')) return 'transaction';
  if (instanceOf(parent, 'bpmn:SubProcess')) return parent.get('triggeredByEvent') === true ? 'eventSubProcess' : 'subProcess';
  if (instanceOf(parent, 'bpmn:Collaboration')) return 'collaboration';
  // a pool (also one without lanes) holds a process: what is offered at the process level is offered in it
  // (a message start event in the supplier pool of a collaboration)
  return 'process';
}

/** The ElementSpec of a business object (what the matrix is asked about when an element already exists). */
export function specOfBusinessObject(bo: ModdleElement, options: { isExpanded?: boolean } = {}): ElementSpec {
  const spec: ElementSpec = { type: bo.$type };
  const definitions = (bo.get('eventDefinitions') as ModdleElement[] | undefined) ?? [];
  if (definitions.length > 0) spec.eventDefinitionType = definitions[0]!.$type;
  if (definitions.length > 1 || bo.get('parallelMultiple') === true) spec.multipleDefinitions = true;
  if (instanceOf(bo, 'bpmn:StartEvent')) spec.isInterrupting = bo.get('isInterrupting') !== false;
  if (instanceOf(bo, 'bpmn:BoundaryEvent')) spec.cancelActivity = bo.get('cancelActivity') !== false;
  if (instanceOf(bo, 'bpmn:SubProcess')) spec.triggeredByEvent = bo.get('triggeredByEvent') === true;
  if (options.isExpanded !== undefined) spec.isExpanded = options.isExpanded;
  if (instanceOf(bo, 'bpmn:ServiceTask') || instanceOf(bo, 'bpmn:SendTask')) {
    const implementation = bo.get('implementation') as string | undefined;
    if (implementation) spec.implementation = implementation;
    const activitiType = bo.get('activiti:type') as string | undefined;
    if (activitiType) spec.activitiType = activitiType;
  }
  if (instanceOf(bo, 'bpmn:ScriptTask')) {
    const format = bo.get('scriptFormat') as string | undefined;
    if (format) spec.scriptFormat = format;
  }
  if (instanceOf(bo, 'bpmn:EventBasedGateway')) {
    spec.instantiate = bo.get('instantiate') === true;
    const gatewayType = bo.get('eventGatewayType') as string | undefined;
    if (gatewayType) spec.eventGatewayType = gatewayType;
  }
  const loop = bo.get('loopCharacteristics') as ModdleElement | undefined;
  if (loop) {
    if (instanceOf(loop, 'bpmn:StandardLoopCharacteristics')) spec.loop = 'standard';
    else spec.loop = loop.get('isSequential') === true ? 'sequential' : 'parallel';
  }
  return spec;
}

export function placementOf(parent: ModdleElement | undefined, host?: ModdleElement): Placement {
  const placement: Placement = { container: containerKindOf(parent) };
  if (host) placement.attachedTo = host.$type;
  return placement;
}

/** A sequence flow from an event-based gateway may only reach an intermediate catch event (R1 §7, L19). */
export function isAllowedSequenceFlow(source: ModdleElement, target: ModdleElement): boolean {
  if (instanceOf(source, 'bpmn:EventBasedGateway') && instanceOf(target, 'bpmn:FlowNode')) return instanceOf(target, 'bpmn:IntermediateCatchEvent');
  return true;
}
