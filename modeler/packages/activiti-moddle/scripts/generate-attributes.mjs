#!/usr/bin/env node
/**
 * Generates support/activiti-attributes.json: the checklist of every attribute and child element that the
 * Activiti 9.0.0 BPMN converter reads, per XML element.
 *
 *   node scripts/generate-attributes.mjs --sources <dir | activiti-bpmn-converter-9.0.0-sources.jar>
 *                                        [--engine-sources <dir | activiti-engine-9.0.0-sources.jar>] [--check]
 *
 * How it works:
 *  1. BpmnXMLConstants.java gives the constant -> string table.
 *  2. Every converter / child parser is scanned for `getAttributeValue(<namespace>, <constant>)` reads. The namespace
 *     argument says whether a read is "strict" (`ACTIVITI_EXTENSIONS_NAMESPACE`: only activiti: counts) or
 *     "agnostic" (`null`: any namespace or none).
 *  3. The element(s) each file applies to are declared in READ_SITES below (R1 §2.3/§2.4/§4). The scan is checked in
 *     both directions: a read that is not declared fails the run, and so does a declaration the sources do not
 *     contain. A new attribute in a future converter therefore cannot slip through unnoticed.
 *  4. Child elements are declared in CHILD_ELEMENTS and verified against the names the parsers register.
 *
 * The output is deterministic (sorted), so `--check` can be used in CI to detect a stale checklist.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '../support/activiti-attributes.json');

// --- element groups -----------------------------------------------------------------------------------------

const TASKS = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask'];
const ACTIVITIES = [...TASKS, 'callActivity', 'subProcess', 'transaction', 'adHocSubProcess'];
const EVENTS = ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent'];
const GATEWAYS = ['exclusiveGateway', 'inclusiveGateway', 'parallelGateway', 'eventBasedGateway', 'complexGateway'];
const FLOW_NODES = [...ACTIVITIES, ...EVENTS, ...GATEWAYS];
const DEFAULT_FLOW_HOLDERS = [...ACTIVITIES, 'exclusiveGateway', 'inclusiveGateway', 'complexGateway'];

// --- what the modeler does with a construct (R1 §3, FEATURE_MATRIX §A/§C) ----------------------------------------

/** Elements whose attributes are read but that the modeler never creates (still round-tripped). */
const ROUNDTRIP_ELEMENTS = new Set(['businessRuleTask', 'complexGateway', 'adHocSubProcess', 'formProperty']);

// --- declared read sites ----------------------------------------------------------------------------------------
// file (without .java), relative to org/activiti/bpmn/converter -> { reads: [{ element(s), attrs }], ignore: [...] }
// `ns`: 'activiti' = strict read (ACTIVITI_EXTENSIONS_NAMESPACE), 'any' = getAttributeValue(null, ...).

/** @type {Record<string, { reads: Array<{ elements: string[], ns: 'activiti' | 'any', attrs: string[], carrier?: string }>, ignore?: string[] }>} */
const READ_SITES = {
  BaseBpmnXMLConverter: {
    reads: [
      { elements: FLOW_NODES, ns: 'activiti', attrs: ['async', 'exclusive'] },
      { elements: ACTIVITIES, ns: 'any', attrs: ['isForCompensation'] },
      { elements: DEFAULT_FLOW_HOLDERS, ns: 'any', attrs: ['default'] },
    ],
    ignore: ['id', 'name'],
  },
  'parser/SubProcessParser': {
    reads: [
      { elements: ['subProcess', 'transaction', 'adHocSubProcess'], ns: 'activiti', attrs: ['async', 'exclusive'] },
      { elements: ['subProcess', 'transaction', 'adHocSubProcess'], ns: 'any', attrs: ['isForCompensation', 'default'] },
      { elements: ['subProcess'], ns: 'any', attrs: ['triggeredByEvent'] },
      { elements: ['adHocSubProcess'], ns: 'any', attrs: ['ordering', 'cancelRemainingInstances'] },
    ],
    ignore: ['id', 'name'],
  },
  'parser/ProcessParser': {
    reads: [
      { elements: ['process'], ns: 'activiti', attrs: ['candidateStarterUsers', 'candidateStarterGroups'] },
      { elements: ['process'], ns: 'any', attrs: ['isExecutable'] },
    ],
    ignore: ['id', 'name'],
  },
  'parser/SignalParser': {
    reads: [{ elements: ['signal'], ns: 'activiti', attrs: ['scope'] }],
    ignore: ['id', 'name'],
  },
  BoundaryEventXMLConverter: {
    reads: [{ elements: ['boundaryEvent'], ns: 'any', attrs: ['cancelActivity', 'attachedToRef'] }],
  },
  BusinessRuleTaskXMLConverter: {
    reads: [{ elements: ['businessRuleTask'], ns: 'activiti', attrs: ['ruleVariablesInput', 'rules', 'resultVariable', 'class', 'exclude'] }],
  },
  CallActivityXMLConverter: {
    reads: [
      { elements: ['callActivity'], ns: 'any', attrs: ['calledElement'] },
      { elements: ['callActivity'], ns: 'activiti', attrs: ['businessKey', 'inheritBusinessKey', 'inheritVariables'] },
      { elements: ['in', 'out'], ns: 'any', attrs: ['source', 'sourceExpression', 'target'], carrier: 'child' },
    ],
  },
  ScriptTaskXMLConverter: {
    reads: [
      { elements: ['scriptTask'], ns: 'any', attrs: ['scriptFormat'] },
      { elements: ['scriptTask'], ns: 'activiti', attrs: ['resultVariable', 'resultVariableName', 'autoStoreVariables'] },
    ],
  },
  SendTaskXMLConverter: {
    reads: [
      { elements: ['sendTask'], ns: 'activiti', attrs: ['type'] },
      { elements: ['sendTask'], ns: 'any', attrs: ['implementation', 'operationRef'] },
    ],
  },
  SequenceFlowXMLConverter: {
    reads: [{ elements: ['sequenceFlow'], ns: 'any', attrs: ['skipExpression'] }],
    ignore: ['sourceRef', 'targetRef', 'name'],
  },
  ServiceTaskXMLConverter: {
    reads: [
      {
        elements: ['serviceTask'],
        ns: 'activiti',
        attrs: ['class', 'expression', 'delegateExpression', 'resultVariableName', 'resultVariable', 'type', 'extensionId', 'skipExpression'],
      },
      { elements: ['serviceTask'], ns: 'any', attrs: ['implementation', 'operationRef'] },
    ],
  },
  StartEventXMLConverter: {
    reads: [
      { elements: ['startEvent'], ns: 'activiti', attrs: ['formKey', 'initiator'] },
      { elements: ['startEvent'], ns: 'any', attrs: ['isInterrupting'] },
    ],
  },
  TextAnnotationXMLConverter: {
    reads: [{ elements: ['textAnnotation'], ns: 'any', attrs: ['textFormat'] }],
  },
  AssociationXMLConverter: {
    reads: [{ elements: ['association'], ns: 'any', attrs: ['associationDirection'] }],
    ignore: ['sourceRef', 'targetRef', 'id'],
  },
  UserTaskXMLConverter: {
    reads: [
      {
        elements: ['userTask'],
        ns: 'activiti',
        attrs: ['formKey', 'dueDate', 'businessCalendarName', 'category', 'assignee', 'owner', 'priority', 'candidateUsers', 'candidateGroups', 'extensionId', 'skipExpression'],
      },
      // CustomIdentityLinkParser: strict first, unqualified as fallback
      { elements: ['customResource'], ns: 'activiti', attrs: ['name'], carrier: 'child' },
      { elements: ['customResource'], ns: 'any', attrs: ['name'], carrier: 'child' },
    ],
  },
  ValuedDataObjectXMLConverter: {
    reads: [{ elements: ['dataObject'], ns: 'any', attrs: ['itemSubjectRef'] }],
    ignore: ['id', 'name'],
  },
  'child/ActivitiListenerParser': {
    reads: [
      {
        elements: ['executionListener', 'taskListener'],
        ns: 'any',
        carrier: 'child',
        attrs: [
          'class', 'expression', 'delegateExpression', 'event', 'onTransaction',
          'customPropertiesResolverClass', 'customPropertiesResolverExpression', 'customPropertiesResolverDelegateExpression',
        ],
      },
    ],
  },
  'child/ActivitiEventListenerParser': {
    reads: [
      {
        elements: ['eventListener'],
        ns: 'any',
        carrier: 'child',
        attrs: ['class', 'delegateExpression', 'throwEvent', 'signalName', 'messageName', 'errorCode', 'events', 'entityType'],
      },
    ],
  },
  'child/FieldExtensionParser': {
    reads: [{ elements: ['field'], ns: 'any', carrier: 'child', attrs: ['name', 'stringValue', 'expression'] }],
  },
  'child/ActivitiMapExceptionParser': {
    reads: [{ elements: ['mapException'], ns: 'any', carrier: 'child', attrs: ['errorCode', 'includeChildExceptions'] }],
  },
  'child/MessageEventDefinitionParser': {
    reads: [
      { elements: ['messageEventDefinition'], ns: 'any', attrs: ['messageRef'] },
      { elements: ['messageEventDefinition'], ns: 'activiti', attrs: ['messageExpression', 'correlationKey'] },
    ],
  },
  'child/SignalEventDefinitionParser': {
    reads: [
      { elements: ['signalEventDefinition'], ns: 'any', attrs: ['signalRef'] },
      { elements: ['signalEventDefinition'], ns: 'activiti', attrs: ['signalExpression', 'async'] },
    ],
  },
  'child/TimerEventDefinitionParser': {
    reads: [{ elements: ['timerEventDefinition'], ns: 'activiti', attrs: ['businessCalendarName'] }],
  },
  'child/TimeCycleParser': {
    reads: [{ elements: ['timeCycle'], ns: 'activiti', attrs: ['endDate'] }],
  },
  'child/TerminateEventDefinitionParser': {
    reads: [{ elements: ['terminateEventDefinition'], ns: 'activiti', attrs: ['terminateAll', 'terminateMultiInstance'] }],
  },
  'child/ErrorEventDefinitionParser': {
    reads: [{ elements: ['errorEventDefinition'], ns: 'any', attrs: ['errorRef'] }],
  },
  'child/CompensateEventDefinitionParser': {
    reads: [{ elements: ['compensateEventDefinition'], ns: 'any', attrs: ['activityRef', 'waitForCompletion'] }],
  },
  'child/multi/instance/MultiInstanceAttributesParser': {
    reads: [
      { elements: ['multiInstanceLoopCharacteristics'], ns: 'activiti', attrs: ['collection', 'elementVariable', 'elementIndexVariable'] },
      { elements: ['multiInstanceLoopCharacteristics'], ns: 'any', attrs: ['isSequential'] },
    ],
  },
  'child/multi/instance/MultiInstanceInputDataItemParser': {
    reads: [{ elements: ['inputDataItem'], ns: 'any', attrs: ['name'] }],
  },
  'child/multi/instance/MultiInstanceOutputDataItemParser': {
    reads: [{ elements: ['outputDataItem'], ns: 'any', attrs: ['name'] }],
  },
  'child/FormPropertyParser': {
    reads: [
      {
        elements: ['formProperty'],
        ns: 'any',
        carrier: 'child',
        attrs: ['id', 'name', 'type', 'variable', 'expression', 'default', 'datePattern', 'required', 'readable', 'writable'],
      },
      { elements: ['value'], ns: 'any', attrs: ['id', 'name'], carrier: 'child' },
      
    ],
  },
  'child/LinkEventDefinitionParser': {
    reads: [{ elements: ['linkEventDefinition'], ns: 'any', attrs: ['name'] }],
    ignore: ['id'],
  },
};

/**
 * Files that are scanned but contain no attribute the modeler has to care about (diagram interchange, imports, web
 * service plumbing, lanes, pools, ...). Listed explicitly so that a new file in the converter fails the run.
 */
const NOT_RELEVANT = new Set([
  'BpmnXMLConverter',
  'parser/DefinitionsParser', 'parser/ItemDefinitionParser', 'parser/DataStoreParser', 'parser/LaneParser',
  'parser/MessageFlowParser', 'parser/ImportParser', 'parser/ParticipantParser', 'parser/BpmnShapeParser',
  'parser/BpmnEdgeParser', 'parser/InterfaceParser', 'parser/ResourceParser', 'parser/MessageParser',
  'child/DataAssociationParser', 'child/IOSpecificationParser', 'child/BaseChildElementParser',
  'util/BpmnXMLUtil',
]);

// --- child elements (inside extensionElements unless noted) ------------------------------------------------------
// element: [parents], kind: how the engine reads the body.
/** @type {Array<{ name: string, ns: 'activiti' | 'bpmn', parents: string[], body?: 'text' | 'children', note?: string, source: string }>} */
const CHILD_ELEMENTS = [
  { name: 'executionListener', ns: 'activiti', parents: ['process', ...FLOW_NODES, 'sequenceFlow'], source: 'ExecutionListenerParser' },
  { name: 'taskListener', ns: 'activiti', parents: ['userTask'], source: 'TaskListenerParser' },
  { name: 'eventListener', ns: 'activiti', parents: ['process'], source: 'ActivitiEventListenerParser' },
  { name: 'field', ns: 'activiti', parents: ['serviceTask', 'sendTask', 'executionListener', 'taskListener', 'messageEventDefinition'], source: 'FieldExtensionParser', note: 'read both inside extensionElements and as a direct child of the element (BpmnXMLUtil.parseChildElements runs the child parser in either place; FieldExtensionParser.accepts lists these parents); the modeler imports both forms and writes extensionElements' },
  { name: 'string', ns: 'activiti', parents: ['field'], body: 'text', source: 'FieldExtensionParser' },
  { name: 'expression', ns: 'activiti', parents: ['field'], body: 'text', source: 'FieldExtensionParser' },
  { name: 'in', ns: 'activiti', parents: ['callActivity'], source: 'CallActivityXMLConverter' },
  { name: 'out', ns: 'activiti', parents: ['callActivity'], source: 'CallActivityXMLConverter' },
  { name: 'mapException', ns: 'activiti', parents: ACTIVITIES.filter((a) => !['subProcess', 'transaction', 'adHocSubProcess'].includes(a)), body: 'text', source: 'ActivitiMapExceptionParser' },
  { name: 'failedJobRetryTimeCycle', ns: 'activiti', parents: ACTIVITIES.filter((a) => !['subProcess', 'transaction', 'adHocSubProcess'].includes(a)), body: 'text', source: 'ActivitiFailedjobRetryParser' },
  { name: 'formProperty', ns: 'activiti', parents: ['startEvent', 'userTask'], source: 'FormPropertyParser' },
  { name: 'value', ns: 'activiti', parents: ['formProperty'], source: 'FormPropertyParser', note: 'form property value (id, name)' },
  { name: 'value', ns: 'activiti', parents: ['dataObject'], body: 'text', source: 'ValuedDataObjectXMLConverter', note: 'default value of a data object' },
  { name: 'customResource', ns: 'activiti', parents: ['userTask'], body: 'children', source: 'UserTaskXMLConverter#CustomIdentityLinkParser' },
  { name: 'potentialStarter', ns: 'activiti', parents: ['process'], body: 'children', source: 'PotentialStarterParser' },
  { name: 'humanPerformer', ns: 'bpmn', parents: ['userTask'], body: 'children', source: 'UserTaskXMLConverter#HumanPerformerParser' },
  { name: 'potentialOwner', ns: 'bpmn', parents: ['userTask'], body: 'children', source: 'UserTaskXMLConverter#PotentialOwnerParser' },
  { name: 'conditionExpression', ns: 'bpmn', parents: ['sequenceFlow'], body: 'text', source: 'ConditionExpressionParser' },
  { name: 'script', ns: 'bpmn', parents: ['scriptTask'], body: 'text', source: 'ScriptTextParser' },
  { name: 'timeDate', ns: 'bpmn', parents: ['timerEventDefinition'], body: 'text', source: 'TimeDateParser' },
  { name: 'timeDuration', ns: 'bpmn', parents: ['timerEventDefinition'], body: 'text', source: 'TimeDurationParser' },
  { name: 'timeCycle', ns: 'bpmn', parents: ['timerEventDefinition'], body: 'text', source: 'TimeCycleParser' },
  { name: 'loopCardinality', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], body: 'text', source: 'LoopCardinalityParser' },
  { name: 'loopDataInputRef', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], body: 'text', source: 'MultiInstanceDataInputParser', note: 'read as a variable name, not an id reference' },
  { name: 'loopDataOutputRef', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], body: 'text', source: 'LoopDataOutputRefParser', note: 'read as a variable name, not an id reference' },
  { name: 'inputDataItem', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], source: 'MultiInstanceInputDataItemParser' },
  { name: 'outputDataItem', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], source: 'MultiInstanceOutputDataItemParser' },
  { name: 'completionCondition', ns: 'bpmn', parents: ['multiInstanceLoopCharacteristics'], body: 'text', source: 'MultiInstanceCompletionConditionParser' },
  { name: 'source', ns: 'bpmn', parents: ['linkEventDefinition'], body: 'text', source: 'LinkEventSourceParser' },
  { name: 'target', ns: 'bpmn', parents: ['linkEventDefinition'], body: 'text', source: 'LinkEventTargetParser' },
];

/** Event-definition children that carry no activiti-specific attribute but are read. */
const EVENT_DEFINITIONS = {
  timerEventDefinition: ['startEvent', 'intermediateCatchEvent', 'boundaryEvent'],
  messageEventDefinition: ['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'endEvent', 'boundaryEvent'],
  signalEventDefinition: ['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent'],
  errorEventDefinition: ['startEvent', 'endEvent', 'boundaryEvent'],
  terminateEventDefinition: ['endEvent'],
  cancelEventDefinition: ['endEvent', 'boundaryEvent'],
  compensateEventDefinition: ['intermediateThrowEvent', 'boundaryEvent'],
  linkEventDefinition: ['intermediateCatchEvent', 'intermediateThrowEvent'],
};

// --- reads that happen outside the converter (engine side) ---------------------------------------------------------
// They are read from the generic ExtensionElement / ExtensionAttribute model, so no converter file mentions them.
// `verify` lists strings that must occur in the named engine source file (checked when --engine-sources is given).

const ENGINE_READS = [
  {
    entries: [
      { element: 'messageEventDefinition', kind: 'attribute', namespace: 'activiti', name: 'class', match: 'strict', note: 'custom ThrowMessageDelegate class' },
      { element: 'messageEventDefinition', kind: 'attribute', namespace: 'activiti', name: 'delegateExpression', match: 'strict', note: 'custom ThrowMessageDelegate bean' },
    ],
    origin: 'DefaultActivityBehaviorFactory#createThrowMessageDelegate',
    file: 'org/activiti/engine/impl/bpmn/parser/factory/DefaultActivityBehaviorFactory.java',
    verify: ['checkClassDelegate', 'checkDelegateExpression', 'it.containsKey("activiti")'],
  },
  {
    entries: [
      ...['process', 'userTask', 'subProcess', 'dataObject'].map((element) => ({ element, kind: 'element', namespace: 'activiti', name: 'localization', match: 'local-name', body: 'attributes', note: 'process definition info (name / description per locale)' })),
      { element: 'localization', kind: 'attribute', namespace: 'none', name: 'locale', match: 'agnostic' },
      { element: 'localization', kind: 'attribute', namespace: 'none', name: 'name', match: 'agnostic' },
      { element: 'localization', kind: 'element', namespace: 'activiti', name: 'documentation', match: 'local-name', body: 'text' },
    ],
    origin: 'BpmnDeployer#createLocalizationValues',
    file: 'org/activiti/engine/impl/bpmn/deployer/BpmnDeployer.java',
    verify: ['get("localization")', 'getAttributeValue(null, "locale")', 'getAttributeValue(null, "name")', 'get("documentation")', 'ACTIVITI_EXTENSIONS_PREFIX'],
  },
];

// --- source access ----------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { sources: process.env.ACTIVITI_CONVERTER_SOURCES, engineSources: process.env.ACTIVITI_ENGINE_SOURCES, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sources') args.sources = argv[++i];
    else if (argv[i] === '--engine-sources') args.engineSources = argv[++i];
    else if (argv[i] === '--check') args.check = true;
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!args.sources) {
    throw new Error('Pass --sources <dir | sources.jar> (or set ACTIVITI_CONVERTER_SOURCES). The jar is org.activiti:activiti-bpmn-converter:9.0.0:sources.');
  }
  return args;
}

/** Returns the directory that contains org/activiti/bpmn/..., extracting a sources jar when needed. */
function resolveSourceRoot(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Not found: ${abs}`);
  let root = abs;
  if (statSync(abs).isFile()) {
    root = mkdtempSync(join(tmpdir(), 'activiti-converter-'));
    execFileSync('unzip', ['-q', abs, '-d', root]);
  }
  const converterDir = join(root, 'org/activiti/bpmn/converter');
  if (!existsSync(converterDir)) throw new Error(`No org/activiti/bpmn/converter below ${root}`);
  return { converterDir, constantsFile: join(root, 'org/activiti/bpmn/constants/BpmnXMLConstants.java') };
}

function resolveEngineRoot(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Not found: ${abs}`);
  if (!statSync(abs).isFile()) return abs;
  const root = mkdtempSync(join(tmpdir(), 'activiti-engine-'));
  execFileSync('unzip', ['-q', abs, '-d', root]);
  return root;
}

function loadConstants(file) {
  const text = readFileSync(file, 'utf8');
  const map = new Map();
  for (const m of text.matchAll(/public static final String (\w+)\s*=\s*"([^"]*)";/g)) map.set(m[1], m[2]);
  return map;
}

function listJava(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'alfresco' || entry === 'export') continue; // writer side / Alfresco model classes
    if (statSync(full).isDirectory()) out.push(...listJava(full, base));
    else if (entry.endsWith('.java')) out.push(full.slice(base.length + 1).replace(/\.java$/, ''));
  }
  return out.sort();
}

/** Resolves a constant name or string literal; a few classes keep their own constants. */
function resolveName(token, constants, local) {
  if (token.startsWith('"')) return token.slice(1, -1);
  return constants.get(token) ?? local.get(token);
}

function scanReads(text, constants) {
  const local = new Map();
  for (const m of text.matchAll(/(?:public|protected|private)?\s*static final String (\w+)\s*=\s*"([^"]*)";/g)) local.set(m[1], m[2]);
  const reads = [];
  const re = /getAttributeValue\(\s*(ACTIVITI_EXTENSIONS_NAMESPACE|null)\s*,\s*(\w+|"[^"]*")\s*\)/g;
  for (const m of text.matchAll(re)) {
    const name = resolveName(m[2], constants, local);
    if (name === undefined) throw new Error(`Cannot resolve constant ${m[2]}`);
    reads.push({ ns: m[1] === 'null' ? 'any' : 'activiti', name });
  }
  return reads;
}

// --- main -------------------------------------------------------------------------------------------------------

function build(sourcesArg, engineSourcesArg) {
  const { converterDir, constantsFile } = resolveSourceRoot(sourcesArg);
  const constants = loadConstants(constantsFile);
  const problems = [];
  const entries = new Map();

  const add = (entry) => {
    if (entries.has(entry.id)) {
      const prev = entries.get(entry.id);
      prev.origin = [...new Set([...prev.origin, ...entry.origin])].sort();
      // a strict read wins over an agnostic one
      if (entry.match === 'strict') prev.match = 'strict';
      return;
    }
    entries.set(entry.id, entry);
  };

  const files = listJava(converterDir);
  for (const file of files) {
    const text = readFileSync(join(converterDir, `${file}.java`), 'utf8');
    const scanned = scanReads(text, constants);
    const spec = READ_SITES[file];
    if (!spec) {
      if (scanned.length > 0 && !NOT_RELEVANT.has(file) && !(file.endsWith('XMLConverter') && scanned.every((r) => ['id', 'name'].includes(r.name)))) {
        problems.push(`${file}: reads ${[...new Set(scanned.map((r) => r.name))].join(', ')} but has no entry in READ_SITES or NOT_RELEVANT`);
      }
      continue;
    }
    const declared = new Set();
    for (const read of spec.reads) {
      for (const attr of read.attrs) {
        declared.add(`${read.ns}:${attr}`);
        if (!scanned.some((s) => s.ns === read.ns && s.name === attr)) {
          problems.push(`${file}: declared ${read.ns} read of "${attr}" not found in the source`);
        }
      }
    }
    for (const s of scanned) {
      if (spec.ignore?.includes(s.name)) continue;
      if (!declared.has(`${s.ns}:${s.name}`)) problems.push(`${file}: undeclared ${s.ns} read of "${s.name}"`);
    }
    for (const read of spec.reads) {
      for (const element of read.elements) {
        for (const attr of read.attrs) {
          const carrierIsChild = read.carrier === 'child';
          const namespace = carrierIsChild ? 'none' : read.ns === 'activiti' ? 'activiti' : 'bpmn';
          // attributes of activiti child elements are written unqualified; their namespace is the element's
          const id = `${element}@${namespace === 'activiti' ? 'activiti:' : ''}${attr}`;
          add({
            id,
            element,
            kind: 'attribute',
            namespace,
            name: attr,
            match: read.ns === 'activiti' ? 'strict' : 'agnostic',
            origin: [file.split('/').pop()],
            modeler: ROUNDTRIP_ELEMENTS.has(element) ? 'roundtrip' : 'edit',
          });
        }
      }
    }
  }

  for (const spec of Object.keys(READ_SITES)) {
    if (!files.includes(spec)) problems.push(`READ_SITES lists ${spec} but the file does not exist in the sources`);
  }

  // child elements: the converter / parser class named as the source must exist
  for (const child of CHILD_ELEMENTS) {
    const cls = child.source.split('#')[0];
    const known = files.some((f) => f.endsWith(cls)) || [...files].some((f) => readFileSync(join(converterDir, `${f}.java`), 'utf8').includes(`class ${child.source.split('#')[1] ?? cls}`));
    if (!known) problems.push(`child element ${child.name}: source class ${child.source} not found`);
    for (const parent of child.parents) {
      add({
        id: `${parent}>${child.ns === 'activiti' ? 'activiti:' : ''}${child.name}`,
        element: parent,
        kind: 'element',
        namespace: child.ns,
        name: child.name,
        match: child.ns === 'activiti' ? 'local-name' : 'agnostic',
        origin: [child.source],
        body: child.body ?? 'attributes',
        modeler: ROUNDTRIP_ELEMENTS.has(parent) || ROUNDTRIP_ELEMENTS.has(child.name) ? 'roundtrip' : 'edit',
        ...(child.note ? { note: child.note } : {}),
      });
    }
  }
  for (const [definition, parents] of Object.entries(EVENT_DEFINITIONS)) {
    for (const parent of parents) {
      add({
        id: `${parent}>${definition}`,
        element: parent,
        kind: 'element',
        namespace: 'bpmn',
        name: definition,
        match: 'agnostic',
        origin: ['BpmnXMLUtil#genericChildParserMap'],
        body: 'attributes',
        modeler: 'edit',
      });
    }
  }

  for (const group of ENGINE_READS) {
    if (engineSourcesArg) {
      const engineRoot = resolveEngineRoot(engineSourcesArg);
      const file = join(engineRoot, group.file);
      if (!existsSync(file)) {
        problems.push(`${group.origin}: ${group.file} not found in the engine sources`);
      } else {
        const text = readFileSync(file, 'utf8');
        for (const needle of group.verify) if (!text.includes(needle)) problems.push(`${group.origin}: "${needle}" not found in ${group.file}`);
      }
    }
    for (const e of group.entries) {
      add({
        id: e.kind === 'element' ? `${e.element}>${e.namespace === 'activiti' ? 'activiti:' : ''}${e.name}` : `${e.element}@${e.namespace === 'activiti' ? 'activiti:' : ''}${e.name}`,
        ...e,
        origin: [group.origin],
        modeler: 'edit',
      });
    }
  }

  // the parsers registered for child elements must all be declared above
  const util = readFileSync(join(converterDir, 'util/BpmnXMLUtil.java'), 'utf8');
  const registered = [...util.matchAll(/addGenericParser\(new (\w+)\(\)\)/g)].map((m) => m[1]);
  const knownParsers = new Set([
    ...CHILD_ELEMENTS.map((c) => c.source.split('#')[0]),
    'CancelEventDefinitionParser', 'CompensateEventDefinitionParser', 'ErrorEventDefinitionParser', 'MessageEventDefinitionParser',
    'SignalEventDefinitionParser', 'TerminateEventDefinitionParser', 'TimerEventDefinitionParser', 'LinkEventDefinitionParser',
    'MultiInstanceParser', 'TimeCycleParser',
    // no activiti-specific content:
    'DataInputAssociationParser', 'DataOutputAssociationParser', 'DataStateParser', 'DocumentationParser', 'IOSpecificationParser', 'FlowNodeRefParser',
  ]);
  for (const parser of registered) {
    if (!knownParsers.has(parser)) problems.push(`BpmnXMLUtil registers ${parser}, which is not covered by CHILD_ELEMENTS`);
  }

  // elements that the BpmnXMLConverter handles inline and that CHILD_ELEMENTS declares
  const converterText = readFileSync(join(converterDir, 'BpmnXMLConverter.java'), 'utf8');
  for (const needle of ['ELEMENT_POTENTIAL_STARTER', 'ELEMENT_EXTENSIONS']) {
    if (!converterText.includes(needle)) problems.push(`BpmnXMLConverter no longer references ${needle}`);
  }

  if (problems.length > 0) {
    throw new Error(`Checklist generation found drift between READ_SITES and the sources:\n  - ${problems.join('\n  - ')}`);
  }

  const sorted = [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    $comment: 'GENERATED by scripts/generate-attributes.mjs from the Activiti 9.0.0 converter sources. Do not edit.',
    source: 'org.activiti:activiti-bpmn-converter:9.0.0 (BpmnXMLConstants, converter/*, converter/child/*, converter/parser/*) plus the engine-side reads listed in ENGINE_READS',
    namespace: 'http://activiti.org/bpmn',
    semantics: {
      strict: 'read with getAttributeValue(ACTIVITI_EXTENSIONS_NAMESPACE, name): only activiti:name counts',
      agnostic: 'read with getAttributeValue(null, name): matches the local name in any namespace or none',
      'local-name': 'child element matched by local name only',
    },
    excluded: ['alfrescoScriptType (Alfresco-only model classes AlfrescoUserTask / AlfrescoStartEvent)', 'diagram interchange, imports, interfaces, lanes, participants, message flows (no activiti: content)'],
    counts: {
      total: sorted.length,
      attributes: sorted.filter((e) => e.kind === 'attribute').length,
      elements: sorted.filter((e) => e.kind === 'element').length,
    },
    entries: sorted,
  };
}

const args = parseArgs(process.argv.slice(2));
const checklist = build(args.sources, args.engineSources);
const json = `${JSON.stringify(checklist, null, 2)}\n`;
if (args.check) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== json) {
    console.error('support/activiti-attributes.json is stale; rerun without --check');
    process.exit(1);
  }
  console.log(`checklist up to date (${checklist.counts.total} entries)`);
} else {
  writeFileSync(OUTPUT, json);
  console.log(`wrote ${OUTPUT}: ${checklist.counts.total} entries (${checklist.counts.attributes} attributes, ${checklist.counts.elements} elements)`);
}
