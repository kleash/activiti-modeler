/** Mirrors of the ProcessValidator keys about start events, sub processes, sequence flows and gateways. */
import { checkJuel } from '../juel';
import { defineRule, onTypes } from '../define';
import { bool, child, engineDefinitions, expressionText, flowElementsOf, is, isBlank } from '../model';
import type { ME } from '../types';

const R1_7 = 'R1 §7 (ProcessValidator keys)';

/** Sequence flows leaving `node`, found in its container (`outgoing` is optional in the XML and often missing). */
export function outgoingFlows(node: ME): ME[] {
  const container = node.$parent;
  if (!container) return [];
  return flowElementsOf(container).filter((f) => is(f, 'bpmn:SequenceFlow') && f.get('sourceRef') === node);
}

export function incomingFlows(node: ME): ME[] {
  const container = node.$parent;
  if (!container) return [];
  return flowElementsOf(container).filter((f) => is(f, 'bpmn:SequenceFlow') && f.get('targetRef') === node);
}

const conditionOf = (flow: ME): string | undefined => expressionText(child(flow, 'conditionExpression'));
const hasCondition = (flow: ME): boolean => !isBlank(conditionOf(flow));

const processLevelStarts = (process: ME): ME[] => flowElementsOf(process).filter((e) => is(e, 'bpmn:StartEvent'));
const firstDefinitionIs = (event: ME, types: readonly string[]): boolean => {
  const first = engineDefinitions(event)[0];
  return !!first && types.some((t) => is(first, t));
};

export const structureRules = [
  defineRule({
    id: 'start-event-multiple-found',
    tag: 'V',
    key: 'START_EVENT_MULTIPLE_FOUND',
    severity: 'error',
    title: 'A process has more than one none start event',
    why: 'Activiti allows at most one start event without an event definition per process level; message, timer and signal starts may be several.',
    evidence: [R1_7],
    howToFix: 'Delete the extra start event, or give it a message, timer or signal definition.',
    serverKeys: ['START_EVENT_MULTIPLE_FOUND'],
    check: onTypes('bpmn:Process', (process, api) => {
      const none = processLevelStarts(process).filter((s) => engineDefinitions(s).length === 0);
      if (none.length > 1) for (const start of none) api.report(start, `${process.id} has ${none.length} start events without an event definition`);
    }),
    bad: [{ body: '<startEvent id="s1"/><startEvent id="s2"/>', ids: ['s1', 's2'] }],
    good: [{ body: '<startEvent id="s1"/><startEvent id="s2"><messageEventDefinition messageRef="m"/></startEvent>', head: '<message id="m" name="m"/>' }],
  }),
  defineRule({
    id: 'start-event-invalid-event-definition',
    tag: 'V',
    key: 'START_EVENT_INVALID_EVENT_DEFINITION',
    severity: 'error',
    title: 'A process start event has an event definition other than message, timer or signal',
    why: 'Only message, timer and signal starts can start a process. An error start event only exists inside an event sub process.',
    evidence: [R1_7],
    howToFix: 'Replace the start event by a none, message, timer or signal start event.',
    serverKeys: ['START_EVENT_INVALID_EVENT_DEFINITION'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const start of processLevelStarts(process)) {
        if (engineDefinitions(start).length > 0 && !firstDefinitionIs(start, ['bpmn:MessageEventDefinition', 'bpmn:TimerEventDefinition', 'bpmn:SignalEventDefinition'])) {
          api.report(start, `Start event ${start.id} has a ${engineDefinitions(start)[0]!.$type.replace('bpmn:', '').replace('EventDefinition', '').toLowerCase()} definition; a process start must be none, message, timer or signal`);
        }
      }
    }),
    bad: [{ body: '<startEvent id="s"><errorEventDefinition/></startEvent>', ids: ['s'] }],
    good: [{ body: '<startEvent id="s"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent>' }],
  }),
  defineRule({
    id: 'subprocess-multiple-start-events',
    tag: 'V',
    key: 'SUBPROCESS_MULTIPLE_START_EVENTS',
    severity: 'error',
    title: 'An embedded sub process or transaction has more than one start event',
    why: 'An embedded sub process starts at its single none start event.',
    evidence: [R1_7],
    howToFix: 'Keep one start event.',
    serverKeys: ['SUBPROCESS_MULTIPLE_START_EVENTS'],
    check: onTypes('bpmn:SubProcess', (sub, api) => {
      if (bool(sub, 'triggeredByEvent')) return;
      const starts = flowElementsOf(sub).filter((e) => is(e, 'bpmn:StartEvent'));
      if (starts.length > 1) api.report(sub, `${sub.id} has ${starts.length} start events`);
    }),
    bad: [{ body: '<subProcess id="sp"><startEvent id="a"/><startEvent id="b"/></subProcess>', ids: ['sp'] }],
    good: [{ body: '<subProcess id="sp"><startEvent id="a"/></subProcess>' }],
  }),
  defineRule({
    id: 'subprocess-start-event-event-definition-not-allowed',
    tag: 'V',
    key: 'SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED',
    severity: 'error',
    title: 'The start event of an embedded sub process has an event definition',
    why: 'Only a none start event may start an embedded sub process or transaction.',
    evidence: [R1_7],
    howToFix: 'Use a none start event inside the sub process.',
    serverKeys: ['SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED'],
    check: onTypes('bpmn:SubProcess', (sub, api) => {
      if (bool(sub, 'triggeredByEvent')) return;
      for (const start of flowElementsOf(sub).filter((e) => is(e, 'bpmn:StartEvent'))) {
        if (engineDefinitions(start).length > 0) api.report(start, `Start event ${start.id} of ${sub.id} has an event definition`);
      }
    }),
    bad: [{ body: '<subProcess id="sp"><startEvent id="a"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent></subProcess>', ids: ['a'] }],
    good: [{ body: '<subProcess id="sp"><startEvent id="a"/></subProcess>' }],
  }),
  defineRule({
    id: 'event-subprocess-invalid-start-event-definition',
    tag: 'V',
    key: 'EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION',
    severity: 'error',
    title: 'The start event of an event sub process is not an error, message or signal start',
    why: 'The validator accepts error, message and signal; a timer start is rejected, and a signal start is accepted but never works (see the next rule).',
    evidence: [R1_7, 'R1 §0.1-6'],
    howToFix: 'Use an error or message start event.',
    serverKeys: ['EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION'],
    check: onTypes('bpmn:SubProcess', (sub, api) => {
      if (!bool(sub, 'triggeredByEvent')) return;
      for (const start of flowElementsOf(sub).filter((e) => is(e, 'bpmn:StartEvent'))) {
        if (engineDefinitions(start).length > 0 && !firstDefinitionIs(start, ['bpmn:ErrorEventDefinition', 'bpmn:MessageEventDefinition', 'bpmn:SignalEventDefinition'])) {
          api.report(sub, `Event sub process ${sub.id}: the start event must be of type error, message or signal`);
        }
      }
    }),
    bad: [{ body: '<subProcess id="esp" triggeredByEvent="true"><startEvent id="a"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent></subProcess>', ids: ['esp'] }],
    good: [{ body: '<subProcess id="esp" triggeredByEvent="true"><startEvent id="a"><errorEventDefinition/></startEvent></subProcess>' }],
  }),
  defineRule({
    id: 'seq-flow-invalid-src',
    tag: 'V',
    key: 'SEQ_FLOW_INVALID_SRC',
    severity: 'error',
    title: 'A sequence flow has no valid source',
    why: 'Activiti rejects a sequence flow whose `sourceRef` is empty or names an element that does not exist.',
    evidence: [R1_7],
    howToFix: 'Reconnect the flow, or delete it.',
    quickFix: 'remove-element',
    serverKeys: ['SEQ_FLOW_INVALID_SRC'],
    check: onTypes('bpmn:SequenceFlow', (flow, api) => {
      if (!flow.get('sourceRef')) api.report(flow, `Sequence flow ${flow.id} has no source element`);
    }),
    bad: [{ body: '<task id="t"/><sequenceFlow id="f" targetRef="t"/>', ids: ['f'] }],
    good: [{ body: '<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"/>' }],
  }),
  defineRule({
    id: 'seq-flow-invalid-target',
    tag: 'V',
    key: 'SEQ_FLOW_INVALID_TARGET',
    severity: 'error',
    title: 'A sequence flow has no valid target',
    why: 'Activiti rejects a sequence flow whose `targetRef` is empty or names an element that does not exist.',
    evidence: [R1_7],
    howToFix: 'Reconnect the flow, or delete it.',
    quickFix: 'remove-element',
    serverKeys: ['SEQ_FLOW_INVALID_TARGET'],
    check: onTypes('bpmn:SequenceFlow', (flow, api) => {
      if (!flow.get('targetRef')) api.report(flow, `Sequence flow ${flow.id} has no target element`);
    }),
    bad: [{ body: '<task id="t"/><sequenceFlow id="f" sourceRef="t"/>', ids: ['f'] }],
    good: [{ body: '<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"/>' }],
  }),
  defineRule({
    id: 'seq-flow-invalid-target-different-scope',
    tag: 'V',
    key: 'SEQ_FLOW_INVALID_TARGET_DIFFERENT_SCOPE',
    severity: 'error',
    title: 'A sequence flow connects elements of different containers',
    why: 'A sequence flow cannot cross the border of a sub process; use the sub process\'s own start and end events.',
    evidence: [R1_7],
    howToFix: 'Move one of the elements, or end the sub process and continue after it.',
    serverKeys: ['SEQ_FLOW_INVALID_TARGET_DIFFERENT_SCOPE'],
    check: onTypes('bpmn:SequenceFlow', (flow, api) => {
      const source = flow.get('sourceRef') as ME | undefined;
      const target = flow.get('targetRef') as ME | undefined;
      if (source && target && source.$parent !== target.$parent) api.report(flow, `Sequence flow ${flow.id} connects ${source.id} and ${target.id}, which are in different containers`);
    }),
    bad: [{ body: '<task id="t"/><subProcess id="sp"><task id="in"/></subProcess><sequenceFlow id="f" sourceRef="t" targetRef="in"/>', ids: ['f'] }],
    good: [{ body: '<task id="t"/><subProcess id="sp"><task id="in"/></subProcess><sequenceFlow id="f" sourceRef="t" targetRef="sp"/>' }],
  }),
  defineRule({
    id: 'seq-flow-invalid-conditional-expression',
    tag: 'V',
    key: 'SEQ_FLOW_INVALID_CONDITIONAL_EXPRESSION',
    severity: 'error',
    title: 'The condition of a sequence flow is not a valid JUEL expression',
    why: 'Activiti parses every condition with its expression factory when the process is deployed and rejects the file if one does not parse. Conditions are JUEL (`${amount > 100}`), not scripts: there is no assignment and no `;`.',
    evidence: [R1_7, 'R1 §8.1'],
    howToFix: 'Fix the expression in the **Condition** field of the flow.',
    entry: 'flow.condition',
    serverKeys: ['SEQ_FLOW_INVALID_CONDITIONAL_EXPRESSION'],
    check: onTypes('bpmn:SequenceFlow', (flow, api) => {
      const condition = conditionOf(flow);
      if (isBlank(condition)) return;
      const result = checkJuel(condition!.trim());
      if (result.issues.length > 0) api.report(flow, `Condition of ${flow.id}: ${result.issues[0]!.message}`);
    }),
    bad: [{ body: '<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"><conditionExpression>${amount &gt; }</conditionExpression></sequenceFlow>', ids: ['f'] }],
    good: [{ body: '<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"><conditionExpression xsi:type="tFormalExpression">${amount &gt; 100 &amp;&amp; !empty(name)}</conditionExpression></sequenceFlow>' }],
  }),
  defineRule({
    id: 'exclusive-gateway-no-outgoing-seq-flow',
    tag: 'V',
    key: 'EXCLUSIVE_GATEWAY_NO_OUTGOING_SEQ_FLOW',
    severity: 'error',
    title: 'An exclusive gateway has no outgoing sequence flow',
    why: 'A token that reaches the gateway could not leave.',
    evidence: [R1_7],
    howToFix: 'Connect the gateway to the next step.',
    serverKeys: ['EXCLUSIVE_GATEWAY_NO_OUTGOING_SEQ_FLOW'],
    check: onTypes('bpmn:ExclusiveGateway', (gateway, api) => {
      if (outgoingFlows(gateway).length === 0) api.report(gateway, `Exclusive gateway ${gateway.id} has no outgoing sequence flow`);
    }),
    bad: [{ body: '<exclusiveGateway id="g"/>', ids: ['g'] }],
    good: [{ body: '<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"/>' }],
  }),
  defineRule({
    id: 'exclusive-gateway-condition-not-allowed-on-single-seq-flow',
    tag: 'V',
    key: 'EXCLUSIVE_GATEWAY_CONDITION_NOT_ALLOWED_ON_SINGLE_SEQ_FLOW',
    severity: 'error',
    title: 'The only outgoing flow of an exclusive gateway has a condition',
    why: 'With a single way out the condition is meaningless and Activiti rejects it.',
    evidence: [R1_7],
    howToFix: 'Remove the condition, or add the other branches.',
    entry: 'flow.condition',
    serverKeys: ['EXCLUSIVE_GATEWAY_CONDITION_NOT_ALLOWED_ON_SINGLE_SEQ_FLOW'],
    check: onTypes('bpmn:ExclusiveGateway', (gateway, api) => {
      const out = outgoingFlows(gateway);
      if (out.length === 1 && hasCondition(out[0]!)) api.report(gateway, `The only outgoing flow ${out[0]!.id} of exclusive gateway ${gateway.id} has a condition`);
    }),
    bad: [{ body: '<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"><conditionExpression>${x}</conditionExpression></sequenceFlow>', ids: ['g'] }],
    good: [{ body: '<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"/>' }],
  }),
  defineRule({
    id: 'exclusive-gateway-condition-on-default-seq-flow',
    tag: 'V',
    key: 'EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW',
    severity: 'error',
    title: 'The default flow of an exclusive gateway has a condition',
    why: 'The default flow is taken when no other condition is true, so it must not have a condition of its own.',
    evidence: [R1_7],
    howToFix: 'Remove the condition from the default flow.',
    entry: 'flow.condition',
    serverKeys: ['EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW'],
    check: onTypes('bpmn:ExclusiveGateway', (gateway, api) => {
      const out = outgoingFlows(gateway);
      if (out.length < 2) return;
      const fallback = gateway.get('default') as ME | undefined;
      if (fallback && hasCondition(fallback)) api.report(gateway, `The default flow ${fallback.id} of exclusive gateway ${gateway.id} has a condition`);
    }),
    bad: [{ body: '<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"><conditionExpression>${x}</conditionExpression></sequenceFlow><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>', ids: ['g'] }],
    good: [{ body: '<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>' }],
  }),
  defineRule({
    id: 'exclusive-gateway-seq-flow-without-conditions',
    tag: 'V',
    key: 'EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS',
    severity: 'warn',
    title: 'An exclusive gateway has outgoing flows without a condition that are not the default',
    why: 'Activiti takes the first flow whose condition is true; a flow without a condition is always true, so it hides the flows after it. The engine warns about it.',
    evidence: [R1_7],
    howToFix: 'Add a condition to the flow, or make it the default flow.',
    entry: 'flow.condition',
    serverKeys: ['EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS'],
    check: onTypes('bpmn:ExclusiveGateway', (gateway, api) => {
      const out = outgoingFlows(gateway);
      if (out.length < 2) return;
      const fallback = gateway.get('default') as ME | undefined;
      const open = out.filter((f) => !hasCondition(f) && f !== fallback);
      if (open.length > 0) api.report(gateway, `Exclusive gateway ${gateway.id}: ${open.map((f) => f.id).join(', ')} has no condition and is not the default flow`);
    }),
    bad: [{ body: '<exclusiveGateway id="g"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>', ids: ['g'] }],
    good: [{ body: '<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>' }],
  }),
  defineRule({
    id: 'event-gateway-only-connected-to-intermediate-events',
    tag: 'V',
    key: 'EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS',
    severity: 'error',
    title: 'An event-based gateway leads to something other than an intermediate catch event',
    why: 'Activiti waits for the first of the events behind an event-based gateway. A receive task is rejected (L19), so is any other target.',
    evidence: [R1_7, 'R1 §7.1 L19'],
    howToFix: 'Put an intermediate catch event (message, signal or timer) after the gateway; use a receive task after the event if you need one.',
    serverKeys: ['EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS'],
    check: onTypes('bpmn:EventBasedGateway', (gateway, api) => {
      for (const flow of outgoingFlows(gateway)) {
        const target = flow.get('targetRef') as ME | undefined;
        if (target && !is(target, 'bpmn:IntermediateCatchEvent')) api.report(gateway, `Event-based gateway ${gateway.id} leads to ${target.id}, which is not an intermediate catch event`);
      }
    }),
    bad: [{ body: '<eventBasedGateway id="g"/><receiveTask id="r"/><sequenceFlow id="f" sourceRef="g" targetRef="r"/>', ids: ['g'] }],
    good: [{ body: '<eventBasedGateway id="g"/><intermediateCatchEvent id="c"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent><sequenceFlow id="f" sourceRef="g" targetRef="c"/>' }],
  }),
];

