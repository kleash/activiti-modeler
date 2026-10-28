import { expect } from 'vitest';

import type { DiagramBuilder } from '../../builder';
import type { ProcessExtension } from '@activiti-modeler/activiti-project';

/**
 * One case per accessor: what to set on which element, and the exact XML / JSON that must result. The accessor tests
 * run every case (set, export, re-import and get, undo, redo) and fail when an accessor has no case.
 */
export interface AccessorCase {
  key: string;
  /** Elements to create first (ids from SCENE). */
  needs?: string[];
  /** Extra preparation after `needs`, e.g. set the multi-instance type before its attributes. */
  prepare?: (b: DiagramBuilder) => void;
  element: string;
  value: unknown;
  /** Strings or patterns the exported BPMN must contain. */
  xml?: Array<string | RegExp>;
  /** Strings or patterns that must be absent. */
  notXml?: Array<string | RegExp>;
  /** Check on the process extension in the exported JSON. */
  json?: (ext: ProcessExtension) => void;
  /** What `get` returns after the set (default: the value). A function checks it. */
  get?: unknown;
  /** Id of the element after the set (renames). */
  idAfter?: string;
  /** Values that must be refused with this message, without changing anything. */
  invalid?: Array<[value: unknown, message: RegExp]>;
}

type Maker = (b: DiagramBuilder) => void;

/** The elements the cases work on. */
export const SCENE: Record<string, Maker> = {
  u: (b) => void b.createShape({ type: 'userTask', id: 'u' }),
  svc: (b) => void b.createShape({ type: 'serviceTask', id: 'svc' }),
  svcc: (b) => void b.createShape({ type: 'serviceTask', id: 'svcc', attrs: { 'activiti:class': 'a.B' } }),
  mail: (b) => void b.createShape({ type: 'serviceTask', id: 'mail', attrs: { 'activiti:type': 'mail' } }),
  shell: (b) => void b.createShape({ type: 'serviceTask', id: 'shell', attrs: { 'activiti:type': 'shell' } }),
  dec: (b) => void b.createShape({ type: 'serviceTask', id: 'dec', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } }),
  send: (b) => void b.createShape({ type: 'sendTask', id: 'send' }),
  script: (b) => void b.createShape({ type: 'scriptTask', id: 'script' }),
  call: (b) => void b.createShape({ type: 'callActivity', id: 'call' }),
  gw: (b) => void b.createShape({ type: 'exclusiveGateway', id: 'gw' }),
  end: (b) => void b.createShape({ type: 'endEvent', id: 'end' }),
  flow: (b) => {
    SCENE['u']!(b);
    SCENE['gw']!(b);
    b.connect('u', 'gw', { id: 'flow' });
  },
  flow2: (b) => {
    SCENE['gw']!(b);
    SCENE['svc']!(b);
    b.connect('gw', 'svc', { id: 'flow2' });
  },
  catchTimer: (b) => void b.createShape({ type: 'intermediateCatchEvent', id: 'catchTimer', eventDefinition: 'timer' }),
  catchMsg: (b) => void b.createShape({ type: 'intermediateCatchEvent', id: 'catchMsg', eventDefinition: 'message' }),
  catchSig: (b) => void b.createShape({ type: 'intermediateCatchEvent', id: 'catchSig', eventDefinition: 'signal' }),
  throwLink: (b) => void b.createShape({ type: 'intermediateThrowEvent', id: 'throwLink', eventDefinition: 'link' }),
  catchLink: (b) => void b.createShape({ type: 'intermediateCatchEvent', id: 'catchLink', eventDefinition: 'link' }),
  throwComp: (b) => void b.createShape({ type: 'intermediateThrowEvent', id: 'throwComp', eventDefinition: 'compensate' }),
  endError: (b) => void b.createShape({ type: 'endEvent', id: 'endError', eventDefinition: 'error' }),
  endTerm: (b) => void b.createShape({ type: 'endEvent', id: 'endTerm', eventDefinition: 'terminate' }),
  plainEvent: (b) => void b.createShape({ type: 'intermediateThrowEvent', id: 'plainEvent' }),
  boundary: (b) => {
    SCENE['u']!(b);
    b.createShape({ type: 'boundaryEvent', id: 'bt', attachedTo: 'u', eventDefinition: 'timer' });
  },
  data: (b) => void b.createShape({ type: 'dataObjectReference', id: 'data' }),
  sp: (b) => void b.createShape({ type: 'subProcess', id: 'sp' }),
};

const flowIds = ['u', 'gw'];
void flowIds;

const hasJson = (ext: ProcessExtension): ProcessExtension => ext;
void hasJson;

const FIELD_VALUE_XML = (name: string, value: string): RegExp => new RegExp(`<activiti:field name="${name}">\\s*<activiti:string>${value}</activiti:string>\\s*</activiti:field>`);

/** Mail and shell fields share one shape of case. */
const fieldCases = (group: 'mail' | 'shell', element: string, names: string[]): AccessorCase[] =>
  names.map((name, i) => ({
    key: `${group}.${name}`,
    needs: [element],
    element,
    value: i % 4 === 3 ? { expression: '${v}' } : `value-${name}`,
    xml: i % 4 === 3 ? [new RegExp(`<activiti:field name="${name}">\\s*<activiti:expression>\\$\\{v\\}</activiti:expression>`)] : [FIELD_VALUE_XML(name, `value-${name}`)],
  }));

export const MAIL_FIELDS = ['to', 'from', 'cc', 'bcc', 'subject', 'text', 'textVar', 'html', 'htmlVar', 'charset', 'ignoreException', 'exceptionVariableName', 'attachments'];
export const SHELL_FIELDS = ['command', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'wait', 'redirectError', 'cleanEnv', 'outputVariable', 'errorCodeVariable', 'directory'];

const loop = (b: DiagramBuilder): void => b.setProperty('u', 'mi.type', 'parallel');

export const ACCESSOR_CASES: AccessorCase[] = [
  // --- General / documentation
  { key: 'general.name', needs: ['u'], element: 'u', value: 'Review', xml: ['name="Review"'], invalid: [[42, /must be a string/]] },
  { key: 'general.id', needs: ['u', 'svc'], element: 'u', value: 'review', idAfter: 'review', xml: ['id="review"', 'bpmnElement="review"'], invalid: [['bad id', /not a valid NCName/], ['1x', /not a valid NCName/], ['a'.repeat(256), /limit is 255/], ['svc', /already used/]] },
  { key: 'general.executable', element: 'Process_1', value: true, get: true, invalid: [[false, /forced to true/]] },
  { key: 'general.targetNamespace', element: 'Process_1', value: 'http://example.org/ns', xml: ['targetNamespace="http://example.org/ns"'], invalid: [['x'.repeat(256), /255 characters/]] },
  { key: 'documentation.text', needs: ['u'], element: 'u', value: 'Do the review', xml: [/<bpmn:documentation>Do the review<\/bpmn:documentation>/], invalid: [[42, /must be a string/]] },

  // --- Candidate starters
  { key: 'starters.users', element: 'Process_1', value: 'kermit,fozzie', xml: ['activiti:candidateStarterUsers="kermit,fozzie"'] },
  { key: 'starters.groups', element: 'Process_1', value: 'muppets', xml: ['activiti:candidateStarterGroups="muppets"'] },
  { key: 'starters.potential', element: 'Process_1', value: 'user(kermit), group(muppets)', xml: [/<activiti:potentialStarter>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(kermit\), group\(muppets\)<\/bpmn:formalExpression>/] },

  // --- Process variables
  {
    key: 'variables.list',
    element: 'Process_1',
    value: [{ name: 'amount', type: 'integer', value: 5, required: true }, { name: 'note', type: 'string', description: 'free text' }],
    get: (v: unknown) => expect(v).toMatchObject([{ name: 'amount', type: 'integer', value: 5, required: true }, { name: 'note', type: 'string', description: 'free text', required: false }]),
    json: (ext) => expect(Object.values(ext.properties).map((p) => [p.name, p.type])).toEqual([['amount', 'integer'], ['note', 'string']]),
    invalid: [
      [[{ name: 'x', type: 'mystery', value: 1 }], /not one of/],
      [[{ name: 'x', type: 'integer', value: 'abc' }], /does not fit type integer/],
      [[{ name: 'x', type: 'string' }, { name: 'x', type: 'string' }], /declared twice/],
      [[{ name: '', type: 'string' }], /needs a name/],
    ],
  },

  // --- User assignment
  { key: 'user.assignee', needs: ['u'], element: 'u', value: 'kermit', xml: ['activiti:assignee="kermit"'] },
  { key: 'user.owner', needs: ['u'], element: 'u', value: 'fozzie', xml: ['activiti:owner="fozzie"'] },
  { key: 'user.candidateUsers', needs: ['u'], element: 'u', value: 'a,b', xml: ['activiti:candidateUsers="a,b"'] },
  { key: 'user.candidateGroups', needs: ['u'], element: 'u', value: 'sales,${dept}', xml: ['activiti:candidateGroups="sales,${dept}"'] },
  { key: 'user.dueDate', needs: ['u'], element: 'u', value: 'P2D', xml: ['activiti:dueDate="P2D"'] },
  { key: 'user.priority', needs: ['u'], element: 'u', value: '75', xml: ['activiti:priority="75"'] },
  { key: 'user.category', needs: ['u'], element: 'u', value: 'approvals', xml: ['activiti:category="approvals"'] },
  { key: 'user.businessCalendarName', needs: ['u'], element: 'u', value: 'workdays', xml: ['activiti:businessCalendarName="workdays"'] },
  { key: 'user.humanPerformer', needs: ['u'], element: 'u', value: 'user(kermit)', xml: [/<bpmn:humanPerformer>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(kermit\)<\/bpmn:formalExpression>/] },
  { key: 'user.potentialOwner', needs: ['u'], element: 'u', value: 'user(a), group(b)', xml: [/<bpmn:potentialOwner>\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(a\), group\(b\)<\/bpmn:formalExpression>/] },
  {
    key: 'user.customResource',
    needs: ['u'],
    element: 'u',
    value: [{ name: 'witness', expression: 'user(a), group(b)' }],
    xml: [/<activiti:customResource name="witness">\s*<bpmn:resourceAssignmentExpression>\s*<bpmn:formalExpression>user\(a\), group\(b\)<\/bpmn:formalExpression>/],
    invalid: [[[{ name: '', expression: 'user(a)' }], /needs a name/]],
  },
  { key: 'start.initiator', element: 'StartEvent_1', value: 'startedBy', xml: ['activiti:initiator="startedBy"'] },
  { key: 'form.key', needs: ['u'], element: 'u', value: 'approval-form', xml: ['activiti:formKey="approval-form"'] },
  {
    key: 'form.properties',
    needs: ['u'],
    element: 'u',
    value: [{ id: 'amount', name: 'Amount', type: 'long', required: 'true', values: [{ id: 'a', name: 'A' }] }],
    xml: [/<activiti:formProperty id="amount" name="Amount" type="long" required="true">\s*<activiti:value id="a" name="A" \/>\s*<\/activiti:formProperty>/],
    invalid: [[[{ name: 'no id' }], /needs an id/]],
  },

  // --- Implementation
  { key: 'impl.type', needs: ['svc'], element: 'svc', value: 'mail', xml: ['activiti:type="mail"'], notXml: ['activiti:class'] },
  { key: 'impl.class', needs: ['svc'], element: 'svc', value: 'org.acme.Delegate', xml: ['activiti:class="org.acme.Delegate"'], invalid: [] },
  { key: 'impl.expression', needs: ['svc'], element: 'svc', value: '${service.run()}', xml: ['activiti:expression="${service.run()}"'] },
  { key: 'impl.delegateExpression', needs: ['svc'], element: 'svc', value: '${delegate}', xml: ['activiti:delegateExpression="${delegate}"'] },
  { key: 'impl.resultVariable', needs: ['svc'], prepare: (b) => b.setProperty('svc', 'impl.expression', '${x}'), element: 'svc', value: 'answer', xml: ['activiti:resultVariableName="answer"', 'activiti:expression="${x}"'] },
  { key: 'impl.connector', needs: ['svc'], element: 'svc', value: 'mailer.SEND', xml: ['implementation="mailer.SEND"'], invalid: [['##WebService', /web service tasks are not supported/]] },
  { key: 'decision.table', needs: ['dec'], element: 'dec', value: 'risk', json: (ext) => expect(ext.constants['dec']).toEqual({ _activiti_dmn_table_: { value: 'risk' } }), xml: ['implementation="dmn-connector.EXECUTE_TABLE"'] },
  {
    key: 'fields.list',
    needs: ['svcc'],
    element: 'svcc',
    value: [{ name: 'greeting', string: 'hello' }, { name: 'who', expression: '${person}' }],
    xml: [FIELD_VALUE_XML('greeting', 'hello'), /<activiti:field name="who">\s*<activiti:expression>\$\{person\}<\/activiti:expression>/],
    invalid: [[[{ name: 'a', string: 'x' }, { name: 'a', string: 'y' }], /declared twice/], [[{ name: '', string: 'x' }], /needs a name/], [[{ name: 'a', string: 'x', expression: 'y' }], /both a string and an expression/]],
  },
  ...fieldCases('mail', 'mail', MAIL_FIELDS),
  ...fieldCases('shell', 'shell', SHELL_FIELDS),

  // --- Script, called element
  { key: 'script.format', needs: ['script'], element: 'script', value: 'javascript', xml: ['scriptFormat="javascript"'] },
  { key: 'script.text', needs: ['script'], element: 'script', value: 'var x = 1;', xml: [/<bpmn:script>var x = 1;<\/bpmn:script>/] },
  { key: 'script.resultVariable', needs: ['script'], element: 'script', value: 'result', xml: ['activiti:resultVariable="result"'] },
  { key: 'script.autoStoreVariables', needs: ['script'], element: 'script', value: true, xml: ['activiti:autoStoreVariables="true"'] },
  { key: 'call.calledElement', needs: ['call'], element: 'call', value: 'childProcess', xml: ['calledElement="childProcess"'] },
  { key: 'call.businessKey', needs: ['call'], element: 'call', value: '${orderId}', xml: ['activiti:businessKey="${orderId}"'] },
  { key: 'call.inheritBusinessKey', needs: ['call'], element: 'call', value: true, xml: ['activiti:inheritBusinessKey="true"'] },
  { key: 'call.inheritVariables', needs: ['call'], element: 'call', value: true, xml: ['activiti:inheritVariables="true"'] },
  {
    key: 'call.in',
    needs: ['call'],
    element: 'call',
    value: [{ source: 'a', target: 'b' }, { sourceExpression: '${x + 1}', target: 'c' }],
    xml: ['<activiti:in source="a" target="b" />', '<activiti:in sourceExpression="${x + 1}" target="c" />'],
    invalid: [[[{ source: 'a', target: '' }], /needs a target/], [[{ target: 't' }], /needs a source or a sourceExpression/]],
  },
  { key: 'call.out', needs: ['call'], element: 'call', value: [{ source: 'r', target: 'result' }], xml: ['<activiti:out source="r" target="result" />'] },

  // --- Multi-instance, async, jobs
  { key: 'mi.type', needs: ['u'], element: 'u', value: 'sequential', xml: [/<bpmn:multiInstanceLoopCharacteristics isSequential="true"/], invalid: [['loop', /not one of/]] },
  { key: 'mi.cardinality', needs: ['u'], prepare: loop, element: 'u', value: '3', xml: [/<bpmn:loopCardinality[^>]*>3<\/bpmn:loopCardinality>/] },
  { key: 'mi.collection', needs: ['u'], prepare: loop, element: 'u', value: 'people', xml: ['activiti:collection="people"'] },
  { key: 'mi.elementVariable', needs: ['u'], prepare: loop, element: 'u', value: 'person', xml: ['activiti:elementVariable="person"'] },
  { key: 'mi.elementIndexVariable', needs: ['u'], prepare: loop, element: 'u', value: 'idx', xml: ['activiti:elementIndexVariable="idx"'] },
  { key: 'mi.completionCondition', needs: ['u'], prepare: loop, element: 'u', value: '${nrOfCompletedInstances >= 1}', xml: [/<bpmn:completionCondition[^>]*>\$\{nrOfCompletedInstances &gt;= 1\}<\/bpmn:completionCondition>/] },
  { key: 'mi.outputCollection', needs: ['u'], prepare: loop, element: 'u', value: 'results', xml: ['<bpmn:loopDataOutputRef>results</bpmn:loopDataOutputRef>'], notXml: ['activiti:loopDataOutputRef'] },
  { key: 'mi.outputItem', needs: ['u'], prepare: loop, element: 'u', value: 'res', xml: [/<bpmn:outputDataItem[^>]* name="res"/] },
  { key: 'async.async', needs: ['svc'], element: 'svc', value: true, xml: ['activiti:async="true"'] },
  { key: 'async.exclusive', needs: ['svc'], element: 'svc', value: false, xml: ['activiti:exclusive="false"'] },
  { key: 'job.failedJobRetryTimeCycle', needs: ['svc'], element: 'svc', value: 'R5/PT7M', xml: ['<activiti:failedJobRetryTimeCycle>R5/PT7M</activiti:failedJobRetryTimeCycle>'] },
  {
    key: 'errors.mapExceptions',
    needs: ['svcc'],
    element: 'svcc',
    value: [{ errorCode: 'E1', exceptionClass: 'java.lang.IllegalStateException', includeChildExceptions: true }],
    xml: ['<activiti:mapException errorCode="E1" includeChildExceptions="true">java.lang.IllegalStateException</activiti:mapException>'],
    invalid: [[[{ errorCode: '', exceptionClass: 'x' }], /needs an errorCode/]],
  },
  { key: 'skip.expression', needs: ['u'], element: 'u', value: '${skipIt}', xml: ['activiti:skipExpression="${skipIt}"'] },

  // --- Event definitions
  { key: 'event.definition', needs: ['plainEvent'], element: 'plainEvent', value: 'signal', get: 'signal', xml: [/<bpmn:signalEventDefinition/], invalid: [['escalation', /not one of/]] },
  { key: 'timer.definition', needs: ['catchTimer'], element: 'catchTimer', value: { type: 'duration', value: 'PT10M' }, xml: [/<bpmn:timeDuration[^>]*>PT10M<\/bpmn:timeDuration>/], invalid: [[{ type: 'duration', value: '' }, /needs a value/], [{ type: 'date', value: '2030-01-01T00:00:00', endDate: 'x' }, /only applies to a cycle/]] },
  { key: 'timer.businessCalendarName', needs: ['catchTimer'], element: 'catchTimer', value: 'office', xml: ['activiti:businessCalendarName="office"'] },
  { key: 'message.ref', needs: ['catchMsg'], element: 'catchMsg', value: 'orderPlaced', xml: [/<bpmn:message id="Message_[^"]+" name="orderPlaced" \/>/, /messageRef="Message_/] },
  { key: 'message.expression', needs: ['catchMsg'], element: 'catchMsg', value: '${msgName}', xml: ['activiti:messageExpression="${msgName}"'] },
  { key: 'message.correlationKey', needs: ['catchMsg'], element: 'catchMsg', value: '${orderId}', xml: ['activiti:correlationKey="${orderId}"'] },
  { key: 'message.class', needs: ['catchMsg'], element: 'catchMsg', value: 'org.acme.Sender', xml: ['activiti:class="org.acme.Sender"'] },
  { key: 'message.delegateExpression', needs: ['catchMsg'], element: 'catchMsg', value: '${sender}', xml: ['activiti:delegateExpression="${sender}"'] },
  { key: 'message.fields', needs: ['catchMsg'], element: 'catchMsg', value: [{ name: 'payload', expression: '${order}' }], xml: [/<bpmn:messageEventDefinition[^>]*>\s*<bpmn:extensionElements>\s*<activiti:field name="payload">\s*<activiti:expression>\$\{order\}<\/activiti:expression>/] },
  { key: 'signal.ref', needs: ['catchSig'], element: 'catchSig', value: 'stockLow', xml: [/<bpmn:signal id="Signal_[^"]+" name="stockLow" \/>/, /signalRef="Signal_/] },
  { key: 'signal.scope', needs: ['catchSig'], prepare: (b) => b.setProperty('catchSig', 'signal.ref', 'stockLow'), element: 'catchSig', value: 'processInstance', xml: [/<bpmn:signal [^>]*activiti:scope="processInstance"/] },
  { key: 'signal.expression', needs: ['catchSig'], element: 'catchSig', value: '${sigName}', xml: ['activiti:signalExpression="${sigName}"'] },
  { key: 'signal.async', needs: ['catchSig'], element: 'catchSig', value: true, xml: [/<bpmn:signalEventDefinition[^>]*activiti:async="true"/] },
  { key: 'error.ref', needs: ['endError'], element: 'endError', value: 'E42', xml: [/<bpmn:error id="Error_[^"]+" name="E42" errorCode="E42" \/>/, /errorRef="Error_/] },
  { key: 'event.definitionId', needs: ['catchTimer'], element: 'catchTimer', value: 'waitDefinition', xml: [/<bpmn:timerEventDefinition id="waitDefinition"/], invalid: [['bad id', /not a valid NCName/], ['catchTimer', /already used/], [42, /id must be a string/]] },
  { key: 'link.target', needs: ['catchLink', 'throwLink'], element: 'throwLink', value: 'catchLink', xml: [/<bpmn:target>LinkEventDefinition_\w+<\/bpmn:target>/, /<bpmn:source>LinkEventDefinition_\w+<\/bpmn:source>/], invalid: [['nope', /not a link catch event/], ['throwLink', /not a link catch event/]] },
  { key: 'link.sources', needs: ['catchLink'], element: 'catchLink', value: [], invalid: [[['someThrow'], /follow from the "link.target"/]] },
  { key: 'link.name', needs: ['catchLink'], element: 'catchLink', value: 'jump', xml: [/<bpmn:linkEventDefinition[^>]* name="jump"/] },
  { key: 'compensate.activityRef', needs: ['throwComp', 'svc'], element: 'throwComp', value: 'svc', xml: [/<bpmn:compensateEventDefinition[^>]*activityRef="svc"/] },
  { key: 'compensate.waitForCompletion', needs: ['throwComp'], element: 'throwComp', value: false, xml: [/<bpmn:compensateEventDefinition[^>]*waitForCompletion="false"/] },
  { key: 'terminate.all', needs: ['endTerm'], element: 'endTerm', value: true, xml: [/<bpmn:terminateEventDefinition[^>]*activiti:terminateAll="true"/] },
  { key: 'terminate.multiInstance', needs: ['endTerm'], element: 'endTerm', value: true, xml: [/<bpmn:terminateEventDefinition[^>]*activiti:terminateMultiInstance="true"/] },

  // --- Listeners
  {
    key: 'listeners.execution',
    needs: ['u'],
    element: 'u',
    value: [
      { event: 'start', class: 'org.acme.Start', fields: [{ name: 'f', string: 'v' }] },
      { event: 'end', delegateExpression: '${endListener}', onTransaction: 'committed', customPropertiesResolverClass: 'org.acme.Resolver' },
    ],
    xml: [
      /<activiti:executionListener event="start" class="org.acme.Start">\s*<activiti:field name="f">\s*<activiti:string>v<\/activiti:string>/,
      '<activiti:executionListener event="end" delegateExpression="${endListener}" onTransaction="committed" customPropertiesResolverClass="org.acme.Resolver" />',
    ],
    invalid: [
      [[{ event: 'bogus', class: 'a.B' }], /not one of start, end/],
      [[{ event: 'start' }], /exactly one of class, expression, delegateExpression/],
      [[{ event: 'start', class: 'a.B', expression: '${x}' }], /exactly one/],
      [[{ event: 'start', expression: '${x}', onTransaction: 'committed' }], /cannot be combined with an expression/],
      [[{ event: 'start', class: 'a.B', onTransaction: 'sometime' }], /onTransaction must be one of/],
    ],
  },
  { key: 'listeners.task', needs: ['u'], element: 'u', value: [{ event: 'create', expression: '${created}' }, { event: 'complete', class: 'org.acme.Done' }], xml: ['<activiti:taskListener event="create" expression="${created}" />', '<activiti:taskListener event="complete" class="org.acme.Done" />'], invalid: [[[{ event: 'start', class: 'a.B' }], /not one of create/]] },
  {
    key: 'listeners.event',
    element: 'Process_1',
    value: [{ events: 'TASK_CREATED,TASK_COMPLETED', entityType: 'task', class: 'org.acme.Events' }, { throwEvent: 'signal', signalName: 'taskDone' }],
    xml: ['<activiti:eventListener events="TASK_CREATED,TASK_COMPLETED" entityType="task" class="org.acme.Events" />', '<activiti:eventListener throwEvent="signal" signalName="taskDone" />'],
    invalid: [[[{ events: 'X' }], /needs exactly one of/], [[{ throwEvent: 'signal' }], /needs signalName/], [[{ class: 'a.B', entityType: 'nonsense' }], /entityType must be one of/]],
  },

  // --- Flows and data
  { key: 'flow.condition', needs: ['flow'], element: 'flow', value: '${amount > 100}', xml: [/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\$\{amount &gt; 100\}<\/bpmn:conditionExpression>/] },
  { key: 'flow.default', needs: ['flow2'], element: 'flow2', value: true, get: true, xml: [/<bpmn:exclusiveGateway id="gw" default="flow2"/] },
  { key: 'data.objects', needs: ['sp'], element: 'sp', value: [{ id: 'orderObject', name: 'order', type: 'xsd:string', value: 'none' }, { id: 'countObject', name: 'count', type: 'xsd:int', value: '7' }], xml: [/<bpmn:dataObject id="orderObject" name="order" itemSubjectRef="xsd:string">\s*<bpmn:extensionElements>\s*<activiti:value>none<\/activiti:value>/, /<bpmn:dataObject id="countObject" name="count" itemSubjectRef="xsd:int">/, 'xmlns:xsd="http://www.w3.org/2001/XMLSchema"'], notXml: ['dataObjectReference', 'bpmndi:BPMNShape id="orderObject'], invalid: [[[{ name: '' }], /needs a name/], [[{ name: 'a' }, { name: 'a' }], /defined twice/], [[{ name: 'a', type: 'xsd:decimal' }], /not one of/], [[{ id: 'bad id', name: 'a' }], /not a valid NCName/], [[{ id: 'sp', name: 'a' }], /already used/]] },
  { key: 'data.id', needs: ['data'], element: 'data', value: 'orderData', xml: [/<bpmn:dataObject id="orderData"/, 'dataObjectRef="orderData"'], invalid: [['bad id', /not a valid NCName/], ['data', /already used/]] },
  { key: 'data.name', needs: ['data'], element: 'data', value: 'amount', xml: [/<bpmn:dataObject id="DataObject_[^"]+" name="amount"/] },
  { key: 'data.type', needs: ['data'], element: 'data', value: 'xsd:int', xml: [/<bpmn:dataObject [^>]*itemSubjectRef="xsd:int"/, 'xmlns:xsd="http://www.w3.org/2001/XMLSchema"'], invalid: [['xsd:decimal', /not one of/]] },
  { key: 'data.value', needs: ['data'], element: 'data', value: '5', xml: ['<activiti:value>5</activiti:value>'] },

  // --- Definitions-level lists
  { key: 'definitions.messages', element: 'Process_1', value: [{ name: 'orderPlaced' }, { name: 'orderShipped' }], get: (v: unknown) => expect(v).toMatchObject([{ name: 'orderPlaced' }, { name: 'orderShipped' }]), xml: [/<bpmn:message id="Message_[^"]+" name="orderPlaced" \/>/, /name="orderShipped"/], invalid: [[[{ name: 'a' }, { name: 'a' }], /defined twice/], [[{ name: '' }], /needs a name/]] },
  { key: 'definitions.signals', element: 'Process_1', value: [{ name: 'stockLow', scope: 'global' }], get: (v: unknown) => expect(v).toMatchObject([{ name: 'stockLow', scope: 'global' }]), xml: [/<bpmn:signal [^>]*name="stockLow"[^>]*activiti:scope="global"|<bpmn:signal [^>]*activiti:scope="global"[^>]*name="stockLow"/], invalid: [[[{ name: 's', scope: 'planet' }], /not one of global/]] },
  { key: 'definitions.usage', element: 'Process_1', value: { messages: {}, signals: {}, errors: {} }, invalid: [[{ messages: { nope: 1 }, signals: {}, errors: {} }, /derived from the event definitions/]] },
  { key: 'definitions.errors', element: 'Process_1', value: [{ errorCode: 'E1', name: 'Failure' }], get: (v: unknown) => expect(v).toMatchObject([{ errorCode: 'E1', name: 'Failure' }]), xml: [/<bpmn:error id="Error_[^"]+" name="Failure" errorCode="E1" \/>/], invalid: [[[{ errorCode: '' }], /needs a errorCode|needs a error/]] },

  // --- Extensions JSON
  { key: 'mapping.type', needs: ['svc'], element: 'svc', value: 'MAP_ALL', json: (ext) => expect(ext.mappings['svc']).toEqual({ mappingType: 'MAP_ALL' }), invalid: [['EVERYTHING', /not one of/]] },
  {
    key: 'mapping.inputs',
    needs: ['svc'],
    element: 'svc',
    value: { to: { type: 'variable', value: 'recipient' }, subject: { type: 'VALUE', value: 'Hi' } },
    get: { to: { type: 'VARIABLE', value: 'recipient' }, subject: { type: 'VALUE', value: 'Hi' } },
    json: (ext) => expect(ext.mappings['svc']).toEqual({ inputs: { to: { type: 'VARIABLE', value: 'recipient' }, subject: { type: 'VALUE', value: 'Hi' } } }),
    invalid: [[{ x: { type: 'JSONPATCH', value: [] } }, /not one of VARIABLE, VALUE/]],
  },
  {
    key: 'mapping.outputs',
    needs: ['svc'],
    element: 'svc',
    value: { sent: { type: 'VALUE', value: true }, reply: { type: 'VARIABLE', value: 'body' }, doc: { type: 'JSONPATCH', value: [{ op: 'add', path: '/a', value: 1 }] } },
    get: { sent: { type: 'VALUE', value: true }, reply: { type: 'VARIABLE', value: 'body' }, doc: { type: 'JSONPATCH', value: [{ op: 'add', path: '/a', value: 1 }] } },
    json: (ext) => {
      expect(Object.keys(ext.mappings['svc']!.outputs!)).toEqual(['sent', 'reply', 'doc']);
      // every output target is declared as a property
      expect(Object.values(ext.properties).map((p) => [p.name, p.type]).sort()).toEqual([['doc', 'json'], ['reply', 'json'], ['sent', 'boolean']]);
    },
    invalid: [[{ x: { type: 'VALUE', value: '${expr}' } }, /expressions are not allowed/], [{ x: { type: 'JSONPATCH', value: 'no' } }, /patch array/]],
  },
  { key: 'variables.usage', needs: ['svc'], prepare: (b) => b.setProperty('svc', 'mapping.outputs', { total: { type: 'VARIABLE', value: 'sum' } }), element: 'Process_1', value: { total: [{ elementId: 'svc', as: 'output' }] }, invalid: [[{}, /derived from the mappings/]] },
  {
    key: 'decision.pick',
    needs: ['dec'],
    element: 'dec',
    value: { decision: 'risk' },
    json: (ext) => expect(ext.constants['dec']).toEqual({ _activiti_dmn_table_: { value: 'risk' } }),
    invalid: [[{ decision: '' }, /name the decision/]],
  },
  { key: 'decision.info', needs: ['dec'], element: 'dec', value: undefined, invalid: [[{ file: 'x.dmn', decision: {} }, /chosen with decision.pick/]] },
  { key: 'template.apply', needs: ['svc'], element: 'svc', value: { id: 'builtin/mail' }, xml: ['activiti:type="mail"', 'activiti:templateId="builtin/mail"', 'activiti:templateVersion="1"'], invalid: [[{ id: 'nope.GO' }, /no template/], [{}, /id of the template/]] },
  { key: 'template.unlink', needs: ['svc'], prepare: (b) => b.setProperty('svc', 'template.apply', { id: 'builtin/mail' }), element: 'svc', value: true, get: false, xml: ['activiti:type="mail"'], notXml: ['templateId', 'templateVersion'] },
  { key: 'template.update', needs: ['svc'], prepare: (b) => b.setProperty('svc', 'template.apply', { id: 'builtin/expression' }), element: 'svc', value: true, get: false, xml: ['activiti:templateId="builtin/expression"'] },
  {
    key: 'template.info',
    needs: ['svc'],
    prepare: (b) => b.setProperty('svc', 'template.apply', { id: 'builtin/shell' }),
    element: 'svc',
    value: { id: 'builtin/shell', version: '1', name: 'Shell', kind: 'shell', latestVersion: '1', state: 'current' },
    invalid: [[{ id: 'builtin/mail', version: '1', state: 'current' }, /template.apply, template.update and template.unlink/]],
  },
  { key: 'mapping.ephemeral', needs: ['svc'], element: 'svc', value: true, json: (ext) => expect(ext.mappings['svc']).toEqual({ ephemeral: true }) },
  { key: 'constants.values', needs: ['svc'], element: 'svc', value: { timeout: 30, mode: 'fast', flags: { a: true } }, json: (ext) => expect(ext.constants['svc']).toEqual({ timeout: { value: 30 }, mode: { value: 'fast' }, flags: { value: { a: true } } }), invalid: [[{ _activiti_dmn_table_: 'x' }, /set through decision.table/]] },
];
