import type { ChecklistEntry } from '../../src';

/**
 * One round-trip fixture per checklist entry. Fixtures are built from small templates: a carrier template per XML
 * element that returns a complete BPMN document containing exactly one occurrence of the entry.
 */

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_1" targetNamespace="http://activiti.org/bpmn">`;

interface Doc {
  defs?: string;
  processAttrs?: Record<string, string>;
  /** Children of the process that precede the flow elements (extensionElements). */
  processInner?: string;
  body: string;
}

type Attrs = Record<string, string>;
export type Fixture = string;

const render = (attrs: Attrs): string =>
  Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('');

function build(doc: Doc): string {
  return `${HEAD}\n${doc.defs ?? ''}\n<process id="P"${render({ isExecutable: 'true', ...doc.processAttrs })}>\n${doc.processInner ?? ''}${doc.body}\n</process>\n</definitions>\n`;
}

const FLOWS = '<endEvent id="e"/><sequenceFlow id="f1" sourceRef="x" targetRef="e"/><sequenceFlow id="f2" sourceRef="x" targetRef="e"/>';
const MESSAGE = '<message id="msg" name="theMessage"/>';
const SIGNAL = '<signal id="sig" name="theSignal"/>';
const ERROR = '<error id="err" name="E" errorCode="E1"/>';
const HOST = '<serviceTask id="host" activiti:class="a.B"/>';
const TIMER = '<timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition>';

/** Sample values; reference-like attributes point at elements that the carrier templates define. */
const SAMPLE: Record<string, string> = {
  async: 'true', exclusive: 'false', isForCompensation: 'true', default: 'f2', isExecutable: 'true',
  attachedToRef: 'host', cancelActivity: 'false', isInterrupting: 'false', isSequential: 'true',
  triggeredByEvent: 'true', ordering: 'Sequential', cancelRemainingInstances: 'false',
  calledElement: 'childProcess', scriptFormat: 'javascript', implementation: 'dmn-connector.EXECUTE_TABLE',
  operationRef: 'op', itemSubjectRef: 'xsd:string', messageRef: 'msg', signalRef: 'sig', errorRef: 'err',
  activityRef: 'host', waitForCompletion: 'false', associationDirection: 'One', textFormat: 'text/html',
  scope: 'processInstance', type: 'mail', priority: '50', dueDate: 'P1D', skipExpression: '${skip}',
  inheritBusinessKey: 'true', inheritVariables: 'true', autoStoreVariables: 'true', exclude: 'true',
  terminateAll: 'true', terminateMultiInstance: 'true', includeChildExceptions: 'true',
  readable: 'false', writable: 'false', required: 'true', event: 'start', onTransaction: 'committed',
  throwEvent: 'signal', entityType: 'task', events: 'TASK_CREATED,TASK_COMPLETED', locale: 'en',
  candidateUsers: 'kermit,fozzie', candidateGroups: 'muppets,${grp}', candidateStarterUsers: 'a,b',
  candidateStarterGroups: 'g1,g2', endDate: '2031-01-01T00:00:00', initiator: 'startedBy',
  errorCode: 'E1', source: 'src', sourceExpression: '${a + b}', target: 'tgt', stringValue: 'literal', expression: '${expr}',
  collection: '${items}', elementVariable: 'item', elementIndexVariable: 'idx',
};
const sample = (name: string): string => SAMPLE[name] ?? `${name}Value`;

const attrRecord = (entry: ChecklistEntry, defaults: Attrs = {}): Attrs => {
  const key = entry.namespace === 'activiti' ? `activiti:${entry.name}` : entry.name;
  return { ...defaults, [key]: sample(entry.name) };
};

type Carrier = (attrs: Attrs, inner: string) => Doc;

/** Plain activity or event: the element, its flows, and optional fixed extra content after `inner`. */
const node =
  (tag: string, extra = '', defaults: Attrs = {}, before = ''): Carrier =>
  (attrs, inner) => ({
    // a fixture that supplies its own <script> or event definition replaces the template's
    body: `${before}<${tag} id="x"${render({ ...defaults, ...attrs })}>${inner}${inner.includes('<script') ? '' : extra}</${tag}>${FLOWS}`,
  });

const SUB = '<startEvent id="xs"/><endEvent id="xe"/><sequenceFlow id="xf" sourceRef="xs" targetRef="xe"/>';

const CARRIERS: Record<string, Carrier> = {
  task: node('task'),
  userTask: node('userTask'),
  serviceTask: node('serviceTask', '', { 'activiti:class': 'a.B' }),
  scriptTask: node('scriptTask', '<script>1 + 1</script>', { scriptFormat: 'javascript' }),
  sendTask: node('sendTask', '', { 'activiti:type': 'mail' }),
  receiveTask: node('receiveTask'),
  manualTask: node('manualTask'),
  businessRuleTask: node('businessRuleTask'),
  callActivity: node('callActivity', '', { calledElement: 'childProcess' }),
  subProcess: node('subProcess', SUB),
  transaction: node('transaction', SUB),
  adHocSubProcess: node('adHocSubProcess', '<userTask id="xa"/>'),
  startEvent: node('startEvent'),
  endEvent: node('endEvent'),
  intermediateCatchEvent: node('intermediateCatchEvent', TIMER),
  intermediateThrowEvent: node('intermediateThrowEvent', '', {}, HOST),
  boundaryEvent: node('boundaryEvent', TIMER, { attachedToRef: 'host' }, HOST),
  exclusiveGateway: node('exclusiveGateway'),
  inclusiveGateway: node('inclusiveGateway'),
  parallelGateway: node('parallelGateway'),
  eventBasedGateway: node('eventBasedGateway'),
  complexGateway: node('complexGateway'),
  process: (attrs, inner) => ({ processAttrs: attrs, processInner: inner, body: '<startEvent id="x"/>' }),
  sequenceFlow: (attrs, inner) => ({
    body: `<task id="a"/><task id="b"/><sequenceFlow id="x" sourceRef="a" targetRef="b"${render(attrs)}>${inner}</sequenceFlow>`,
  }),
  signal: (attrs) => ({ defs: `<signal id="sig" name="theSignal"${render(attrs)}/>`, body: '<startEvent id="x"/>' }),
  dataObject: (attrs, inner) => ({ body: `<dataObject id="x" name="amount"${render(attrs)}>${inner}</dataObject>` }),
  textAnnotation: (attrs) => ({ body: `<textAnnotation id="x"${render(attrs)}><text>note</text></textAnnotation>` }),
  association: (attrs) => ({
    body: `<task id="t"/><textAnnotation id="ta"><text>note</text></textAnnotation><association id="x" sourceRef="t" targetRef="ta"${render(attrs)}/>`,
  }),
  messageEventDefinition: (attrs, inner) => ({
    defs: MESSAGE,
    body: `<intermediateCatchEvent id="x"><messageEventDefinition id="md"${render({ messageRef: 'msg', ...attrs })}>${inner}</messageEventDefinition></intermediateCatchEvent>`,
  }),
  signalEventDefinition: (attrs, inner) => ({
    defs: SIGNAL,
    body: `<intermediateCatchEvent id="x"><signalEventDefinition${render({ signalRef: 'sig', ...attrs })}>${inner}</signalEventDefinition></intermediateCatchEvent>`,
  }),
  timerEventDefinition: (attrs, inner) => ({
    body: `<intermediateCatchEvent id="x"><timerEventDefinition${render(attrs)}>${inner || '<timeDuration>PT1M</timeDuration>'}</timerEventDefinition></intermediateCatchEvent>`,
  }),
  terminateEventDefinition: (attrs, inner) => ({ body: `<endEvent id="x"><terminateEventDefinition${render(attrs)}>${inner}</terminateEventDefinition></endEvent>` }),
  errorEventDefinition: (attrs, inner) => ({
    defs: ERROR,
    body: `<endEvent id="x"><errorEventDefinition${render({ errorRef: 'err', ...attrs })}>${inner}</errorEventDefinition></endEvent>`,
  }),
  cancelEventDefinition: (attrs, inner) => ({
    body: `<transaction id="tx"><startEvent id="s1"/><endEvent id="x"><cancelEventDefinition${render(attrs)}>${inner}</cancelEventDefinition></endEvent></transaction>`,
  }),
  compensateEventDefinition: (attrs, inner) => ({
    body: `${HOST}<intermediateThrowEvent id="x"><compensateEventDefinition${render({ activityRef: 'host', ...attrs })}>${inner}</compensateEventDefinition></intermediateThrowEvent>`,
  }),
  linkEventDefinition: (attrs, inner) => ({
    body: `<intermediateCatchEvent id="x"><linkEventDefinition id="lc"${render({ name: 'jump', ...attrs })}>${inner}</linkEventDefinition></intermediateCatchEvent>`,
  }),
  timeCycle: (attrs) => ({
    body: `<startEvent id="x"><timerEventDefinition><timeCycle${render(attrs)}>R3/PT1H</timeCycle></timerEventDefinition></startEvent>`,
  }),
  multiInstanceLoopCharacteristics: (attrs, inner) => ({
    body: `<userTask id="x">\n<multiInstanceLoopCharacteristics${render(attrs)}>\n${inner || '<loopCardinality>3</loopCardinality>'}\n</multiInstanceLoopCharacteristics>\n</userTask>`,
  }),
  inputDataItem: (attrs) => ({
    body: `<userTask id="x">\n<multiInstanceLoopCharacteristics activiti:collection="items">\n<inputDataItem id="idi"${render(attrs)}/>\n</multiInstanceLoopCharacteristics>\n</userTask>`,
  }),
  outputDataItem: (attrs) => ({
    body: `<userTask id="x">\n<multiInstanceLoopCharacteristics activiti:collection="items">\n<loopDataOutputRef>results</loopDataOutputRef>\n<outputDataItem id="odi"${render(attrs)}/>\n</multiInstanceLoopCharacteristics>\n</userTask>`,
  }),
};

const EXT = (xml: string): string => `<extensionElements>${xml}</extensionElements>`;

/** Attributes of activiti: child elements (unqualified): a document with that element in its natural parent. */
const CHILD_ATTRS: Record<string, (attrs: Attrs) => Doc> = {
  executionListener: (a) => CARRIERS['serviceTask']!({}, EXT(`<activiti:executionListener${render({ event: 'start', class: 'a.B', ...a })}/>`)),
  taskListener: (a) => CARRIERS['userTask']!({}, EXT(`<activiti:taskListener${render({ event: 'create', class: 'a.B', ...a })}/>`)),
  eventListener: (a) => CARRIERS['process']!({}, EXT(`<activiti:eventListener${render({ class: 'a.B', ...a })}/>`)),
  field: (a) => CARRIERS['serviceTask']!({}, EXT(`<activiti:field${render({ name: 'f', ...a })}/>`)),
  in: (a) => CARRIERS['callActivity']!({}, EXT(`<activiti:in${render(a)}/>`)),
  out: (a) => CARRIERS['callActivity']!({}, EXT(`<activiti:out${render(a)}/>`)),
  mapException: (a) => CARRIERS['serviceTask']!({}, EXT(`<activiti:mapException${render({ errorCode: 'E1', ...a })}>java.lang.RuntimeException</activiti:mapException>`)),
  formProperty: (a) => CARRIERS['userTask']!({}, EXT(`<activiti:formProperty${render({ id: 'p', ...a })}/>`)),
  value: (a) => CARRIERS['userTask']!({}, EXT(`<activiti:formProperty id="p"><activiti:value${render(a)}/></activiti:formProperty>`)),
  customResource: (a) =>
    CARRIERS['userTask']!({}, EXT(`<activiti:customResource${render({ name: 'witness', ...a })}><resourceAssignmentExpression><formalExpression>user(a), group(b)</formalExpression></resourceAssignmentExpression></activiti:customResource>`)),
  localization: (a) => CARRIERS['process']!({}, EXT(`<activiti:localization${render({ locale: 'en', ...a })}/>`)),
};

interface ChildSample {
  xml: string;
  /** Inside extensionElements of the parent, or a direct child. */
  placement: 'ext' | 'direct';
}

const LISTENER = (tag: string, event: string, inner: string): string => `<activiti:${tag} event="${event}" class="a.B">${inner}</activiti:${tag}>`;
const FIELD = '<activiti:field name="f"><activiti:string>v</activiti:string></activiti:field>';
const FORMAL = '<resourceAssignmentExpression><formalExpression>user(a), group(b)</formalExpression></resourceAssignmentExpression>';

/** Child element samples by element name; `parent` lets one name serve several parents. */
function childSample(child: string, parent: string): ChildSample | undefined {
  const ext = (xml: string): ChildSample => ({ xml, placement: 'ext' });
  const direct = (xml: string): ChildSample => ({ xml, placement: 'direct' });
  switch (child) {
    case 'executionListener': return ext(LISTENER('executionListener', parent === 'sequenceFlow' ? 'take' : 'start', ''));
    case 'taskListener': return ext(LISTENER('taskListener', 'create', ''));
    case 'eventListener': return ext('<activiti:eventListener events="TASK_CREATED" entityType="task" class="a.B"/>');
    case 'field':
      return parent === 'executionListener' || parent === 'taskListener' ? direct(FIELD) : ext(FIELD);
    case 'string': return direct('<activiti:string>v</activiti:string>');
    case 'expression': return parent === 'field' ? direct('<activiti:expression>${v}</activiti:expression>') : undefined;
    case 'in': return ext('<activiti:in source="a" target="b"/>');
    case 'out': return ext('<activiti:out sourceExpression="${a}" target="b"/>');
    case 'mapException': return ext('<activiti:mapException errorCode="E1" includeChildExceptions="true">java.lang.RuntimeException</activiti:mapException>');
    case 'failedJobRetryTimeCycle': return ext('<activiti:failedJobRetryTimeCycle>R5/PT7M</activiti:failedJobRetryTimeCycle>');
    case 'formProperty': return ext('<activiti:formProperty id="p" name="P" type="string" required="true"/>');
    case 'value':
      return parent === 'formProperty' ? direct('<activiti:value id="v1" name="One"/>') : ext('<activiti:value>42</activiti:value>');
    case 'customResource': return ext(`<activiti:customResource name="witness">${FORMAL}</activiti:customResource>`);
    case 'potentialStarter': return ext(`<activiti:potentialStarter>${FORMAL}</activiti:potentialStarter>`);
    case 'humanPerformer': return direct(`<humanPerformer>${FORMAL}</humanPerformer>`);
    case 'potentialOwner': return direct(`<potentialOwner>${FORMAL}</potentialOwner>`);
    case 'conditionExpression': return direct('<conditionExpression xsi:type="tFormalExpression">${x &gt; 1}</conditionExpression>');
    case 'script': return direct('<script>1 + 1</script>');
    case 'timeDate': return direct('<timeDate>2031-01-01T00:00:00</timeDate>');
    case 'timeDuration': return direct('<timeDuration>PT5M</timeDuration>');
    case 'timeCycle': return direct('<timeCycle>R3/PT1H</timeCycle>');
    case 'loopCardinality': return direct('<loopCardinality>3</loopCardinality>');
    case 'loopDataInputRef': return direct('<loopDataInputRef>items</loopDataInputRef>');
    case 'loopDataOutputRef': return direct('<loopDataOutputRef>results</loopDataOutputRef>');
    case 'inputDataItem': return direct('<inputDataItem name="item"/>');
    case 'outputDataItem': return direct('<outputDataItem name="res"/>');
    case 'completionCondition': return direct('<completionCondition>${nrOfCompletedInstances &gt;= 1}</completionCondition>');
    case 'source': return direct('<source>lt</source>');
    case 'target': return direct('<target>lc</target>');
    case 'localization': return ext('<activiti:localization locale="en" name="Name"><activiti:documentation>Docs</activiti:documentation></activiti:localization>');
    case 'documentation': return direct('<activiti:documentation>Docs</activiti:documentation>');
    default: break;
  }
  return undefined;
}

const EVENT_DEFINITION_XML: Record<string, string> = {
  timerEventDefinition: '<timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition>',
  messageEventDefinition: '<messageEventDefinition messageRef="msg"/>',
  signalEventDefinition: '<signalEventDefinition signalRef="sig"/>',
  errorEventDefinition: '<errorEventDefinition errorRef="err"/>',
  terminateEventDefinition: '<terminateEventDefinition/>',
  cancelEventDefinition: '<cancelEventDefinition/>',
  compensateEventDefinition: '<compensateEventDefinition activityRef="host"/>',
  linkEventDefinition: '<linkEventDefinition id="ld" name="jump"/>',
};

/** Parents that are themselves activiti: or event-definition elements and need a surrounding document. */
function nested(parent: string, sample: ChildSample): Doc | undefined {
  const content = sample.placement === 'ext' ? EXT(sample.xml) : sample.xml;
  switch (parent) {
    case 'executionListener':
      return CARRIERS['serviceTask']!({}, EXT(`<activiti:executionListener event="start" class="a.B">${content}</activiti:executionListener>`));
    case 'taskListener':
      return CARRIERS['userTask']!({}, EXT(`<activiti:taskListener event="create" class="a.B">${content}</activiti:taskListener>`));
    case 'field':
      return CARRIERS['serviceTask']!({}, EXT(`<activiti:field name="f">${content}</activiti:field>`));
    case 'formProperty':
      return CARRIERS['userTask']!({}, EXT(`<activiti:formProperty id="p">${content}</activiti:formProperty>`));
    case 'localization':
      return CARRIERS['process']!({}, EXT(`<activiti:localization locale="en">${content}</activiti:localization>`));
    case 'linkEventDefinition':
      // `source` / `target` reference the id of the opposite link definition
      return {
        body: `<intermediateThrowEvent id="t"><linkEventDefinition id="lt" name="jump">${sample.xml.includes('<source>') ? '' : sample.xml}</linkEventDefinition></intermediateThrowEvent>` +
          `<intermediateCatchEvent id="c"><linkEventDefinition id="lc" name="jump">${sample.xml.includes('<source>') ? sample.xml : ''}</linkEventDefinition></intermediateCatchEvent>`,
      };
    case 'timerEventDefinition':
      return CARRIERS['timerEventDefinition']!({}, sample.xml);
    case 'multiInstanceLoopCharacteristics':
      return CARRIERS['multiInstanceLoopCharacteristics']!({ 'activiti:collection': 'items' }, sample.xml);
    default:
      return undefined;
  }
}

/** Builds the fixture for a checklist entry; undefined when no template exists (the coverage test then fails). */
export function fixtureFor(entry: ChecklistEntry): Fixture | undefined {
  if (entry.kind === 'attribute') {
    const attrs = attrRecord(entry);
    const childAttrs = CHILD_ATTRS[entry.element];
    if (entry.namespace === 'none') {
      return childAttrs ? build(childAttrs({ [entry.name]: sample(entry.name) })) : undefined;
    }
    const carrier = CARRIERS[entry.element];
    if (!carrier) return undefined;
    // an attribute whose value the carrier would otherwise default (isInterrupting on a start event, ...)
    const doc = carrier(attrs, '');
    // triggeredByEvent only makes sense on a sub process, but is read for every carrier of that tag
    return build(doc);
  }

  // child element: `parent>activiti:name` or `parent>name`
  const parent = entry.element;
  const eventDefinitionXml = EVENT_DEFINITION_XML[entry.name];
  if (eventDefinitionXml) {
    const carrier = CARRIERS[parent];
    if (!carrier) return undefined;
    const doc = carrier({}, eventDefinitionXml);
    return build({ ...doc, defs: [MESSAGE, SIGNAL, ERROR].join('') + (doc.defs ?? '') });
  }
  const sample0 = childSample(entry.name, parent);
  if (!sample0) return undefined;

  const nestedDoc = nested(parent, sample0);
  if (nestedDoc) return build({ defs: [MESSAGE, SIGNAL, ERROR].join(''), ...nestedDoc });

  const carrier = CARRIERS[parent];
  if (!carrier) return undefined;
  const inner = sample0.placement === 'ext' ? EXT(sample0.xml) : sample0.xml;
  const doc = carrier({}, inner);
  return build({ defs: [MESSAGE, SIGNAL, ERROR].join('') + (doc.defs ?? ''), ...doc });
}
