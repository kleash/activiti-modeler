/**
 * The project the server e2e tests run: small, hand-written processes with the demo users of the modeler server (alice and bob, the
 * groups reviewers / managers / clerks), written into the server's workspace by the global setup. They cover what R3-R6 do: a user task
 * with a candidate group and a reminder timer, a message catch, a receive task, an asynchronous service task that fails until it is a
 * dead letter and is repaired by editing a variable, and scenarios of both.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Node {
  id: string;
  /** BPMN element name, for example `userTask`. */
  tag: string;
  name?: string;
  x: number;
  y: number;
  attrs?: string;
  /** Child XML (extension elements, event definitions). */
  inner?: string;
  w?: number;
  h?: number;
  /** For a boundary event: the id of its host. */
  attachedTo?: string;
}

interface Flow {
  id: string;
  from: string;
  to: string;
  name?: string;
  condition?: string;
}

const size = (n: Node): [number, number] => [n.w ?? (/Event$/.test(n.tag) ? 36 : /Gateway$/.test(n.tag) ? 50 : 100), n.h ?? (/Event$/.test(n.tag) ? 36 : /Gateway$/.test(n.tag) ? 50 : 80)];

function bpmn(processId: string, name: string, nodes: Node[], flows: Flow[], definitions = ''): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bounds = (n: Node): { x: number; y: number; w: number; h: number } => {
    const [w, h] = size(n);
    if (n.attachedTo) {
      const host = byId.get(n.attachedTo)!;
      const [hw, hh] = size(host);
      return { x: host.x + hw / 2 - w / 2 + n.x, y: host.y + hh - h / 2, w, h };
    }
    return { x: n.x, y: n.y, w, h };
  };
  const centre = (n: Node): { cx: number; cy: number; r: number; l: number; t: number; b: number } => {
    const b = bounds(n);
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.x + b.w, l: b.x, t: b.y, b: b.y + b.h };
  };
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_${processId}" targetNamespace="http://activiti.org/bpmn/e2e">${definitions}
  <process id="${processId}" name="${name}" isExecutable="true">`);
  for (const n of nodes) {
    const attrs = `${n.name ? ` name="${n.name}"` : ''}${n.attachedTo ? ` attachedToRef="${n.attachedTo}"` : ''}${n.attrs ? ` ${n.attrs}` : ''}`;
    out.push(n.inner ? `    <${n.tag} id="${n.id}"${attrs}>\n${n.inner}\n    </${n.tag}>` : `    <${n.tag} id="${n.id}"${attrs}/>`);
  }
  for (const f of flows) {
    const attrs = `${f.name ? ` name="${f.name}"` : ''}`;
    out.push(f.condition ? `    <sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${attrs}>\n      <conditionExpression xsi:type="tFormalExpression">${f.condition}</conditionExpression>\n    </sequenceFlow>` : `    <sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${attrs}/>`);
  }
  out.push('  </process>');
  out.push(`  <bpmndi:BPMNDiagram id="BPMNDiagram_${processId}">\n    <bpmndi:BPMNPlane id="BPMNPlane_${processId}" bpmnElement="${processId}">`);
  for (const n of nodes) {
    const b = bounds(n);
    out.push(`      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"><dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/></bpmndi:BPMNShape>`);
  }
  for (const f of flows) {
    const a = centre(byId.get(f.from)!);
    const b = centre(byId.get(f.to)!);
    const points = a.cy === b.cy ? [[a.r, a.cy], [b.l, b.cy]] : b.t > a.b || b.b < a.t ? [[a.cx, b.t > a.b ? a.b : a.t], [a.cx, b.cy], [b.l, b.cy]] : [[a.r, a.cy], [(a.r + b.l) / 2, a.cy], [(a.r + b.l) / 2, b.cy], [b.l, b.cy]];
    out.push(`      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}</bpmndi:BPMNEdge>`);
  }
  out.push('    </bpmndi:BPMNPlane>\n  </bpmndi:BPMNDiagram>\n</definitions>\n');
  return out.join('\n');
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** orderReview: review (user task, group reviewers, reminder timer) -> approved? -> payment (message catch) -> ship (receive task). */
export function orderReview(): { bpmn: string; extensions: string } {
  const xml = bpmn(
    'orderReview',
    'Order review',
    [
      { id: 'start', tag: 'startEvent', name: 'Order received', x: 60, y: 120 },
      { id: 'review', tag: 'userTask', name: 'Review order', x: 150, y: 98, attrs: 'activiti:candidateGroups="reviewers"' },
      {
        id: 'reminder', tag: 'boundaryEvent', name: 'Reminder', attachedTo: 'review', x: 0, y: 0, attrs: 'cancelActivity="false"',
        inner: '      <timerEventDefinition>\n        <timeDuration>PT1H</timeDuration>\n      </timerEventDefinition>',
      },
      { id: 'remind', tag: 'serviceTask', name: 'Note the reminder', x: 150, y: 260, attrs: `activiti:expression="\${execution.setVariable('reminded', true)}"` },
      { id: 'remindedEnd', tag: 'endEvent', name: 'Reminded', x: 300, y: 282 },
      { id: 'decision', tag: 'exclusiveGateway', name: 'Approved?', x: 310, y: 113, attrs: 'default="f_decision_rejectedEnd"' },
      {
        id: 'waitPayment', tag: 'intermediateCatchEvent', name: 'Payment received', x: 420, y: 120,
        inner: '      <messageEventDefinition messageRef="paymentReceived" activiti:correlationKey="${orderId}"/>',
      },
      { id: 'ship', tag: 'receiveTask', name: 'Ship the order', x: 510, y: 98 },
      { id: 'shippedEnd', tag: 'endEvent', name: 'Shipped', x: 660, y: 120 },
      { id: 'rejectedEnd', tag: 'endEvent', name: 'Rejected', x: 317, y: 20 },
    ],
    [
      { id: 'f_start_review', from: 'start', to: 'review' },
      { id: 'f_review_decision', from: 'review', to: 'decision' },
      { id: 'f_reminder_remind', from: 'reminder', to: 'remind' },
      { id: 'f_remind_remindedEnd', from: 'remind', to: 'remindedEnd' },
      { id: 'f_decision_waitPayment', from: 'decision', to: 'waitPayment', name: 'approved', condition: '${approved == true}' },
      { id: 'f_decision_rejectedEnd', from: 'decision', to: 'rejectedEnd', name: 'rejected' },
      { id: 'f_waitPayment_ship', from: 'waitPayment', to: 'ship' },
      { id: 'f_ship_shippedEnd', from: 'ship', to: 'shippedEnd' },
    ],
    '\n  <message id="paymentReceived" name="paymentReceived"/>',
  );
  return {
    bpmn: xml,
    extensions: json({
      id: 'process-order-review',
      extensions: {
        orderReview: {
          properties: {
            p1: { id: 'p1', name: 'orderId', type: 'string', required: true, description: 'Order number' },
            p2: { id: 'p2', name: 'amount', type: 'integer', value: 100 },
            p3: { id: 'p3', name: 'approved', type: 'boolean' },
            p4: { id: 'p4', name: 'reminded', type: 'boolean' },
          },
          mappings: { review: { mappingType: 'MAP_ALL' } },
        },
      },
    }),
  };
}

/** flaky: an asynchronous service task that fails (once, no retry) while the process variable shouldFail is true. */
export function flaky(): { bpmn: string; extensions: string } {
  const xml = bpmn(
    'flaky',
    'Flaky backend call',
    [
      { id: 'start', tag: 'startEvent', name: 'Start', x: 60, y: 120 },
      {
        id: 'callBackend', tag: 'serviceTask', name: 'Call the backend', x: 150, y: 98,
        attrs: `activiti:async="true" activiti:expression="\${shouldFail ? noSuchBean.call() : true}"`,
        inner: '      <extensionElements>\n        <activiti:failedJobRetryTimeCycle>R1/PT1S</activiti:failedJobRetryTimeCycle>\n      </extensionElements>',
      },
      { id: 'flakyEnd', tag: 'endEvent', name: 'Done', x: 300, y: 120 },
    ],
    [
      { id: 'f_start_callBackend', from: 'start', to: 'callBackend' },
      { id: 'f_callBackend_flakyEnd', from: 'callBackend', to: 'flakyEnd' },
    ],
  );
  return {
    bpmn: xml,
    extensions: json({
      id: 'process-flaky',
      extensions: { flaky: { properties: { p1: { id: 'p1', name: 'shouldFail', type: 'boolean', value: true } } } },
    }),
  };
}

/** intake: started by the message "orderPlaced" (a message start event); a clerk registers the order. */
export function intake(): { bpmn: string; extensions: string } {
  const xml = bpmn(
    'intake',
    'Order intake',
    [
      {
        id: 'orderPlacedStart', tag: 'startEvent', name: 'Order placed', x: 60, y: 120,
        inner: '      <messageEventDefinition messageRef="orderPlacedMessage"/>',
      },
      { id: 'register', tag: 'userTask', name: 'Register the order', x: 150, y: 98, attrs: 'activiti:candidateGroups="clerks"' },
      { id: 'registeredEnd', tag: 'endEvent', name: 'Registered', x: 300, y: 120 },
    ],
    [
      { id: 'f_orderPlacedStart_register', from: 'orderPlacedStart', to: 'register' },
      { id: 'f_register_registeredEnd', from: 'register', to: 'registeredEnd' },
    ],
    '\n  <message id="orderPlacedMessage" name="orderPlaced"/>',
  );
  return { bpmn: xml, extensions: json({ id: 'process-intake', extensions: { intake: {} } }) };
}

/** signalWait: waits for the signal "proceed". */
export function signalWait(): { bpmn: string; extensions: string } {
  const xml = bpmn(
    'signalWait',
    'Wait for a signal',
    [
      { id: 'start', tag: 'startEvent', name: 'Start', x: 60, y: 120 },
      { id: 'waitProceed', tag: 'intermediateCatchEvent', name: 'Proceed?', x: 150, y: 120, inner: '      <signalEventDefinition signalRef="proceedSignal"/>' },
      { id: 'proceeded', tag: 'endEvent', name: 'Proceeded', x: 250, y: 120 },
    ],
    [
      { id: 'f_start_waitProceed', from: 'start', to: 'waitProceed' },
      { id: 'f_waitProceed_proceeded', from: 'waitProceed', to: 'proceeded' },
    ],
    '\n  <signal id="proceedSignal" name="proceed"/>',
  );
  return { bpmn: xml, extensions: json({ id: 'process-signal-wait', extensions: { signalWait: {} } }) };
}

/** abortable: a task, and an event sub process that a message "abort" starts (Activiti records no activity instance for the event sub process). */
export function abortable(): { bpmn: string; extensions: string } {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_abortable" targetNamespace="http://activiti.org/bpmn/e2e">
  <message id="abortMessage" name="abort"/>
  <process id="abortable" name="Abortable work" isExecutable="true">
    <startEvent id="start" name="Start"/>
    <userTask id="work" name="Do the work" activiti:candidateGroups="clerks"/>
    <endEvent id="end" name="Done"/>
    <sequenceFlow id="f_start_work" sourceRef="start" targetRef="work"/>
    <sequenceFlow id="f_work_end" sourceRef="work" targetRef="end"/>
    <subProcess id="abortHandler" name="Abort handler" triggeredByEvent="true">
      <startEvent id="abortStart" name="Abort requested"><messageEventDefinition messageRef="abortMessage"/></startEvent>
      <userTask id="cleanup" name="Clean up" activiti:candidateGroups="clerks"/>
      <endEvent id="abortEnd" name="Aborted"/>
      <sequenceFlow id="f_abortStart_cleanup" sourceRef="abortStart" targetRef="cleanup"/>
      <sequenceFlow id="f_cleanup_abortEnd" sourceRef="cleanup" targetRef="abortEnd"/>
    </subProcess>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_abortable">
    <bpmndi:BPMNPlane id="BPMNPlane_abortable" bpmnElement="abortable">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="60" y="120" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="work_di" bpmnElement="work"><dc:Bounds x="150" y="98" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="310" y="120" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f_start_work_di" bpmnElement="f_start_work"><di:waypoint x="96" y="138"/><di:waypoint x="150" y="138"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f_work_end_di" bpmnElement="f_work_end"><di:waypoint x="250" y="138"/><di:waypoint x="310" y="138"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNShape id="abortHandler_di" bpmnElement="abortHandler" isExpanded="true"><dc:Bounds x="60" y="230" width="360" height="160"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="abortStart_di" bpmnElement="abortStart"><dc:Bounds x="90" y="300" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="cleanup_di" bpmnElement="cleanup"><dc:Bounds x="170" y="278" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="abortEnd_di" bpmnElement="abortEnd"><dc:Bounds x="320" y="300" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f_abortStart_cleanup_di" bpmnElement="f_abortStart_cleanup"><di:waypoint x="126" y="318"/><di:waypoint x="170" y="318"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f_cleanup_abortEnd_di" bpmnElement="f_cleanup_abortEnd"><di:waypoint x="270" y="318"/><di:waypoint x="320" y="318"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;
  return { bpmn: xml, extensions: json({ id: 'process-abortable', extensions: { abortable: {} } }) };
}

/** The scenarios of the project (hand-written oracles for the e2e tests; the users are the server's demo users). */
export function orderReviewScenario(): string {
  return json({
    $schema: '../../../schemas/scenario.schema.json',
    name: 'Order review',
    users: { alice: ['reviewers'], bob: ['managers'] },
    scenarios: [
      {
        name: 'an approved order is paid and shipped',
        start: { process: 'orderReview', businessKey: 'O-1', user: 'alice', variables: { orderId: 'O-1', amount: 250 } },
        steps: [
          { expectTask: { activity: 'review', candidateGroups: ['reviewers'], assignee: null } },
          { claim: { activity: 'review', user: 'alice' } },
          { completeTask: { activity: 'review', user: 'alice', variables: { approved: true } } },
          { expectActive: ['waitPayment'] },
          { message: { name: 'paymentReceived', correlationKey: 'O-1' } },
          { expectActive: ['ship'] },
          { triggerReceiveTask: { activity: 'ship' } },
        ],
        expect: { state: 'COMPLETED', endEvents: ['shippedEnd'], path: { contains: ['review', 'decision', 'waitPayment', 'ship'], notContains: ['rejectedEnd'] } },
      },
      {
        name: 'a rejected order ends at once',
        start: { process: 'orderReview', user: 'alice', variables: { orderId: 'O-2' } },
        steps: [{ completeTask: { activity: 'review', user: 'alice', variables: { approved: false } } }],
        expect: { state: 'COMPLETED', endEvents: ['rejectedEnd'], path: { notContains: ['waitPayment'] } },
      },
      {
        name: 'the reminder fires while the review is open',
        start: { process: 'orderReview', user: 'alice', variables: { orderId: 'O-3' } },
        steps: [{ fireTimer: { activity: 'reminder' } }, { expectTask: { activity: 'review' } }, { completeTask: { activity: 'review', user: 'alice', variables: { approved: false } } }],
        expect: { state: 'COMPLETED', variables: { reminded: true }, path: { contains: ['remind', 'remindedEnd'] } },
      },
    ],
  });
}

export function flakyScenario(): string {
  return json({
    $schema: '../../../schemas/scenario.schema.json',
    name: 'Flaky backend call',
    scenarios: [
      {
        name: 'the call fails until it is a dead letter',
        start: { process: 'flaky' },
        steps: [{ failJobUntilDeadLetter: { activity: 'callBackend' } }],
        expect: { state: 'DEADLETTER', deadLetterJobs: [{ activity: 'callBackend' }] },
      },
      {
        name: 'without the failure the call succeeds',
        start: { process: 'flaky', variables: { shouldFail: false } },
        steps: [{ executeJobs: {} }],
        expect: { state: 'COMPLETED', endEvents: ['flakyEnd'] },
      },
    ],
  });
}

/** A project with a business rule task, which the modeler hides and the lint rejects: token simulation must not be offered for it (U16). */
export function businessRuleProcess(): { bpmn: string; extensions: string } {
  const xml = bpmn(
    'ruleCheck',
    'Rule check',
    [
      { id: 'start', tag: 'startEvent', name: 'Start', x: 60, y: 120 },
      { id: 'rules', tag: 'businessRuleTask', name: 'Check the rules', x: 150, y: 98 },
      { id: 'end', tag: 'endEvent', name: 'End', x: 300, y: 120 },
    ],
    [
      { id: 'f_start_rules', from: 'start', to: 'rules' },
      { id: 'f_rules_end', from: 'rules', to: 'end' },
    ],
  );
  return { bpmn: xml, extensions: json({ id: 'process-rule-check', extensions: { ruleCheck: {} } }) };
}

/** Writes a file below `root`, creating folders. */
export function writeFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** The `run-demo` project: both processes, their extensions and their scenarios. */
export function writeRunDemo(root: string, name = 'run-demo'): void {
  const order = orderReview();
  const flakyProcess = flaky();
  writeFile(root, `${name}/project.json`, json({ name, version: '1.0.0', activiti: '9.0.0' }));
  writeFile(root, `${name}/processes/order-review.bpmn20.xml`, order.bpmn);
  writeFile(root, `${name}/processes/order-review-extensions.json`, order.extensions);
  writeFile(root, `${name}/processes/flaky.bpmn20.xml`, flakyProcess.bpmn);
  writeFile(root, `${name}/processes/flaky-extensions.json`, flakyProcess.extensions);
  for (const [file, part] of [['intake', intake()], ['signal-wait', signalWait()], ['abortable', abortable()]] as const) {
    writeFile(root, `${name}/processes/${file}.bpmn20.xml`, part.bpmn);
    writeFile(root, `${name}/processes/${file}-extensions.json`, part.extensions);
  }
  writeFile(root, `${name}/scenarios/order-review.scenario.json`, orderReviewScenario());
  writeFile(root, `${name}/scenarios/flaky.scenario.json`, flakyScenario());
}

export function writeRuleCheck(root: string, name = 'rule-check'): void {
  const rule = businessRuleProcess();
  writeFile(root, `${name}/project.json`, json({ name, version: '1.0.0', activiti: '9.0.0' }));
  writeFile(root, `${name}/processes/rule-check.bpmn20.xml`, rule.bpmn);
  writeFile(root, `${name}/processes/rule-check-extensions.json`, rule.extensions);
}

/** A shell task: the server refuses it (shell tasks are off), which the client-side lint does not know - an error from the engine only (R2). */
export function writeShellProject(root: string, name = 'shell-task'): void {
  const xml = bpmn(
    'shellRun',
    'Shell run',
    [
      { id: 'start', tag: 'startEvent', name: 'Start', x: 60, y: 120 },
      {
        id: 'runCommand', tag: 'serviceTask', name: 'Run a command', x: 150, y: 98, attrs: 'activiti:type="shell"',
        inner: '      <extensionElements>\n        <activiti:field name="command">\n          <activiti:string>echo</activiti:string>\n        </activiti:field>\n      </extensionElements>',
      },
      { id: 'end', tag: 'endEvent', name: 'End', x: 300, y: 120 },
    ],
    [
      { id: 'f_start_runCommand', from: 'start', to: 'runCommand' },
      { id: 'f_runCommand_end', from: 'runCommand', to: 'end' },
    ],
  );
  writeFile(root, `${name}/project.json`, json({ name, version: '1.0.0', activiti: '9.0.0' }));
  writeFile(root, `${name}/processes/shell-run.bpmn20.xml`, xml);
}

/** A process with a `group` artifact: Activiti drops it, the lint warns (no error), so a deployment asks for a confirmation (R2). */
export function writeWarningProject(root: string, name = 'warn-only'): void {
  const flakyProcess = flaky();
  const withGroup = flakyProcess.bpmn
    .replace('  </process>', '    <group id="Group_1"/>\n  </process>')
    .replace('    </bpmndi:BPMNPlane>', '      <bpmndi:BPMNShape id="Group_1_di" bpmnElement="Group_1"><dc:Bounds x="40" y="60" width="360" height="140"/></bpmndi:BPMNShape>\n    </bpmndi:BPMNPlane>')
    // a different key, so that it does not clash with the flaky process of the run-demo project on the same engine
    .replace(/flaky/g, 'grouped');
  writeFile(root, `${name}/project.json`, json({ name, version: '1.0.0', activiti: '9.0.0' }));
  writeFile(root, `${name}/processes/grouped.bpmn20.xml`, withGroup);
  writeFile(root, `${name}/processes/grouped-extensions.json`, flakyProcess.extensions.replace('"flaky"', '"grouped"').replace('process-flaky', 'process-grouped').replace('"value": true', '"value": false'));
}
