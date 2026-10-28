import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { diffBpmn } from '../../semantic-diff';
import { verifyBpmnXml } from '../../verify';
import { ACTIVITI_NS, CAMUNDA_NS, convertCamundaBpmn, detectCamunda, lossReportMarkdown, type ConversionResult, type ReportEntry } from './index';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/camunda');
const fixture = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf8');
const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="urn:t">';

/** A process document around the given body. */
const doc = (body: string, head = HEAD): string => `${head}<bpmn:process id="p" isExecutable="true">${body}</bpmn:process></bpmn:definitions>`;
const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const byId = (xml: string, id: string): Element => parse(xml).querySelector(`[id="${id}"]`) as Element;
const attr = (el: Element, name: string): string | null => el.getAttributeNS(ACTIVITI_NS, name);
const run = (body: string, options = {}): ConversionResult => convertCamundaBpmn(doc(body), options);
const losses = (r: ConversionResult, kind?: ReportEntry['kind']): string[] => r.report.entries.filter((e) => !kind || e.kind === kind).map((e) => `${e.elementId}|${e.item}`);
/** What was reported for the element t, without the MAP_ALL default. */
const reported = (r: ConversionResult): string[] => r.report.entries.filter((e) => !e.what.startsWith('MAP_ALL')).map((e) => e.item);

/** The names of everything in a vendor namespace (the Camunda family) left in a document. */
function vendorLeftovers(xml: string): string[] {
  const d = parse(xml);
  const found: string[] = [];
  for (const el of Array.from(d.getElementsByTagName('*'))) {
    if (el.namespaceURI?.startsWith('http://camunda.org/schema/')) found.push(`<${el.nodeName}>`);
    for (const a of Array.from(el.attributes)) if (a.namespaceURI?.startsWith('http://camunda.org/schema/') || a.value.startsWith('http://camunda.org/schema/')) found.push(`${a.name}=${a.value}`);
  }
  return found;
}

describe('U17 detectCamunda', () => {
  it('finds the Camunda 7 attributes and elements and the prefix they use', () => {
    const found = detectCamunda(fixture('order-approval.bpmn'));
    expect(found).toMatchObject({ found: true, zeebe: false, modeler: true, prefixes: ['camunda'] });
    expect(found.attributes).toBeGreaterThan(20);
    expect(found.elements).toBeGreaterThan(20);
  });

  it('knows a Camunda 8 model by its Zeebe namespace', () => {
    expect(detectCamunda(fixture('camunda8-zeebe.bpmn'))).toMatchObject({ found: true, zeebe: true });
  });

  it('counts the Camunda Modeler metadata alone as a reason to convert, because the export refuses the attributes', () => {
    expect(detectCamunda(fixture('modeler-attributes-only.bpmn20.xml'))).toMatchObject({ found: true, modeler: true, attributes: 0, elements: 0 });
  });

  it('finds nothing in an Activiti file, and does not parse a file that cannot contain it', () => {
    expect(detectCamunda(fixture('activiti-native.bpmn20.xml')).found).toBe(false);
    expect(detectCamunda('not xml at all').found).toBe(false);
  });

  it('reports a Camunda file that is not well-formed instead of throwing', () => {
    const found = detectCamunda('<a xmlns:c="http://camunda.org/schema/1.0/bpmn"><b></a>');
    expect(found.found).toBe(false);
    expect(found.error).toBeTruthy();
  });

  it('finds a prefix other than camunda', () => {
    const found = detectCamunda(doc('<bpmn:task id="t" cam:asyncBefore="true"/>', HEAD.replace('xmlns:camunda', 'xmlns:cam')));
    expect(found.prefixes).toEqual(['cam']);
    expect(found.attributes).toBe(1);
  });
});

describe('U17 the fixtures convert to a model the export checks accept', () => {
  const files = readdirSync(FIXTURES).filter((f) => /\.bpmn(20\.xml)?$/.test(f) && !f.startsWith('activiti-native'));
  for (const file of files) {
    it(`${file}: nothing of Camunda is left, the serializer checks pass, and every line of the report names an element`, () => {
      const result = convertCamundaBpmn(fixture(file), { fileName: file });
      expect(result.converted).toBe(true);
      expect(vendorLeftovers(result.xml)).toEqual([]);
      expect(result.xml).not.toMatch(/camunda\.org\/schema/);
      const { violations } = verifyBpmnXml(result.xml);
      expect(violations.map((v) => `${v.code} ${v.message}`)).toEqual([]);
      // the file converts to a fixed point: a second run finds nothing to do
      expect(convertCamundaBpmn(result.xml).converted).toBe(false);
      for (const entry of result.report.entries) {
        expect(entry.item, JSON.stringify(entry)).toBeTruthy();
        expect(entry.why, JSON.stringify(entry)).toBeTruthy();
      }
      expect(result.report.counts.converted).toBe(result.report.converted.length);
      // the structure and the diagram are the input's: ids of elements and shapes
      const ids = (xml: string): string[] => Array.from(parse(xml).querySelectorAll('[id]')).map((e) => e.getAttribute('id')!).sort();
      const inVendorElements = Array.from(parse(fixture(file)).getElementsByTagName('*')).filter((e) => e.namespaceURI?.startsWith('http://camunda.org/schema/')).flatMap((e) => Array.from(e.querySelectorAll('[id]')).concat(e.hasAttribute('id') ? [e] : [])).map((e) => e.getAttribute('id')!);
      const gone = ids(fixture(file)).filter((id) => !ids(result.xml).includes(id));
      expect(ids(result.xml).filter((id) => !ids(fixture(file)).includes(id))).toEqual([]);
      expect(gone.filter((id) => !inVendorElements.includes(id))).toEqual([]);
    });
  }

  it('an Activiti file is returned as it is', () => {
    const input = fixture('activiti-native.bpmn20.xml');
    const result = convertCamundaBpmn(input);
    expect(result.converted).toBe(false);
    expect(result.xml).toBe(input);
    expect(result.extensions).toBeUndefined();
    expect(result.report.entries).toEqual([]);
  });
});

describe('U17 order-approval: user tasks, listeners, forms, mappings', () => {
  const result = convertCamundaBpmn(fixture('order-approval.bpmn'), { fileName: 'order-approval.bpmn', newId: (() => { let n = 0; return () => `v${(n += 1)}`; })() });
  const xml = result.xml;

  it('moves the same-name attributes to activiti: on the process, start event, service and user tasks', () => {
    const process = byId(xml, 'orderApproval');
    expect(attr(process, 'candidateStarterGroups')).toBe('sales');
    expect(process.getAttributeNS(CAMUNDA_NS, 'historyTimeToLive')).toBeNull();
    const start = byId(xml, 'orderReceived');
    expect([attr(start, 'initiator'), attr(start, 'formKey')]).toEqual(['starter', 'app:forms/new-order']);
    const review = byId(xml, 'reviewOrder');
    expect([attr(review, 'assignee'), attr(review, 'candidateGroups'), attr(review, 'priority'), attr(review, 'formKey')]).toEqual(['${reviewer}', 'managers,finance', '70', 'app:forms/review']);
    expect(attr(review, 'dueDate')).toBe('${dateTime().plusDays(2).toDate()}');
    expect(attr(byId(xml, 'collectDetails'), 'candidateUsers')).toBe('ann,bob');
  });

  it('asyncBefore becomes activiti:async, asyncAfter and the job priority are dropped, exclusive is kept', () => {
    const check = byId(xml, 'checkStock');
    expect(attr(check, 'async')).toBe('true');
    expect(attr(check, 'exclusive')).toBe('false');
    expect(attr(check, 'class')).toBe('com.acme.orders.StockCheck');
    expect(losses(result, 'dropped')).toEqual(expect.arrayContaining(['checkStock|camunda:asyncAfter="true"', 'checkStock|camunda:jobPriority="5"']));
  });

  it('a service task expression with a result variable gets activiti:resultVariableName', () => {
    const price = byId(xml, 'priceOrder');
    expect(attr(price, 'expression')).toBe('${pricing.price(order)}');
    expect(attr(price, 'resultVariableName')).toBe('price');
    expect(attr(price, 'resultVariable')).toBeNull();
  });

  it('field injection and the retry cycle keep their content, in the activiti namespace', () => {
    const check = byId(xml, 'checkStock');
    const fields = Array.from(check.getElementsByTagNameNS(ACTIVITI_NS, 'field'));
    expect(fields.map((f) => f.getAttribute('name'))).toEqual(['warehouse', 'minimum']);
    expect(fields[0]!.getAttribute('stringValue')).toBe('EU-1');
    expect(fields[1]!.getElementsByTagNameNS(ACTIVITI_NS, 'expression')[0]!.textContent).toBe('${minimumStock}');
    expect(check.getElementsByTagNameNS(ACTIVITI_NS, 'failedJobRetryTimeCycle')[0]!.textContent).toBe('R3/PT5M');
    // XSD order: the container is still the first child that is not documentation
    expect(check.firstElementChild!.localName).toBe('extensionElements');
  });

  it('keeps the listeners Activiti has and drops update, timeout and script listeners with a reason', () => {
    const direct = (id: string, name: string): Element[] => Array.from(byId(xml, id).querySelector(':scope > *|extensionElements')?.children ?? []).filter((c) => c.namespaceURI === ACTIVITI_NS && c.localName === name);
    const listeners = (id: string, name: string): string[] => direct(id, name).map((l) => `${l.getAttribute('event')}:${l.getAttribute('class') ?? l.getAttribute('expression')}`);
    expect(listeners('reviewOrder', 'taskListener')).toEqual(['create:com.acme.orders.TaskCreated', 'assignment:${notifier.assigned(task)}']);
    expect(listeners('orderApproval', 'executionListener')).toEqual(['start:com.acme.orders.AuditListener']);
    expect(listeners('orderRejected', 'executionListener')).toEqual(['end:${audit.rejected(execution)}']);
    const dropped = result.report.entries.filter((e) => e.item.includes('Listener'));
    expect(dropped.map((e) => e.elementId)).toEqual(['reviewOrder', 'reviewOrder', 'orderRejected']);
    expect(dropped.map((e) => e.why).join('|')).toMatch(/create, assignment, complete, delete/);
    expect(dropped.map((e) => e.why).join('|')).toMatch(/timeout/);
    expect(dropped.map((e) => e.why).join('|')).toMatch(/no script listeners/);
  });

  it('the input / output parameters of the user task become its mapping; a script and an expression output are reported', () => {
    const mapping = result.extensions!.extensions['orderApproval']!.mappings['reviewOrder']!;
    expect(mapping.inputs).toEqual({
      orderTotal: { type: 'VALUE', value: '${price * 1.2}' },
      channel: { type: 'VALUE', value: 'web' },
      regions: { type: 'VALUE', value: ['EU', 'US'] },
      limits: { type: 'VALUE', value: { soft: '1000', hard: '5000' } },
    });
    expect(mapping.outputs).toEqual({ approved: { type: 'VARIABLE', value: 'decision' }, reviewedBy: { type: 'VALUE', value: 'anna' } });
    expect(losses(result, 'dropped')).toEqual(expect.arrayContaining(['reviewOrder|<camunda:inputParameter name="rule"> = script (groovy)', 'reviewOrder|<camunda:outputParameter name="shout"> = ${reviewComment.toUpperCase()}']));
    // every output target is declared, or the engine drops the output
    const declared = Object.values(result.extensions!.extensions['orderApproval']!.properties).map((p) => `${p.name}:${p.type}`).sort();
    expect(declared).toEqual(['approved:json', 'reviewedBy:string']);
  });

  it('a user task without parameters gets MAP_ALL like a new element, and the report says so', () => {
    expect(result.extensions!.extensions['orderApproval']!.mappings['collectDetails']).toEqual({ mappingType: 'MAP_ALL' });
    expect(result.report.entries.find((e) => e.elementId === 'collectDetails' && e.what.startsWith('MAP_ALL'))?.kind).toBe('info');
    const none = convertCamundaBpmn(fixture('order-approval.bpmn'), { defaultMappings: 'none' });
    expect(none.extensions!.extensions['orderApproval']!.mappings['collectDetails']).toBeUndefined();
  });

  it('the generated form becomes form properties with the type, the default, required and the enum values', () => {
    const props = Array.from(byId(xml, 'collectDetails').getElementsByTagNameNS(ACTIVITI_NS, 'formProperty'));
    expect(props.map((p) => [p.getAttribute('id'), p.getAttribute('name'), p.getAttribute('type'), p.getAttribute('default'), p.getAttribute('required')])).toEqual([
      ['street', 'Street', 'string', null, 'true'],
      ['parcels', 'Parcels', 'long', '1', null],
      ['speed', 'Delivery', 'enum', 'standard', null],
      ['giftWrap', 'Gift wrap', 'boolean', null, null],
      ['remarks', 'Remarks', 'string', null, null],
    ]);
    expect(Array.from(props[2]!.getElementsByTagNameNS(ACTIVITI_NS, 'value')).map((v) => `${v.getAttribute('id')}=${v.getAttribute('name')}`)).toEqual(['standard=Standard', 'express=Express']);
    expect(losses(result)).toEqual(expect.arrayContaining(['collectDetails|formData (5 fields)', 'collectDetails|formField remarks type="customText"', 'collectDetails|formField street constraint maxlength="80"']));
  });

  it('keeps conditions and the default flow, drops the properties of the process with their content, and the Modeler metadata', () => {
    expect(byId(xml, 'Flow_approved').getElementsByTagNameNS(BPMN, 'conditionExpression')[0]!.textContent).toBe('${approved == true}');
    expect(byId(xml, 'isApproved').getAttribute('default')).toBe('Flow_rejected');
    expect(result.report.entries.find((e) => e.item.startsWith('<camunda:properties>'))?.item).toContain('owner=sales-ops');
    expect(result.report.entries.filter((e) => e.kind === 'info' && e.item.startsWith('modeler:')).map((e) => e.item)).toEqual(['modeler:executionPlatform="Camunda Platform"', 'modeler:executionPlatformVersion="7.20.0"']);
  });

  it('lists the report in document order', () => {
    const order = Array.from(parse(xml).querySelectorAll('[id]')).map((e) => e.getAttribute('id')!);
    const positions = result.report.entries.map((e) => order.indexOf(e.elementId));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('U17 invoice-processing: scripts, business rule tasks, external tasks, errors, loops', () => {
  const result = convertCamundaBpmn(fixture('invoice-processing.bpmn'), { fileName: 'invoice-processing.bpmn' });
  const xml = result.xml;

  it('script task result variables keep their name, a resource script is dropped, an engine-less format is flagged', () => {
    expect(attr(byId(xml, 'normalise'), 'resultVariable')).toBe('net');
    expect(attr(byId(xml, 'normalise'), 'async')).toBe('true');
    expect(attr(byId(xml, 'loadRates'), 'resultVariable')).toBe('rates');
    expect(losses(result, 'dropped')).toContain('loadRates|camunda:resource="deployment://rates.js"');
    expect(result.report.entries.find((e) => e.elementId === 'normalise' && e.item === 'scriptFormat="groovy"')?.kind).toBe('approximated');
  });

  it('a business rule task with a decisionRef becomes a decision task with the DMN connector and the table constant', () => {
    const task = byId(xml, 'classify');
    expect(task.localName).toBe('serviceTask');
    expect(task.getAttribute('implementation')).toBe('dmn-connector.EXECUTE_TABLE');
    expect(result.extensions!.extensions['invoiceProcessing']!.constants['classify']).toEqual({ _activiti_dmn_table_: { value: 'invoiceClassification' } });
    expect(losses(result)).toEqual(expect.arrayContaining(['classify|camunda:decisionRefBinding="version"', 'classify|camunda:decisionRefVersion="4"']));
    expect(result.report.entries.find((e) => e.elementId === 'classify' && e.item.includes('mapDecisionResult'))?.kind).toBe('approximated');
    expect(result.report.entries.find((e) => e.item.startsWith('decisionRef="invoiceClassification"'))?.why).toMatch(/DMN file/);
  });

  it('with the DMN file at hand the decision task maps its inputs and outputs, and a single output column gets the result variable name', () => {
    const mapped = convertCamundaBpmn(fixture('invoice-processing.bpmn'), {
      decision: (ref) => (ref === 'invoiceClassification' ? { id: ref, name: 'Invoice class', inputs: ['net', 'supplierCountry'], outputs: [{ name: 'class', type: 'string' }] } : undefined),
    });
    const ext = mapped.extensions!.extensions['invoiceProcessing']!;
    expect(ext.mappings['classify']).toEqual({
      inputs: { net: { type: 'VARIABLE', value: 'net' }, supplierCountry: { type: 'VARIABLE', value: 'supplierCountry' } },
      outputs: { invoiceClass: { type: 'VARIABLE', value: 'class' } },
    });
    expect(Object.values(ext.properties).map((p) => `${p.name}:${p.type}`)).toEqual(['invoiceClass:string']);
    // the DMN file is part of the project: no "add the DMN file" line
    expect(mapped.report.entries.some((e) => e.item.startsWith('decisionRef='))).toBe(false);
  });

  it('a business rule task with a class becomes a service task with that class', () => {
    const task = byId(xml, 'legacyRule');
    expect(task.localName).toBe('serviceTask');
    expect(attr(task, 'class')).toBe('com.acme.invoices.LegacyRule');
    expect(task.hasAttribute('implementation')).toBe(false);
  });

  it('an external task keeps no topic or type; the report points to a connector or a delegate', () => {
    expect(byId(xml, 'validateSupplier').getAttributeNames().filter((n) => n.includes(':'))).toEqual([]);
    const why = result.report.entries.find((e) => e.elementId === 'validateSupplier' && e.item.includes('topic'))!.why;
    expect(why).toMatch(/connector/);
  });

  it('error variables, form references and a loop\'s async flag are dropped with the element they belong to named', () => {
    expect(result.report.entries.find((e) => e.item.startsWith('camunda:errorCodeVariable'))).toMatchObject({ elementId: 'supplierUnknown', elementType: 'bpmn:boundaryEvent' });
    expect(result.report.entries.find((e) => e.item.startsWith('camunda:asyncBefore'))).toMatchObject({ elementId: 'approveInvoice', item: 'camunda:asyncBefore="true" (on bpmn:multiInstanceLoopCharacteristics)' });
    expect(losses(result, 'dropped')).toContain('approveInvoice|camunda:formRef="approval-form"');
  });

  it('multi-instance collection and element variable are renamed; the completion condition stays', () => {
    const loop = byId(xml, 'approveInvoice').getElementsByTagNameNS(BPMN, 'multiInstanceLoopCharacteristics')[0]!;
    expect([attr(loop, 'collection'), attr(loop, 'elementVariable')]).toEqual(['${approvers}', 'approver']);
    expect(loop.getElementsByTagNameNS(BPMN, 'completionCondition')[0]!.textContent).toBe('${nrOfCompletedInstances >= 2}');
  });

  it('parameters on a Java delegate task are dropped (the engine would ignore them) and so is the connector', () => {
    expect(losses(result, 'dropped')).toEqual(expect.arrayContaining(['postToLedger|<camunda:inputParameter name="account"> = 4711', 'postToLedger|<camunda:outputParameter name="posted"> = ${true}', 'postToLedger|<camunda:connector>']));
    expect(result.extensions!.extensions['invoiceProcessing']!.mappings['postToLedger']).toBeUndefined();
  });

  it('a message end event keeps the throw class; a message catch event gets MAP_ALL', () => {
    expect(byId(xml, 'MessageEventDefinition_2').getAttributeNS(ACTIVITI_NS, 'class')).toBe('com.acme.invoices.PaidNotifier');
    expect(result.extensions!.extensions['invoiceProcessing']!.mappings['waitForPayment']).toEqual({ mappingType: 'MAP_ALL' });
  });

  it('a script condition language and the resource of a condition are reported; the error message of an error is dropped', () => {
    expect(result.report.entries.find((e) => e.item.startsWith('conditionExpression language="groovy"'))?.kind).toBe('approximated');
    expect(losses(result, 'dropped')).toEqual(expect.arrayContaining(['Error_unknownSupplier|camunda:errorMessage="The supplier is not in the master data"', 'Flow_unknown|camunda:resource="classpath://conditions/supplier.groovy" (on bpmn:conditionExpression)']));
  });
});

describe('U17 call-and-subprocess: call activity parameters', () => {
  const result = convertCamundaBpmn(fixture('call-and-subprocess.bpmn'), { fileName: 'call-and-subprocess.bpmn' });
  const xml = result.xml;

  it('in and out parameters keep source, sourceExpression and target', () => {
    const call = byId(xml, 'pickAndPack');
    const params = (name: string): string[] => Array.from(call.getElementsByTagNameNS(ACTIVITI_NS, name)).map((p) => [p.getAttribute('source'), p.getAttribute('sourceExpression'), p.getAttribute('target')].join('|'));
    expect(params('in')).toEqual(['orderId||orderRef', '|${order.items.size()}|itemCount']);
    expect(params('out')).toEqual(['parcelId||parcel', '|${weight * 2}|doubleWeight']);
  });

  it('variables="all" on in becomes inheritVariables, on out the mapping MAP_ALL_OUTPUTS; the business key is inherited or set', () => {
    const call = byId(xml, 'pickAndPack');
    expect(attr(call, 'inheritVariables')).toBe('true');
    expect(attr(call, 'inheritBusinessKey')).toBe('true');
    expect(result.extensions!.extensions['shipOrder']!.mappings['pickAndPack']).toEqual({ mappingType: 'MAP_ALL_OUTPUTS' });
    expect(attr(byId(xml, 'bookCarrier'), 'businessKey')).toBe('${orderNumber}');
    expect(attr(byId(xml, 'bookCarrier'), 'inheritVariables')).toBe('true');
    // no MAP_ALL on call activities: Camunda passes only what the parameters say
    expect(result.extensions!.extensions['shipOrder']!.mappings['bookCarrier']).toBeUndefined();
  });

  it('version binding, tenant, case reference and the mapping class are dropped; "latest" is not reported', () => {
    expect(losses(result, 'dropped')).toEqual(expect.arrayContaining([
      'pickAndPack|camunda:calledElementBinding="version"', 'pickAndPack|camunda:calledElementVersion="7"', 'pickAndPack|camunda:calledElementTenantId="eu"',
      'pickAndPack|camunda:variableMappingClass="com.acme.Mapper"', 'bookCarrier|camunda:caseRef="carrierCase"',
    ]));
    expect(losses(result).join('\n')).not.toContain('calledElementBinding="latest"');
  });

  it('parameters of a sub process are dropped; its async flag and listener are kept; a signal start in an event sub process gets no mapping', () => {
    expect(attr(byId(xml, 'labelling'), 'async')).toBe('true');
    expect(byId(xml, 'labelling').getElementsByTagNameNS(ACTIVITI_NS, 'executionListener')).toHaveLength(1);
    expect(losses(result, 'dropped')).toContain('labelling|<camunda:inputParameter name="format"> = PDF');
    // a signal reaches the process without a mapping (engine finding 37)
    expect(result.extensions!.extensions['shipOrder']!.mappings['cancelStart']).toBeUndefined();
    expect(attr(byId(xml, 'printLabel'), 'async')).toBeNull();
  });
});

describe('U17 Camunda 8 and Modeler metadata', () => {
  it('a Zeebe model keeps its structure, loses every Zeebe extension and says so at the top of the report', () => {
    const result = convertCamundaBpmn(fixture('camunda8-zeebe.bpmn'), { fileName: 'c8.bpmn' });
    expect(result.converted).toBe(true);
    expect(vendorLeftovers(result.xml)).toEqual([]);
    expect(result.report.general[0]).toMatch(/Camunda 8/);
    expect(result.report.entries.filter((e) => e.kind === 'dropped').map((e) => e.item)).toEqual(['<zeebe:taskDefinition>', '<zeebe:ioMapping>']);
    expect(lossReportMarkdown(result.report)).toContain('> This is a Camunda 8 (Zeebe) model.');
  });

  it('a file with only the Modeler attributes loses them and is otherwise unchanged', () => {
    const input = fixture('modeler-attributes-only.bpmn20.xml');
    const result = convertCamundaBpmn(input, { defaultMappings: 'none' });
    expect(result.converted).toBe(true);
    expect(vendorLeftovers(result.xml)).toEqual([]);
    expect(result.report.counts).toMatchObject({ dropped: 0, info: 2 });
    expect(verifyBpmnXml(result.xml).violations).toEqual([]);
    // the model is the same
    expect(diffBpmn(input.replace(/ xmlns:modeler="[^"]*"| modeler:\w+="[^"]*"/g, ''), result.xml)).toEqual([]);
  });
});

describe('U17 rules, one attribute at a time', () => {
  // [element, attributes, expected activiti: attributes, expected loss items (element id t)]
  const cases: Array<[string, string, Record<string, string>, string[]]> = [
    ['userTask', 'camunda:assignee="kermit" camunda:candidateUsers="a,b" camunda:candidateGroups="g" camunda:dueDate="P1D" camunda:priority="50"', { assignee: 'kermit', candidateUsers: 'a,b', candidateGroups: 'g', dueDate: 'P1D', priority: '50' }, []],
    ['userTask', 'camunda:followUpDate="P2D" camunda:formHandlerClass="x.Y"', {}, ['camunda:followUpDate="P2D"', 'camunda:formHandlerClass="x.Y"']],
    ['userTask', 'camunda:formRef="f" camunda:formRefVersion="2"', {}, ['camunda:formRef="f"', 'camunda:formRefVersion="2"']],
    ['task', 'camunda:assignee="kermit"', {}, ['camunda:assignee="kermit"']],
    ['serviceTask', 'camunda:class="a.B"', { class: 'a.B' }, []],
    ['serviceTask', 'camunda:delegateExpression="${d}"', { delegateExpression: '${d}' }, []],
    ['serviceTask', 'camunda:expression="${e}" camunda:resultVariable="r"', { expression: '${e}', resultVariableName: 'r' }, []],
    ['serviceTask', 'camunda:resultVariable="r" camunda:expression="${e}"', { expression: '${e}', resultVariableName: 'r' }, []],
    ['serviceTask', 'camunda:class="a.B" camunda:resultVariable="r"', { class: 'a.B' }, ['camunda:resultVariable="r"']],
    ['serviceTask', 'camunda:type="external" camunda:topic="t"', {}, ['camunda:type="external"', 'camunda:topic="t"']],
    ['scriptTask', 'camunda:resultVariable="r"', { resultVariable: 'r' }, []],
    ['callActivity', 'camunda:calledElementBinding="latest"', {}, []],
    ['task', 'camunda:asyncBefore="true" camunda:exclusive="true"', { async: 'true', exclusive: 'true' }, []],
    ['task', 'camunda:asyncBefore="false" camunda:asyncAfter="false"', {}, []],
    ['task', 'camunda:asyncAfter="true"', {}, ['camunda:asyncAfter="true"']],
    ['task', 'camunda:jobPriority="1" camunda:modelerTemplate="x" camunda:modelerTemplateVersion="2"', {}, ['camunda:jobPriority="1"', 'camunda:modelerTemplate="x"', 'camunda:modelerTemplateVersion="2"']],
    ['startEvent', 'camunda:initiator="i" camunda:formKey="k"', { initiator: 'i', formKey: 'k' }, []],
    ['startEvent', 'camunda:formRef="f" camunda:formRefBinding="latest"', {}, ['camunda:formRef="f"', 'camunda:formRefBinding="latest"']],
    ['task', 'camunda:somethingNew="x"', {}, ['camunda:somethingNew="x"']],
  ];
  for (const [element, attrs, expected, lost] of cases) {
    it(`${element} ${attrs}`, () => {
      const result = run(`<bpmn:${element} id="t" ${attrs} />`);
      const el = byId(result.xml, 't');
      const actual = Object.fromEntries(Array.from(el.attributes).filter((a) => a.namespaceURI === ACTIVITI_NS).map((a) => [a.localName, a.value]));
      expect(actual).toEqual(expected);
      expect(reported(result)).toEqual(lost);
    });
  }

  it('is not fooled by another prefix for the namespace', () => {
    const result = convertCamundaBpmn(doc('<bpmn:userTask id="t" cam:assignee="kermit" />', HEAD.replace('xmlns:camunda', 'xmlns:cam')));
    expect(attr(byId(result.xml, 't'), 'assignee')).toBe('kermit');
    expect(vendorLeftovers(result.xml)).toEqual([]);
  });

  it('keeps the xmlns:activiti declaration once, and a declaration that was there already', () => {
    const result = convertCamundaBpmn(doc('<bpmn:userTask id="t" camunda:assignee="a" />', HEAD.replace('id="d"', 'xmlns:activiti="http://activiti.org/bpmn" id="d"')));
    expect(result.xml.match(/xmlns:activiti=/g)).toHaveLength(1);
  });
});

describe('U17 input and output parameters', () => {
  const task = (inner: string, element = 'userTask', extra = ''): string => `<bpmn:${element} id="t" ${extra}><bpmn:extensionElements><camunda:inputOutput>${inner}</camunda:inputOutput></bpmn:extensionElements></bpmn:${element}>`;
  const mapping = (r: ConversionResult) => r.extensions!.extensions['p']!.mappings['t'];

  it('an output that is one ${variable} reads that variable of the result; a fixed value stays a value; any other expression is refused', () => {
    const r = run(task('<camunda:outputParameter name="a">${x}</camunda:outputParameter><camunda:outputParameter name="b">fixed</camunda:outputParameter><camunda:outputParameter name="c">${x + 1}</camunda:outputParameter><camunda:outputParameter name="d">#{ y }</camunda:outputParameter>'));
    expect(mapping(r)!.outputs).toEqual({ a: { type: 'VARIABLE', value: 'x' }, b: { type: 'VALUE', value: 'fixed' }, d: { type: 'VARIABLE', value: 'y' } });
    expect(losses(r, 'dropped')).toEqual(['t|<camunda:outputParameter name="c"> = ${x + 1}']);
  });

  it('inputs are values, expressions included; lists and maps become JSON, nested', () => {
    const r = run(task('<camunda:inputParameter name="a">${x}</camunda:inputParameter><camunda:inputParameter name="l"><camunda:list><camunda:value>1</camunda:value><camunda:value><camunda:list><camunda:value>${n}</camunda:value></camunda:list></camunda:value></camunda:list></camunda:inputParameter><camunda:inputParameter name="m"><camunda:map><camunda:entry key="k"><camunda:map><camunda:entry key="z">1</camunda:entry></camunda:map></camunda:entry></camunda:map></camunda:inputParameter><camunda:inputParameter name="e"/>'));
    expect(mapping(r)!.inputs).toEqual({ a: { type: 'VALUE', value: '${x}' }, l: { type: 'VALUE', value: ['1', ['${n}']] }, m: { type: 'VALUE', value: { k: { z: '1' } } }, e: { type: 'VALUE', value: '' } });
  });

  it('a list with an expression in an output is refused like any expression', () => {
    const r = run(task('<camunda:outputParameter name="l"><camunda:list><camunda:value>${x}</camunda:value></camunda:list></camunda:outputParameter>'));
    expect(losses(r, 'dropped')).toEqual(['t|<camunda:outputParameter name="l"> = list']);
    expect(mapping(r)).toEqual({ mappingType: 'MAP_ALL' });
  });

  it('a script anywhere in a list is not representable', () => {
    const r = run(task('<camunda:inputParameter name="l"><camunda:list><camunda:value><camunda:script scriptFormat="js">1</camunda:script></camunda:value></camunda:list></camunda:inputParameter>'));
    expect(losses(r, 'dropped')).toEqual(['t|<camunda:inputParameter name="l"> = script (js)']);
  });

  it('an unnamed parameter is reported', () => {
    const r = run(task('<camunda:inputParameter>1</camunda:inputParameter>'));
    expect(losses(r, 'dropped')).toEqual(['t|<camunda:inputParameter>']);
  });

  it('parameters are written where the engine reads them: connectors and decisions, user tasks, call activities, message events', () => {
    const inputs = '<camunda:inputParameter name="a">1</camunda:inputParameter>';
    const read = (element: string, extra = '', children = ''): boolean => {
      const r = run(`<bpmn:${element} id="t" ${extra}><bpmn:extensionElements><camunda:inputOutput>${inputs}</camunda:inputOutput></bpmn:extensionElements>${children}</bpmn:${element}>`);
      return !!mapping(r)?.inputs;
    };
    expect(read('userTask')).toBe(true);
    expect(read('callActivity')).toBe(true);
    expect(read('serviceTask', 'implementation="mailer.SEND"')).toBe(true);
    expect(read('serviceTask', 'camunda:class="a.B"')).toBe(false);
    expect(read('scriptTask')).toBe(false);
    expect(read('subProcess')).toBe(false);
    expect(read('intermediateThrowEvent', '', '<bpmn:messageEventDefinition/>')).toBe(true);
    expect(read('intermediateThrowEvent')).toBe(false);
    // a start event and a catch event have an output mapping only
    expect(read('startEvent')).toBe(false);
  });

  it('declares the output targets once, in the properties of the process, with the type of a literal', () => {
    const r = run(task('<camunda:outputParameter name="a">5</camunda:outputParameter><camunda:outputParameter name="a2">${a}</camunda:outputParameter>'), { newId: (() => { let n = 0; return () => `id${(n += 1)}`; })() });
    expect(Object.values(r.extensions!.extensions['p']!.properties).map((p) => [p.id, p.name, p.type])).toEqual([['id1', 'a', 'string'], ['id2', 'a2', 'json']]);
    expect(r.report.entries.find((e) => e.kind === 'info' && e.item.startsWith('output variables'))?.item).toBe('output variables a2');
  });

  it('adds to an extensions file that exists, and keeps what is in it', () => {
    const existing = { id: 'process-x', extensions: { p: { properties: { k: { id: 'k', name: 'kept', type: 'string' } }, mappings: { other: { mappingType: 'MAP_ALL' } }, constants: {} } } };
    const r = run(task('<camunda:inputParameter name="a">1</camunda:inputParameter>'), { extensions: existing });
    expect(Object.keys(r.extensions!.extensions['p']!.mappings).sort()).toEqual(['other', 't']);
    expect(r.extensions!.extensions['p']!.properties['k']).toBeTruthy();
    expect(r.extensionsJson).toContain('"kept"');
    // the input is not changed
    expect(Object.keys(existing.extensions.p.mappings)).toEqual(['other']);
  });

  it('writes the mapping under the process that holds the element, with a collaboration of two', () => {
    const xml = `${HEAD}<bpmn:process id="a"><bpmn:userTask id="ta"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="x">1</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements></bpmn:userTask></bpmn:process><bpmn:process id="b"><bpmn:subProcess id="sb"><bpmn:callActivity id="cb"><bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="y">2</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements></bpmn:callActivity></bpmn:subProcess></bpmn:process></bpmn:definitions>`;
    const r = convertCamundaBpmn(xml);
    expect(Object.keys(r.extensions!.extensions).sort()).toEqual(['a', 'b']);
    expect(r.extensions!.extensions['a']!.mappings['ta']!.inputs).toEqual({ x: { type: 'VALUE', value: '1' } });
    expect(r.extensions!.extensions['b']!.mappings['cb']!.inputs).toEqual({ y: { type: 'VALUE', value: '2' } });
  });
});

describe('U17 the Markdown report', () => {
  const result = convertCamundaBpmn(fixture('invoice-processing.bpmn'), { fileName: 'invoice-processing.bpmn' });
  const md = lossReportMarkdown(result.report, new Date('2026-10-27T10:00:00Z'));

  it('has a title, a summary, a table per kind with element, what and why, and the list of translations', () => {
    expect(md).toContain('# Camunda 7 import report: invoice-processing.bpmn');
    expect(md).toContain('Created 2026-10-27T10:00:00.000Z');
    expect(md).toMatch(/Converted \d+ attributes and elements to Activiti 9; 19 could not be translated and 5 differ in behaviour\./);
    expect(md).toContain('## Dropped (19)');
    expect(md).toContain('| Element | Type | Item | What happened | Why |');
    expect(md).toContain('| `validateSupplier` Validate supplier | bpmn:serviceTask | `camunda:topic="supplier-validation"` | dropped |');
    expect(md).toContain('## Converted with differences (5)');
    expect(md).toContain('## Notes (4)');
    expect(md).toContain('## Converted (12)');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('escapes pipes and says so when nothing was lost', () => {
    const r = run('<bpmn:userTask id="t" name="a | b" camunda:assignee="x|y" />', { defaultMappings: 'none' });
    const text = lossReportMarkdown(r.report);
    expect(text).toContain('Nothing was lost.');
    expect(text).not.toContain('## Dropped');
    expect(text).toContain('`camunda:assignee="x|y"`'.replace('|', '\\|'));
  });

  it('is deterministic for the same input', () => {
    const again = convertCamundaBpmn(fixture('invoice-processing.bpmn'), { fileName: 'invoice-processing.bpmn' });
    expect(lossReportMarkdown(again.report, new Date('2026-10-27T10:00:00Z'))).toBe(md);
  });
});

describe('U17 default mappings follow the editor (ADR 0006)', () => {
  const mappingOf = (r: ConversionResult, id: string) => r.extensions?.extensions['p']?.mappings[id];

  it('a multi-instance user task gets MAP_ALL_OUTPUTS, a plain one MAP_ALL, and the report names the type', () => {
    const r = run(
      '<bpmn:userTask id="plain" camunda:assignee="a" /><bpmn:userTask id="each" camunda:assignee="a"><bpmn:multiInstanceLoopCharacteristics isSequential="false"><bpmn:loopCardinality>3</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics></bpmn:userTask>',
    );
    expect(mappingOf(r, 'plain')).toEqual({ mappingType: 'MAP_ALL' });
    expect(mappingOf(r, 'each')).toEqual({ mappingType: 'MAP_ALL_OUTPUTS' });
    expect(r.report.entries.find((e) => e.elementId === 'each' && e.what.startsWith('MAP_ALL_OUTPUTS'))?.kind).toBe('info');
  });

  it('a message catch event gets MAP_ALL in every place, a signal catch event never does', () => {
    const r = run(
      '<bpmn:userTask id="u" camunda:assignee="a" /><bpmn:intermediateCatchEvent id="m"><bpmn:messageEventDefinition messageRef="x" /></bpmn:intermediateCatchEvent><bpmn:intermediateCatchEvent id="s"><bpmn:signalEventDefinition signalRef="y" /></bpmn:intermediateCatchEvent>' +
        '<bpmn:subProcess id="esp" triggeredByEvent="true"><bpmn:startEvent id="ms"><bpmn:messageEventDefinition messageRef="x" /></bpmn:startEvent><bpmn:startEvent id="ss"><bpmn:signalEventDefinition signalRef="y" /></bpmn:startEvent></bpmn:subProcess>',
    );
    expect(mappingOf(r, 'm')).toEqual({ mappingType: 'MAP_ALL' });
    expect(mappingOf(r, 'ms')).toEqual({ mappingType: 'MAP_ALL' });
    expect(mappingOf(r, 's')).toBeUndefined();
    expect(mappingOf(r, 'ss')).toBeUndefined();
  });

  it('the setting "none" adds no default at all', () => {
    const r = run('<bpmn:userTask id="plain" camunda:assignee="a" />', { defaultMappings: 'none' });
    expect(mappingOf(r, 'plain')).toBeUndefined();
  });
});
