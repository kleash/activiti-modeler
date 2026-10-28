/**
 * FEATURE_MATRIX §C: the constructs the modeler hides and an import lints. The rules are derived from the support matrix
 * (`HIDDEN_RULES`) of bpmn-js-activiti, which decides what is hidden; this file only gives each hidden construct its rule
 * (message, evidence, quick fix). A test asserts that every hidden rule of the matrix is covered here or by a bpmnlint core rule.
 */
import { HIDDEN_RULES, hiddenRuleFor, placementOf, specOfBusinessObject } from '@activiti-modeler/bpmn-js-activiti/support-matrix';

import { defineRule, type RuleSpec } from '../define';
import { is, label, str } from '../model';
import type { Fixture, ME } from '../types';

/** The hidden constructs of the matrix and the rule that lints each of them (`bpmnlint/...` for the core rules the config tunes). */
export const HIDDEN_COVERAGE: Record<string, string> = {
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

const isCandidate = (node: ME): boolean => is(node, 'bpmn:FlowNode') || is(node, 'bpmn:Group');

/** The matrix's verdict on an existing element: the hidden rule that hides it, if any (the first match wins, so one construct gets one rule). */
function hiddenBy(node: ME): string | undefined {
  if (!isCandidate(node)) return undefined;
  const host = is(node, 'bpmn:BoundaryEvent') ? (node.get('attachedToRef') as ME | undefined) : undefined;
  const spec = specOfBusinessObject(node);
  return hiddenRuleFor(spec, placementOf(node.$parent, host))?.id;
}

interface Hidden {
  matrixId: string;
  id: string;
  severity: 'error' | 'warn';
  title: string;
  why: string;
  evidence: string[];
  howToFix: string;
  quickFix?: string;
  entry?: string;
  serverKeys?: string[];
  /** Extra filter on top of the matrix verdict (avoids reporting what a ProcessValidator mirror already reports). */
  only?: (node: ME) => boolean;
  message: (node: ME) => string;
  bad: Fixture[];
  good: Fixture[];
}

const ESCALATION = '<escalationEventDefinition/>';

const hidden: Hidden[] = [
  {
    matrixId: 'businessRuleTask',
    id: 'no-business-rule-task',
    severity: 'error',
    title: 'A business rule task',
    why: 'Activiti 9 has no rules engine behind `businessRuleTask`. Without an `activiti:class` the engine throws a NullPointerException while it parses the process, so the deployment fails. A Camunda `camunda:decisionRef` is not read either.',
    evidence: ['R1 §0.1-2', 'engine run t04', 'FEATURE_MATRIX §C'],
    howToFix: 'Convert it to a **Decision task** (a service task that calls `dmn-connector.EXECUTE_TABLE`) and pick the decision. The quick fix does the conversion.',
    quickFix: 'convert-business-rule-task',
    serverKeys: ['trial-deploy'],
    message: (n) => `${label(n)} is a business rule task: Activiti fails to deploy it (NullPointerException); use a Decision task`,
    bad: [{ body: '<businessRuleTask id="b"/>', ids: ['b'] }],
    good: [{ body: '<serviceTask id="b" implementation="dmn-connector.EXECUTE_TABLE"/>' }],
  },
  {
    matrixId: 'adHocSubProcess',
    id: 'no-ad-hoc-sub-process',
    severity: 'error',
    title: 'An ad-hoc sub process',
    why: 'Activiti deploys an ad-hoc sub process, enters a wait state with no way to start its inner activities, and never completes: `ordering`, `cancelRemainingInstances` and `completionCondition` are read, but nothing activates a task. (bpmnlint\'s own `ad-hoc-sub-process` rule only reports start and end events inside one.)',
    evidence: ['R1 §0.1-5', 'engine run t10', 'FEATURE_MATRIX §C'],
    howToFix: 'There is no replacement. Model the choice with an exclusive or inclusive gateway and sequence flows, or call the activities from a multi-instance call activity.',
    message: (n) => `${label(n)} is an ad-hoc sub process: Activiti waits in it forever`,
    bad: [{ body: '<adHocSubProcess id="a"><task id="t"/></adHocSubProcess>', ids: ['a'] }],
    good: [{ body: '<subProcess id="a"><startEvent id="s"/><task id="t"/><endEvent id="e"/></subProcess>' }],
  },
  {
    matrixId: 'unparsedEventDefinition',
    id: 'no-unsupported-event-definition',
    severity: 'error',
    title: 'An escalation or conditional event definition',
    why: 'The Activiti converter does not read these definitions. An escalation throw event becomes a plain throw event, a conditional start becomes a none start, an escalation end event becomes a none end, and a boundary event with one fails validation. The model says one thing and the engine does another. (Several supported definitions on one event are not reported here: the engine uses the first, engine-findings N01.4, and bpmnlint\'s `single-event-definition` reports the multiplicity.)',
    evidence: ['R1 §0.1-8', 'R1 §7.1 L6 L7', 'FEATURE_MATRIX §C'],
    howToFix: 'Replace the event by one Activiti executes: a signal, message, error or timer event, or a plain event.',
    only: (n) => (n.get('eventDefinitions') as ME[] | undefined)?.some((d) => is(d, 'bpmn:EscalationEventDefinition') || is(d, 'bpmn:ConditionalEventDefinition')) ?? false,
    message: (n) => `${label(n)} has an event definition Activiti does not read; it behaves as a plain event`,
    bad: [{ body: `<intermediateThrowEvent id="e">${ESCALATION}</intermediateThrowEvent>`, ids: ['e'] }, { body: `<task id="t"/><boundaryEvent id="b" attachedToRef="t">${ESCALATION}</boundaryEvent>`, ids: ['b'] }, { body: '<startEvent id="s"><conditionalEventDefinition><condition>${x}</condition></conditionalEventDefinition></startEvent>', ids: ['s'] }],
    good: [{ body: '<intermediateThrowEvent id="e"><compensateEventDefinition/></intermediateThrowEvent>' }],
  },
  {
    matrixId: 'signalOrTimerStartInEventSubProcess',
    id: 'no-signal-start-in-event-subprocess',
    severity: 'error',
    title: 'A signal start event in an event sub process',
    why: 'The validator accepts it, but the engine has no behaviour for it: no subscription is created and the sub process never starts. (A timer start in an event sub process is rejected by the validator and reported by `event-subprocess-invalid-start-event-definition`.)',
    evidence: ['R1 §0.1-6', 'R1 §7.1 L5', 'engine run t09'],
    howToFix: 'Use a message start event, or catch the signal with a boundary event or an event-based gateway.',
    only: (n) => is(n, 'bpmn:StartEvent') && n.get('eventDefinitions') !== undefined && (n.get('eventDefinitions') as ME[]).some((d) => is(d, 'bpmn:SignalEventDefinition')),
    message: (n) => `${label(n)} is a signal start inside an event sub process: the engine never starts it`,
    bad: [{ head: '<signal id="sig" name="go"/>', body: '<subProcess id="esp" triggeredByEvent="true"><startEvent id="s"><signalEventDefinition signalRef="sig"/></startEvent></subProcess>', ids: ['s'] }],
    good: [{ body: '<subProcess id="esp" triggeredByEvent="true"><startEvent id="s"><errorEventDefinition/></startEvent></subProcess>' }],
  },
  {
    matrixId: 'signalEnd',
    id: 'no-signal-end-event',
    severity: 'error',
    title: 'A signal end event',
    why: 'Activiti treats a signal end event as a none end event: the signal is never thrown (engine run t68).',
    evidence: ['R1 §0.1-7', 'R1 §7.1 L6', 'engine run t68'],
    howToFix: 'Throw the signal with an intermediate throw signal event, then end with a none end event. The quick fix does that.',
    quickFix: 'signal-end-to-throw',
    message: (n) => `${label(n)} is a signal end event: Activiti ends the process without throwing the signal`,
    bad: [{ head: '<signal id="sig" name="go"/>', body: '<endEvent id="e"><signalEventDefinition signalRef="sig"/></endEvent>', ids: ['e'] }],
    good: [{ head: '<signal id="sig" name="go"/>', body: '<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sig"/></intermediateThrowEvent><endEvent id="e"/>' }],
  },
  {
    matrixId: 'linkCompensateEscalationEnd',
    id: 'no-unsupported-end-event',
    severity: 'error',
    title: 'A link or compensation end event',
    why: 'Activiti turns these end events into none end events. A compensation end event does not compensate and a link end event does not jump. (An escalation end event is reported as an unsupported event definition.)',
    evidence: ['R1 §3.2', 'FEATURE_MATRIX §C'],
    howToFix: 'Use an intermediate throw compensation or link event followed by a none end event.',
    message: (n) => `${label(n)} has an end event type Activiti turns into a none end event`,
    bad: [{ body: '<endEvent id="e"><compensateEventDefinition/></endEvent>', ids: ['e'] }],
    good: [{ body: '<endEvent id="e"/>' }],
  },
  {
    matrixId: 'unsupportedServiceTaskType',
    id: 'unsupported-service-task-type',
    severity: 'error',
    title: 'A service or send task of type dmn, camel or mule',
    why: 'The validator knows these types, but `dmn` has no behaviour (the task is skipped silently at run time) and `camel` and `mule` fail at deployment because the modules are not shipped. Only `mail` and `shell` work. Other unknown types are reported by `service-task-invalid-type`.',
    evidence: ['R1 §0.1-3', 'R1 §0.1-9', 'R1 §7.1 L3', 'engine runs t06 t31 t31b'],
    howToFix: 'For a decision use a Decision task; for a mail use type mail; for anything else use a connector, a Java class or an expression.',
    only: (n) => ['dmn', 'camel', 'mule'].includes((str(n, 'activiti:type') ?? '').toLowerCase()),
    message: (n) => `${label(n)} has the type "${str(n, 'activiti:type')}", which Activiti 9 cannot run`,
    bad: [{ body: '<serviceTask id="s" activiti:type="camel"/>', ids: ['s'] }, { body: '<sendTask id="t" activiti:type="mule"/>', ids: ['t'] }],
    good: [{ body: '<serviceTask id="s" activiti:type="shell"/>' }],
  },
  {
    matrixId: 'webServiceTask',
    id: 'no-web-service-task',
    severity: 'error',
    title: 'A web service task (implementation ##WebService)',
    why: 'The importer class of the web service behaviour (`CxfWSDLImporter`) is in no Activiti 9.0.0 jar.',
    evidence: ['R1 §0.1-9', 'engine run t47'],
    howToFix: 'Call the service from a connector or a Java class.',
    message: (n) => `${label(n)} is a web service task: Activiti 9 cannot run it`,
    bad: [{ body: '<serviceTask id="w" implementation="##WebService"/>', ids: ['w'] }],
    good: [{ body: '<serviceTask id="w" implementation="crm.LOOKUP"/>' }],
  },
  {
    matrixId: 'standardLoop',
    id: 'no-standard-loop',
    severity: 'error',
    title: 'A standard loop marker',
    why: 'Activiti ignores `standardLoopCharacteristics`; the task runs once.',
    evidence: ['R1 §0.1-11', 'engine run t12'],
    howToFix: 'Model the loop with a gateway and a sequence flow back, or use a multi-instance marker.',
    quickFix: 'remove-unsupported-loop',
    message: (n) => `${label(n)} has a standard loop marker: Activiti runs it once`,
    bad: [{ body: '<task id="t"><standardLoopCharacteristics/></task>', ids: ['t'] }],
    good: [{ body: '<task id="t"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></task>' }],
  },
  {
    matrixId: 'group',
    id: 'no-group',
    severity: 'warn',
    title: 'A group',
    why: 'The converter drops a `group`; it is documentation on the canvas only and disappears from the deployed model.',
    evidence: ['R1 §0.1-11', 'engine run t14'],
    howToFix: 'Use a text annotation, or accept that the group is for the diagram only.',
    quickFix: 'remove-element',
    message: (n) => `Group ${n.id ?? ''} is dropped by Activiti`,
    bad: [{ xml: groupFixture(), ids: ['g'] }],
    good: [{ body: '<textAnnotation id="a"><text>note</text></textAnnotation>' }],
  },
  {
    matrixId: 'scriptFormat',
    id: 'unsupported-script-format',
    severity: 'error',
    title: 'A script task in a language without an engine',
    why: 'Activiti runs `juel` (the default) and `javascript` (Nashorn). Groovy and the rest need a JSR-223 engine on the application classpath: the task fails with `Can\'t find scripting engine for \'groovy\'`.',
    evidence: ['R1 §8.2', 'R1 §7.1 L14', 'engine run t13b'],
    howToFix: 'Write the script in JavaScript, or add the engine to the application and declare it in the project profile (`scriptEngines`).',
    entry: 'script.text',
    message: (n) => `${label(n)} uses the script format "${str(n, 'scriptFormat')}", for which no engine is on the classpath`,
    bad: [{ body: '<scriptTask id="s" scriptFormat="groovy"><script>x = 1</script></scriptTask>', ids: ['s'] }],
    good: [{ body: '<scriptTask id="s" scriptFormat="javascript"><script>1</script></scriptTask>' }, { body: '<scriptTask id="s" scriptFormat="groovy"><script>x = 1</script></scriptTask>', context: { scriptEngines: ['groovy'] } }],
  },
  {
    matrixId: 'parallelEventBasedGateway',
    id: 'no-instantiating-event-gateway',
    severity: 'error',
    title: 'An instantiating or parallel event-based gateway',
    why: 'Activiti has no event-based gateway that starts the process (`instantiate="true"`) and no parallel variant.',
    evidence: ['FEATURE_MATRIX §C'],
    howToFix: 'Use an exclusive event-based gateway after a start event.',
    message: (n) => `${label(n)} is an instantiating event-based gateway`,
    bad: [{ body: '<eventBasedGateway id="g" instantiate="true"/>', ids: ['g'] }],
    good: [{ body: '<eventBasedGateway id="g"/>' }],
  },
];

function groupFixture(): string {
  return `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><category id="cat"><categoryValue id="cv" value="g"/></category><process id="p" isExecutable="true"/><collaboration id="c"><participant id="pp" processRef="p"/><group id="g" categoryValueRef="cv"/></collaboration></definitions>`;
}

export const hiddenRules = hidden.map(
  (h): ReturnType<typeof defineRule> =>
    defineRule({
      id: h.id,
      tag: 'C',
      severity: h.severity,
      title: h.title,
      why: h.why,
      evidence: h.evidence,
      howToFix: h.howToFix,
      ...(h.quickFix ? { quickFix: h.quickFix } : {}),
      ...(h.entry ? { entry: h.entry } : {}),
      ...(h.serverKeys ? { serverKeys: h.serverKeys } : {}),
      check: ((node, api) => {
        if (hiddenBy(node) !== h.matrixId) return;
        if (h.matrixId === 'scriptFormat' && (api.ctx.scriptEngines ?? []).map((s) => s.toLowerCase()).includes((str(node, 'scriptFormat') ?? '').toLowerCase())) return;
        if (h.only && !h.only(node)) return;
        api.report(node, h.message(node));
      }) satisfies RuleSpec['check'],
      bad: h.bad,
      good: h.good,
    }),
);

/** Matrix ids with a rule here (the rest is covered by bpmnlint core rules or ProcessValidator mirrors). */
export const hiddenMatrixIds = HIDDEN_RULES.map((r) => r.id);
