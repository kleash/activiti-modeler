#!/usr/bin/env node
/**
 * Captures the README showcase images (docs/images/showcase/*.png and *.gif) from the real modeler server and the real app.
 *
 * Rerun:
 *   cd modeler && npm ci                                  # once: playwright and fflate come from modeler/node_modules; Chromium must be installed
 *   scripts/build-server.sh                               # the server jar with the app inside (java/activiti-modeler-server/target/*-exec.jar)
 *   node scripts/capture-showcase.mjs [--jar <jar>] [--out docs/images/showcase] [--only name,name] [--keep]
 *
 * It starts the jar itself on a free port with a temporary workspace (the way scripts/smoke-server.sh does), imports projects through the
 * app's own zip import (corpus C16, C17, N01 and a small "order approval" project that this script writes), drives the app with Playwright
 * and stops the server at the end. ffmpeg (with ffprobe) is needed for the GIFs, python3 with Pillow to shrink the PNGs. Build from a clean checkout of
 * the commit you want to show, not from a tree with unfinished edits. The bpmn.io watermark is never hidden or cropped (licence).
 * `--only` takes the names of the files without the extension, for example `--only bpmn-editor,deploy-run`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const requireFromModeler = createRequire(join(ROOT, 'modeler', 'package.json'));
const { chromium } = requireFromModeler('playwright');
const { zipSync, strToU8 } = requireFromModeler('fflate');

// ---------------------------------------------------------------------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = resolve(option('out', join(ROOT, 'docs', 'images', 'showcase')));
const ONLY = option('only', '') ? new Set(option('only', '').split(',')) : undefined;
const KEEP = args.includes('--keep');
const wanted = (name) => !ONLY || ONLY.has(name);
const TMP = mkdtempSync(join(tmpdir(), 'showcase-'));
const WORK = join(TMP, 'workspace');
const VIDEOS = join(TMP, 'videos');
mkdirSync(WORK, { recursive: true });
mkdirSync(VIDEOS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const log = (...m) => console.log('[showcase]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------------------------------
// content: a small order approval project (clean under the linter, runs on the modeler server) and the corpus projects
// ---------------------------------------------------------------------------------------------------------------------------------------
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const projectJson = (name) => json({ name, version: '1.0.0', activiti: '9.0.0', created: '2026-10-26T12:00:00.000Z', modified: '2026-10-26T12:00:00.000Z' });

function orderApprovalBpmn() {
  // a label box ([x, y, w, h]) moves a name from its default place (below the shape) where a flow runs through it
  const shape = (id, x, y, w, h, extra = '', label) =>
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/>${label ? `<bpmndi:BPMNLabel><dc:Bounds x="${label[0]}" y="${label[1]}" width="${label[2]}" height="${label[3]}"/></bpmndi:BPMNLabel>` : ''}</bpmndi:BPMNShape>`;
  const edge = (id, points) => `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}</bpmndi:BPMNEdge>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_orderApproval" targetNamespace="http://activiti.org/bpmn/showcase">
  <process id="orderApproval" name="Order approval" isExecutable="true">
    <documentation>Looks the customer up, lets a decision table choose between automatic approval and a manager's review, and tells the warehouse.</documentation>
    <startEvent id="orderReceived" name="Order received"/>
    <serviceTask id="lookupCustomer" name="Look up customer" implementation="crm.LOOKUP"/>
    <serviceTask id="decideRoute" name="Decide approval route" implementation="dmn-connector.EXECUTE_TABLE"/>
    <exclusiveGateway id="manualReview" name="Manual review?" default="f_manualReview_autoApprove"/>
    <userTask id="reviewOrder" name="Review order" activiti:candidateGroups="managers">
      <documentation>A manager approves or rejects orders that the rules do not release automatically.</documentation>
    </userTask>
    <boundaryEvent id="reviewReminder" name="Remind after 24 h" attachedToRef="reviewOrder" cancelActivity="false">
      <timerEventDefinition><timeDuration>PT24H</timeDuration></timerEventDefinition>
    </boundaryEvent>
    <scriptTask id="sendReminder" name="Send reminder" scriptFormat="juel">
      <script>\${execution.setVariable('reminded', true)}</script>
    </scriptTask>
    <endEvent id="reminderSent" name="Reminder sent"/>
    <scriptTask id="autoApprove" name="Approve automatically" scriptFormat="juel">
      <script>\${execution.setVariable('approved', true)}</script>
    </scriptTask>
    <exclusiveGateway id="reviewDone"/>
    <exclusiveGateway id="approvedGateway" name="Approved?" default="f_approvedGateway_orderRejected"/>
    <serviceTask id="notifyWarehouse" name="Notify warehouse" implementation="http.GET"/>
    <endEvent id="orderReleased" name="Order released"/>
    <endEvent id="orderRejected" name="Order rejected"/>
    <sequenceFlow id="f_orderReceived_lookupCustomer" sourceRef="orderReceived" targetRef="lookupCustomer"/>
    <sequenceFlow id="f_lookupCustomer_decideRoute" sourceRef="lookupCustomer" targetRef="decideRoute"/>
    <sequenceFlow id="f_decideRoute_manualReview" sourceRef="decideRoute" targetRef="manualReview"/>
    <sequenceFlow id="f_manualReview_reviewOrder" name="manual" sourceRef="manualReview" targetRef="reviewOrder">
      <conditionExpression xsi:type="tFormalExpression">\${route == 'manual'}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f_manualReview_autoApprove" name="automatic" sourceRef="manualReview" targetRef="autoApprove"/>
    <sequenceFlow id="f_reviewOrder_reviewDone" sourceRef="reviewOrder" targetRef="reviewDone"/>
    <sequenceFlow id="f_autoApprove_reviewDone" sourceRef="autoApprove" targetRef="reviewDone"/>
    <sequenceFlow id="f_reviewDone_approvedGateway" sourceRef="reviewDone" targetRef="approvedGateway"/>
    <sequenceFlow id="f_approvedGateway_notifyWarehouse" name="approved" sourceRef="approvedGateway" targetRef="notifyWarehouse">
      <conditionExpression xsi:type="tFormalExpression">\${approved == true}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f_approvedGateway_orderRejected" name="rejected" sourceRef="approvedGateway" targetRef="orderRejected"/>
    <sequenceFlow id="f_notifyWarehouse_orderReleased" sourceRef="notifyWarehouse" targetRef="orderReleased"/>
    <sequenceFlow id="f_reviewReminder_sendReminder" sourceRef="reviewReminder" targetRef="sendReminder"/>
    <sequenceFlow id="f_sendReminder_reminderSent" sourceRef="sendReminder" targetRef="reminderSent"/>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_orderApproval">
    <bpmndi:BPMNPlane id="BPMNPlane_orderApproval" bpmnElement="orderApproval">
${shape('orderReceived', 40, 202, 36, 36)}
${shape('lookupCustomer', 110, 180, 100, 80)}
${shape('decideRoute', 250, 180, 100, 80)}
${shape('manualReview', 390, 195, 50, 50, ' isMarkerVisible="true"', [367, 169, 96, 14])}
${shape('reviewOrder', 510, 180, 100, 80)}
${shape('reviewReminder', 542, 162, 36, 36, '', [568, 146, 110, 14])}
${shape('sendReminder', 510, 40, 100, 80)}
${shape('reminderSent', 640, 62, 36, 36)}
${shape('autoApprove', 510, 340, 100, 80)}
${shape('reviewDone', 720, 195, 50, 50, ' isMarkerVisible="true"')}
${shape('approvedGateway', 810, 195, 50, 50, ' isMarkerVisible="true"', [805, 169, 60, 14])}
${shape('notifyWarehouse', 930, 180, 100, 80)}
${shape('orderReleased', 1075, 202, 36, 36)}
${shape('orderRejected', 817, 332, 36, 36)}
${edge('f_orderReceived_lookupCustomer', [[76, 220], [110, 220]])}
${edge('f_lookupCustomer_decideRoute', [[210, 220], [250, 220]])}
${edge('f_decideRoute_manualReview', [[350, 220], [390, 220]])}
${edge('f_manualReview_reviewOrder', [[440, 220], [510, 220]])}
${edge('f_manualReview_autoApprove', [[415, 245], [415, 380], [510, 380]])}
${edge('f_reviewOrder_reviewDone', [[610, 220], [720, 220]])}
${edge('f_autoApprove_reviewDone', [[610, 380], [745, 380], [745, 245]])}
${edge('f_reviewDone_approvedGateway', [[770, 220], [810, 220]])}
${edge('f_approvedGateway_notifyWarehouse', [[860, 220], [930, 220]])}
${edge('f_approvedGateway_orderRejected', [[835, 245], [835, 332]])}
${edge('f_notifyWarehouse_orderReleased', [[1030, 220], [1075, 220]])}
${edge('f_reviewReminder_sendReminder', [[560, 162], [560, 120]])}
${edge('f_sendReminder_reminderSent', [[610, 80], [640, 80]])}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;
}

const orderApprovalExtensions = () =>
  json({
    id: 'orderApproval-extensions',
    extensions: {
      orderApproval: {
        properties: {
          p1: { id: 'p1', name: 'orderId', type: 'string', required: true, description: 'Order number' },
          p2: { id: 'p2', name: 'customerId', type: 'string', required: true, description: 'Customer number, G-... for gold customers' },
          p3: { id: 'p3', name: 'amount', type: 'integer', value: 1200, description: 'Order value in euro' },
          p4: { id: 'p4', name: 'customerName', type: 'string' },
          p5: { id: 'p5', name: 'tier', type: 'string' },
          p6: { id: 'p6', name: 'route', type: 'string' },
          p7: { id: 'p7', name: 'approved', type: 'boolean' },
          p8: { id: 'p8', name: 'reminded', type: 'boolean' },
          p9: { id: 'p9', name: 'warehouseStatus', type: 'integer' },
        },
        mappings: {
          lookupCustomer: {
            inputs: { customerId: { type: 'VARIABLE', value: 'customerId' } },
            outputs: { customerName: { type: 'VARIABLE', value: 'customerName' }, tier: { type: 'VARIABLE', value: 'tier' } },
          },
          decideRoute: {
            inputs: { tier: { type: 'VARIABLE', value: 'tier' }, amount: { type: 'VARIABLE', value: 'amount' } },
            outputs: { route: { type: 'VARIABLE', value: 'route' } },
          },
          reviewOrder: { mappingType: 'MAP_ALL' },
          notifyWarehouse: {
            inputs: { url: { type: 'VALUE', value: 'https://warehouse.example.com/orders/${orderId}' } },
            outputs: { warehouseStatus: { type: 'VARIABLE', value: 'statusCode' } },
          },
        },
        constants: { decideRoute: { _activiti_dmn_table_: { value: 'approvalRoute' } } },
      },
    },
  });

const crmConnector = () =>
  json({
    id: 'crm',
    name: 'crm',
    description: 'Customer lookups (bean crm.LOOKUP)',
    actions: {
      LOOKUP: {
        id: 'LOOKUP',
        name: 'Look up a customer',
        description: 'Finds a customer by id',
        inputs: [{ id: 'customerId', name: 'customerId', type: 'string', required: true, description: 'Customer number' }],
        outputs: [
          { id: 'customerName', name: 'customerName', type: 'string' },
          { id: 'tier', name: 'tier', type: 'string', description: 'gold for numbers that start with G-' },
          { id: 'found', name: 'found', type: 'boolean' },
        ],
      },
    },
  });

const httpConnector = () =>
  json({
    id: 'http',
    name: 'http',
    description: 'HTTP calls (bean http.GET; the sample bean of the modeler server answers without touching the network)',
    actions: {
      GET: {
        id: 'GET',
        name: 'GET request',
        description: 'Calls a URL and returns the status code and the body',
        inputs: [
          { id: 'url', name: 'url', type: 'string', required: true, description: 'The address to call' },
          { id: 'status', name: 'status', type: 'integer', description: 'Status code the sample bean answers with' },
        ],
        outputs: [
          { id: 'statusCode', name: 'statusCode', type: 'integer' },
          { id: 'body', name: 'body', type: 'string' },
        ],
      },
    },
  });

function approvalRouteDmn() {
  const rule = (id, tier, amount, route) =>
    `      <rule id="approvalRoute_${id}">
        <inputEntry id="approvalRoute_${id}_in1"><text>${tier}</text></inputEntry>
        <inputEntry id="approvalRoute_${id}_in2"><text>${amount}</text></inputEntry>
        <outputEntry id="approvalRoute_${id}_out1"><text>"${route}"</text></outputEntry>
      </rule>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/"
             id="Definitions_approvalRoute" name="approval-route" namespace="http://activiti.org/schema/1.0/dmn/Definitions_approvalRoute">
  <inputData id="InputData_tier" name="tier">
    <variable id="InputData_tier_variable" name="tier" typeRef="string" />
  </inputData>
  <inputData id="InputData_amount" name="amount">
    <variable id="InputData_amount_variable" name="amount" typeRef="number" />
  </inputData>
  <decision id="approvalRoute" name="approvalRoute">
    <variable id="approvalRoute_variable" name="approvalRoute" typeRef="string" />
    <informationRequirement id="approvalRoute_req_InputData_tier">
      <requiredInput href="#InputData_tier" />
    </informationRequirement>
    <informationRequirement id="approvalRoute_req_InputData_amount">
      <requiredInput href="#InputData_amount" />
    </informationRequirement>
    <decisionTable id="approvalRoute_table" hitPolicy="FIRST">
      <input id="approvalRoute_input1" label="Customer tier">
        <inputExpression id="approvalRoute_inputExpression1" typeRef="string">
          <text>tier</text>
        </inputExpression>
      </input>
      <input id="approvalRoute_input2" label="Order amount">
        <inputExpression id="approvalRoute_inputExpression2" typeRef="number">
          <text>amount</text>
        </inputExpression>
      </input>
      <output id="approvalRoute_output1" name="route" label="Route" typeRef="string" />
${rule('goldSmall', '"gold"', '&lt; 5000', 'auto')}
${rule('anySmall', '-', '&lt; 500', 'auto')}
${rule('everythingElse', '-', '-', 'manual')}
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_approvalRoute" dmnElementRef="approvalRoute"><dc:Bounds height="80" width="180" x="160" y="100" /></dmndi:DMNShape>
      <dmndi:DMNShape id="DMNShape_InputData_tier" dmnElementRef="InputData_tier"><dc:Bounds height="45" width="125" x="120" y="300" /></dmndi:DMNShape>
      <dmndi:DMNShape id="DMNShape_InputData_amount" dmnElementRef="InputData_amount"><dc:Bounds height="45" width="125" x="270" y="300" /></dmndi:DMNShape>
      <dmndi:DMNEdge id="DMNEdge_tier" dmnElementRef="approvalRoute_req_InputData_tier"><di:waypoint x="182" y="300" /><di:waypoint x="215" y="180" /></dmndi:DMNEdge>
      <dmndi:DMNEdge id="DMNEdge_amount" dmnElementRef="approvalRoute_req_InputData_amount"><di:waypoint x="332" y="300" /><di:waypoint x="285" y="180" /></dmndi:DMNEdge>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

const passingScenarios = () =>
  json({
    $schema: '../../../schemas/scenario.schema.json',
    name: 'Order approval',
    users: { alice: ['clerks'], bob: ['managers'] },
    scenarios: [
      {
        name: 'a small order of a gold customer is released without a review',
        start: { process: 'orderApproval', user: 'alice', businessKey: 'O-1001', variables: { orderId: 'O-1001', customerId: 'G-100', amount: 1200 } },
        steps: [
          { expectConnectorCall: { activity: 'lookupCustomer', connector: 'crm.LOOKUP', count: 1, outbound: { tier: 'gold' }, partial: true } },
          { expectConnectorCall: { activity: 'notifyWarehouse', connector: 'http.GET', count: 1, inbound: { url: 'https://warehouse.example.com/orders/O-1001' }, partial: true } },
        ],
        expect: {
          state: 'COMPLETED',
          endEvents: ['orderReleased'],
          variables: { tier: 'gold', route: 'auto', approved: true, warehouseStatus: 200 },
          path: { contains: ['lookupCustomer', 'decideRoute', 'autoApprove', 'notifyWarehouse'], notContains: ['reviewOrder'] },
        },
      },
      {
        name: 'a large order waits for a manager and is released once approved',
        start: { process: 'orderApproval', user: 'alice', businessKey: 'O-1002', variables: { orderId: 'O-1002', customerId: 'C-200', amount: 7500 } },
        steps: [
          { expectTask: { activity: 'reviewOrder', name: 'Review order', candidateGroups: ['managers'], assignee: null } },
          { claim: { activity: 'reviewOrder', user: 'bob' } },
          { completeTask: { activity: 'reviewOrder', user: 'bob', variables: { approved: true } } },
        ],
        expect: { state: 'COMPLETED', endEvents: ['orderReleased'], variables: { route: 'manual', approved: true }, path: { contains: ['reviewOrder', 'notifyWarehouse'], notContains: ['autoApprove'] } },
      },
      {
        name: 'a rejected order is closed and the warehouse is not told',
        start: { process: 'orderApproval', user: 'alice', variables: { orderId: 'O-1003', customerId: 'C-300', amount: 900 } },
        steps: [{ completeTask: { activity: 'reviewOrder', user: 'bob', variables: { approved: false } } }],
        expect: { state: 'COMPLETED', endEvents: ['orderRejected'], absentVariables: ['warehouseStatus'], path: { notContains: ['notifyWarehouse'] } },
      },
    ],
    decisions: [
      { name: 'gold customer under 5000 is automatic', decision: 'approvalRoute', inputs: { tier: 'gold', amount: 1200 }, expect: { result: [{ route: 'auto' }], matchedRules: ['approvalRoute_goldSmall'] } },
      { name: 'standard customer over 500 is manual', decision: 'approvalRoute', inputs: { tier: 'standard', amount: 800 }, expect: { result: [{ route: 'manual' }], matchedRules: ['approvalRoute_everythingElse'] } },
    ],
  });

/** A regression file with two scenarios, the second one wrong on purpose: it shows the pass and fail marks of the report. */
const regressionScenarios = () =>
  json({
    $schema: '../../../schemas/scenario.schema.json',
    name: 'Order approval regression',
    users: { alice: ['clerks'], bob: ['managers'] },
    scenarios: [
      {
        name: 'a small order of a standard customer is released at once',
        start: { process: 'orderApproval', user: 'alice', variables: { orderId: 'R-1', customerId: 'C-1', amount: 450 } },
        steps: [
          { expectConnectorCall: { activity: 'lookupCustomer', connector: 'crm.LOOKUP', count: 1, outbound: { tier: { $exists: true } }, partial: true } },
          { expectConnectorCall: { activity: 'notifyWarehouse', connector: 'http.GET', count: 1 } },
        ],
        expect: { state: 'COMPLETED', endEvents: ['orderReleased'], variables: { route: 'auto' } },
      },
      {
        name: 'an 800 euro order of a standard customer is released at once',
        start: { process: 'orderApproval', user: 'alice', variables: { orderId: 'R-2', customerId: 'C-2', amount: 800 } },
        steps: [
          { expectConnectorCall: { activity: 'lookupCustomer', connector: 'crm.LOOKUP', count: 1 } },
          { expectConnectorCall: { activity: 'notifyWarehouse', connector: 'http.GET', count: 1 } },
          { expectConnectorCall: { activity: 'notifyWarehouse', connector: 'http.GET', inbound: { url: 'https://warehouse.example.com/orders/R-2' }, partial: true } },
        ],
        expect: { state: 'COMPLETED', endEvents: ['orderReleased'], variables: { route: 'auto' } },
      },
    ],
  });

/** The files of the order approval project, keyed by project path. */
function orderApprovalFiles() {
  return {
    'project.json': projectJson('order-approval'),
    'processes/order-approval.bpmn20.xml': orderApprovalBpmn(),
    'processes/order-approval-extensions.json': orderApprovalExtensions(),
    'processes/approval-route.dmn': approvalRouteDmn(),
    'connectors/crm.json': crmConnector(),
    'connectors/http.json': httpConnector(),
    'scenarios/order-approval.scenario.json': passingScenarios(),
    'scenarios/regression.scenario.json': regressionScenarios(),
  };
}

/** The files of a corpus project (its seed, its scenarios) with a project.json. */
function corpusFiles(id) {
  const dir = join(ROOT, 'corpus', id);
  const files = { 'project.json': projectJson(id) };
  const walk = (base, prefix) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const path = join(base, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = readFileSync(path, 'utf8');
    }
  };
  walk(join(dir, 'seed'), '');
  if (existsSync(join(dir, 'scenarios'))) walk(join(dir, 'scenarios'), 'scenarios/');
  return files;
}

function writeProject(root, name, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, name, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function zipOf(name, files) {
  const file = join(TMP, `${name}.zip`);
  writeFileSync(file, zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [p, strToU8(c)]))));
  return file;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// the server
// ---------------------------------------------------------------------------------------------------------------------------------------
function freePort() {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

function findJar() {
  const given = option('jar');
  if (given) return resolve(given);
  const target = join(ROOT, 'java', 'activiti-modeler-server', 'target');
  const jars = existsSync(target)
    ? readdirSync(target).filter((f) => /^activiti-modeler-server-.*-exec\.jar$/.test(f)).map((f) => join(target, f))
    : [];
  if (!jars.length) throw new Error('no server jar: run scripts/build-server.sh or pass --jar');
  return jars.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

let server;
async function startServer() {
  const jar = findJar();
  const port = await freePort();
  const javaHome = process.env.JAVA_HOME;
  const javaLocal = join(ROOT, '.tools', 'jdk-25', 'bin', 'java');
  const java = existsSync(javaLocal) ? javaLocal : javaHome ? join(javaHome, 'bin', 'java') : 'java';
  const out = join(TMP, 'server.log');
  const fd = (await import('node:fs')).openSync(out, 'w');
  server = spawn(java, ['-jar', jar, `--server.port=${port}`, `--workspace=${WORK}`, '--modeler.server.mail.port=0'], { stdio: ['ignore', fd, fd], cwd: TMP });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i += 1) {
    if (server.exitCode !== null) throw new Error(`the server stopped, see ${out}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) {
        log(`server up at ${url} (${jar})`);
        return url;
      }
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  throw new Error(`the server did not come up, see ${out}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((done) => {
    const timer = setTimeout(() => {
      server.kill('SIGKILL');
      done();
    }, 15000);
    server.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}

const auth = 'Basic ' + Buffer.from('modeler:modeler').toString('base64');
async function cleanEngine(url) {
  const list = await (await fetch(`${url}/api/deployments?size=200`, { headers: { Authorization: auth } })).json();
  for (const d of list.items ?? []) await fetch(`${url}/api/dev/deployments/${d.id}`, { method: 'DELETE', headers: { Authorization: auth } });
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// the browser
// ---------------------------------------------------------------------------------------------------------------------------------------
const VIEWPORT = { width: 1440, height: 900 };

const CURSOR_SCRIPT = `
  (() => {
    const make = () => {
      if (document.getElementById('__cursor')) return;
      const c = document.createElement('div');
      c.id = '__cursor';
      c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;left:0;top:0;transform:translate(-100px,-100px);';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7 13.5 L10 20 L12.5 19 L9.7 12.7 L15 12.5 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      const ring = document.createElement('div');
      ring.id = '__ring';
      ring.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:30px;height:30px;border-radius:50%;border:3px solid #2f6fed;left:0;top:0;opacity:0;transform:translate(-100px,-100px);';
      document.documentElement.appendChild(ring);
      addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
      addEventListener('mousedown', (e) => {
        ring.style.transition = 'none'; ring.style.opacity = '0.9';
        ring.style.transform = 'translate(' + (e.clientX - 15) + 'px,' + (e.clientY - 15) + 'px) scale(0.5)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          ring.style.transition = 'transform 350ms ease-out, opacity 350ms ease-out';
          ring.style.transform = 'translate(' + (e.clientX - 15) + 'px,' + (e.clientY - 15) + 'px) scale(1.3)';
          ring.style.opacity = '0';
        }));
      }, true);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
  })();
`;

let browser;
const live = { url: '' };

/** A fresh browser context and page on the app (the page is served by the modeler server). */
async function newSession({ scale = 2, video = false, cursor = false, viewport = VIEWPORT } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    ...(video ? { recordVideo: { dir: VIDEOS, size: VIEWPORT } } : {}),
  });
  if (cursor) await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  const t0 = Date.now();
  await page.goto(`${live.url}/`);
  await page.getByTestId('status-server').waitFor();
  return { context, page, problems, t0 };
}

async function importZip(page, file) {
  await page.setInputFiles('[data-testid=import-zip-input]', file);
  await page.getByTestId('project-name').waitFor();
  await page.waitForTimeout(800);
}

async function dismissToasts(page) {
  await page.evaluate(() => document.querySelectorAll('[data-testid=toasts]').forEach((n) => (n.style.display = 'none')));
}

const explorerFile = (page, name) => page.getByTestId('explorer').getByText(name, { exact: true });
async function openFile(page, name) {
  await explorerFile(page, name).dblclick();
  await page.waitForTimeout(700);
}

async function signIn(page) {
  await page.getByTestId('status-server').click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByTestId('connection-user').fill('modeler');
  await dialog.getByTestId('connection-password').fill('modeler');
  await dialog.getByTestId('connection-connect').click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('[data-testid=status-server]')?.getAttribute('data-status') === 'connected');
}

async function openServerProject(page, name) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Open server workspace…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Open server workspace' }).getByTestId('prompt-confirm').click();
  const projectDialog = page.getByRole('dialog', { name: 'Project on the server' });
  await projectDialog.getByTestId('prompt-input').fill(name);
  await projectDialog.getByTestId('prompt-confirm').click();
  await page.getByTestId('status-storage').filter({ hasText: name }).waitFor();
  await page.waitForTimeout(800);
}

async function runMenu(page, item) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Run', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
}

const active = (page) => page.locator('.editor-panel.active');

// ---------------------------------------------------------------------------------------------------------------------------------------
// output: PNGs shrunk to about 350 KB, GIFs through ffmpeg palettes
// ---------------------------------------------------------------------------------------------------------------------------------------
const shrinkScript = `
import sys, os
from PIL import Image
src, dst, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src).convert('RGB')
widths = [img.width, 2160, 1920, 1680, 1440]
for w in widths:
    if w > img.width: continue
    im = img if w == img.width else img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
    for colors in (None, 256, 128, 64):
        out = im if colors is None else im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        out.save(dst, optimize=True)
        if os.path.getsize(dst) <= limit:
            print(w, colors, os.path.getsize(dst)); sys.exit(0)
print('too big', os.path.getsize(dst)); sys.exit(1)
`;

function shrinkPng(raw, name) {
  const dst = join(OUT, `${name}.png`);
  const r = spawnSync('python3', ['-I', '-c', shrinkScript, raw, dst, String(350 * 1024)], { encoding: 'utf8' });
  log(`${name}.png`, r.stdout.trim(), r.stderr.trim());
  if (r.status !== 0) throw new Error(`could not shrink ${name}`);
}

async function still(page, name, problems = []) {
  await dismissToasts(page);
  await page.mouse.move(1430, 890); // park the pointer where it hides nothing
  await page.waitForTimeout(300);
  const raw = join(TMP, `${name}.raw.png`);
  await page.screenshot({ path: raw });
  if (problems.length) log(`console problems while taking ${name}:`, problems.slice(0, 3));
  shrinkPng(raw, name);
}

/**
 * Converts the recorded video to a GIF: starts `startMs` into the video, lasts `durationMs`, 1200 px wide, 10 fps, one palette for the whole
 * clip. The video codec leaves noise in flat areas, which makes a GIF large; a light denoise before the palette keeps it under 3 MB.
 */
function makeGif(videoPath, name, startMs, durationMs, { fps = 10, width = 1200, speed = 1 } = {}) {
  const palette = join(TMP, `${name}-palette.png`);
  const gif = join(OUT, `${name}.gif`);
  const common = ['-y', '-ss', (startMs / 1000).toFixed(2), '-t', (durationMs / 1000).toFixed(2), '-i', videoPath];
  const attempts = [
    { denoise: 'hqdn3d=8:8:10:10', colors: 96 },
    { denoise: 'hqdn3d=12:12:14:14', colors: 64 },
    { denoise: 'hqdn3d=16:16:18:18', colors: 48 },
  ];
  for (const { denoise, colors } of attempts) {
    const filters = `${speed === 1 ? '' : `setpts=PTS/${speed},`}fps=${fps},scale=${width}:-1:flags=lanczos,${denoise}`;
    let r = spawnSync('ffmpeg', [...common, '-vf', `${filters},palettegen=stats_mode=diff:max_colors=${colors}`, palette], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg palettegen failed: ${r.stderr.slice(-400)}`);
    r = spawnSync('ffmpeg', [...common, '-i', palette, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`, gif], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg paletteuse failed: ${r.stderr.slice(-400)}`);
    if (statSync(gif).size < 2.9 * 1024 * 1024) break;
  }
  const size = statSync(gif).size;
  log(`${name}.gif ${(size / 1024).toFixed(0)} KB, ${(durationMs / 1000 / speed).toFixed(1)} s${size > 3 * 1024 * 1024 ? '  TOO BIG' : ''}`);
}

/** Closes the context (which finishes the video) and returns the path of the recording. */
async function finishVideo(session) {
  const video = session.page.video();
  await session.context.close();
  return video.path();
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// smooth pointer for the GIFs
// ---------------------------------------------------------------------------------------------------------------------------------------
let pointer = { x: 700, y: 450 };
async function moveTo(page, x, y, steps = 12) {
  await page.mouse.move(x, y, { steps });
  pointer = { x, y };
}
async function glide(page, locator, { dx = 0, dy = 0, steps = 12 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box to point at');
  await moveTo(page, box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, steps);
}
async function pointAndClick(page, locator, opts = {}) {
  await glide(page, locator, opts);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// captures
// ---------------------------------------------------------------------------------------------------------------------------------------
const captures = [];
const capture = (names, fn) => captures.push({ names, fn });


async function viewToggle(page, item) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitemcheckbox', { name: item, exact: true }).click();
  await page.waitForTimeout(500);
}

/** Screen box of everything drawn in the visible diagram (shapes and flows, not the overlays). */
const diagramBox = (page) =>
  active(page).locator('.djs-container > svg').first().evaluate((svg) => {
    const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const el of svg.querySelectorAll('.djs-shape .djs-visual, .djs-connection .djs-visual')) {
      const r = el.getBoundingClientRect();
      box.left = Math.min(box.left, r.left); box.right = Math.max(box.right, r.right);
      box.top = Math.min(box.top, r.top); box.bottom = Math.max(box.bottom, r.bottom);
    }
    return box;
  });

/**
 * Fits the diagram of the visible tab, then moves it (wheel pans, Ctrl+wheel zooms) so that all of it lies right of the palette and left
 * of the minimap button: the palette hides nothing.
 */
async function fitDiagram(page, { left = 120, right = 1100 } = {}) {
  await page.waitForTimeout(800); // the canvas has its final size
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(500);
  const canvas = await active(page).locator('.djs-container').boundingBox();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  await page.mouse.move(cx, cy);
  const avail = right - left;
  // synthetic wheel events: diagram-js zooms on Ctrl+wheel and pans on plain wheel
  const wheelZoom = async (delta) => {
    await active(page).locator('.djs-container').evaluate((el, [d, x, y]) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: d, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, [delta, cx, cy]);
    await page.waitForTimeout(250);
  };
  const widthOf = async () => {
    const b = await diagramBox(page);
    return b.right - b.left;
  };
  const w0 = await widthOf();
  await wheelZoom(10); // calibrate: how much one wheel unit scales
  const w1 = await widthOf();
  const k = -Math.log(w1 / w0) / 10;
  log('fit zoom', Math.round(w0), Math.round(w1), k, avail);
  for (let round = 0; k > 0 && round < 10; round += 1) {
    const w = await widthOf();
    if (Math.abs(w - avail * 0.97) < 8) break;
    await wheelZoom(Math.max(-150, Math.min(150, -Math.log((avail * 0.97) / w) / k)));
  }
  for (let i = 0; i < 6; i += 1) {
    const b = await diagramBox(page);
    const shift = left - b.left;
    if (Math.abs(shift) < 4) break;
    await page.mouse.wheel(-shift, 0);
    await page.waitForTimeout(200);
  }
  // centre vertically in the visible canvas
  const b = await diagramBox(page);
  await page.mouse.wheel(0, (b.top + b.bottom) / 2 - cy);
  await page.waitForTimeout(300);
}

const clickElement = (page, id) => active(page).locator(`.djs-element[data-element-id="${id}"]`).click({ force: true });

capture(['bpmn-editor'], async () => {
  const { context, page, problems } = await newSession();
  await importZip(page, zipOf('order-approval', orderApprovalFiles()));
  await openFile(page, 'order-approval.bpmn20.xml');
  await viewToggle(page, 'Project explorer');
  await fitDiagram(page);
  await clickElement(page, 'reviewOrder');
  await page.waitForTimeout(500);
  await still(page, 'bpmn-editor', problems);
  await context.close();
});


/** A project zip with only some files of a corpus project (a clean status bar: the lint of the other files is not on the screen). */
function corpusZip(name, id, wantedPaths) {
  const all = corpusFiles(id);
  const files = { 'project.json': projectJson(name) };
  for (const path of wantedPaths) {
    if (!(path in all)) throw new Error(`${id} has no ${path}`);
    files[path] = all[path];
  }
  return zipOf(name, files);
}

async function openProblemsPanel(page, growBy = 8) {
  if (!(await page.getByTestId('problems-tab').isVisible())) await page.keyboard.press('Control+B');
  await page.getByTestId('problems-tab').click();
  await page.getByTestId('problems-panel').waitFor();
  // the separator above the panel grows it with the arrow keys (16 px each)
  await page.getByTestId('resize-bottom').focus();
  for (let i = 0; i < growBy; i += 1) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
}

capture(['problems-panel'], async () => {
  const { context, page, problems } = await newSession();
  const file = 'camunda-modeler.bpmn20.xml';
  await importZip(page, zipOf('camunda-import', { 'project.json': projectJson('camunda-import'), [`processes/${file}`]: readFileSync(join(ROOT, 'corpus', 'N01-negative', 'models', file), 'utf8') }));
  await openFile(page, file);
  await viewToggle(page, 'Project explorer');
  await openProblemsPanel(page, 8);
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(600);
  await still(page, 'problems-panel', problems);
  await context.close();
});

capture(['dmn-decision-table'], async () => {
  const { context, page, problems } = await newSession();
  await importZip(page, corpusZip('hit-policies', 'C16-dmn-hit-policies', ['processes/priority-two-outputs.dmn', 'processes/unique-grade.dmn', 'processes/collect-sum-points.dmn', 'processes/first-tier.dmn']));
  await openFile(page, 'priority-two-outputs.dmn');
  await active(page).getByTestId('dmn-view-priorityTwoOutputs').click();
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(800);
  await still(page, 'dmn-decision-table', problems);
  await context.close();
});

capture(['dmn-drd'], async () => {
  const { context, page, problems } = await newSession();
  await importZip(page, corpusZip('loan-decision', 'C17-dmn-drd', ['processes/loan-decision.dmn']));
  await openFile(page, 'loan-decision.dmn');
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(800);
  await still(page, 'dmn-drd', problems);
  await context.close();
});

// --- against the server ---------------------------------------------------------------------------------------------------------------

/** A session that is signed in to the server and has the server project `order-approval` open. */
async function serverSession(options = {}) {
  const session = await newSession(options);
  await signIn(session.page);
  await openServerProject(session.page, 'order-approval');
  await openFile(session.page, 'project.json'); // a text editor under the run view: no diagram controls show through it
  return session;
}

async function deployProject(page) {
  await runMenu(page, 'Deploy project');
  const result = page.getByTestId('deploy-result');
  const choice = page.getByTestId('choice-dialog');
  await result.or(choice).waitFor({ timeout: 60000 });
  if (await choice.isVisible()) await choice.getByRole('button', { name: 'Deploy anyway' }).click();
  await result.waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
}

const valueRow = (page, name) => page.getByTestId(`start-variables-row-${name}`).getByLabel(/Value of variable/);

async function startOrder(page, { orderId, customerId, amount }) {
  await page.getByTestId('deploy-start-orderApproval').click();
  await page.getByTestId('start-tab').waitFor();
  await valueRow(page, 'orderId').fill(orderId);
  await valueRow(page, 'customerId').fill(customerId);
  await valueRow(page, 'amount').fill(String(amount));
  await page.getByTestId('start-button').click();
  await page.getByTestId('instance-view').waitFor();
  await page.getByTestId('instance-diagram-canvas').and(page.locator('[data-loaded="true"]')).waitFor();
  await page.waitForTimeout(1500);
}

capture(['deploy-result'], async () => {
  const { context, page, problems } = await serverSession();
  await openFile(page, 'approval-route.dmn'); // a DMN editor under the run view: the deploy tab has no diagram of its own, the editor's bpmn.io watermark stays visible
  await page.keyboard.press('Control+P');
  await deployProject(page);
  await page.waitForTimeout(800);
  await still(page, 'deploy-result', problems);
  await context.close();
});

capture(['instance-view'], async () => {
  const { context, page, problems } = await serverSession();
  await page.keyboard.press('Control+P');
  await viewToggle(page, 'Project explorer');
  await deployProject(page);
  await startOrder(page, { orderId: 'O-2417', customerId: 'C-200', amount: 7500 });
  await page.getByTestId('instance-view').getByRole('button', { name: 'Fit' }).click();
  await page.getByRole('tab', { name: /^Variables/ }).click();
  await page.waitForTimeout(800);
  await still(page, 'instance-view', problems);
  await context.close();
});

capture(['decision-tester'], async () => {
  const { context, page, problems } = await serverSession();
  await openFile(page, 'approval-route.dmn');
  await active(page).getByTestId('dmn-view-approvalRoute').click();
  await page.keyboard.press('Control+P');
  await active(page).getByTestId('dmn-test-decision').click();
  await page.getByTestId('decision-tester').waitFor();
  await page.getByTestId('tester-input-tier').fill('standard');
  await page.getByTestId('tester-input-amount').fill('300');
  await page.getByTestId('tester-evaluate').click();
  await page.getByTestId('tester-matched').waitFor();
  await page.waitForTimeout(600);
  await still(page, 'decision-tester', problems);
  await context.close();
});

capture(['scenario-report'], async () => {
  const { context, page, problems } = await serverSession();
  await page.keyboard.press('Control+P');
  await viewToggle(page, 'Project explorer');
  await runMenu(page, 'Scenarios');
  await page.getByTestId('scenario-run-regression.scenario.json').click();
  await page.getByTestId('scenario-summary').waitFor({ timeout: 60000 });
  await page.getByTestId('scenario-result-a small order of a standard customer is released at once').getByRole('button').first().click();
  await page.getByTestId('scenario-diagram-canvas').and(page.locator('[data-loaded="true"]')).waitFor();
  await page.getByTestId('scenario-diagram').getByRole('button', { name: 'Fit' }).click();
  await page.waitForTimeout(1500);
  await still(page, 'scenario-report', problems);
  await context.close();
});

capture(['element-templates'], async () => {
  const { context, page, problems } = await newSession();
  await importZip(page, zipOf('order-approval', orderApprovalFiles()));
  await openFile(page, 'order-approval.bpmn20.xml');
  await viewToggle(page, 'Project explorer');
  await fitDiagram(page);
  await clickElement(page, 'notifyWarehouse');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Apply template/ }).first().click();
  await page.waitForTimeout(800);
  await page.mouse.move(700, 480); // the list of the chooser: the connector templates are below the built-in kinds
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(600);
  await still(page, 'element-templates', problems);
  await context.close();
});

const stackScript = `
import sys
from PIL import Image
out, top, bottom, crop_top, crop_strip_bottom = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
a, b = Image.open(top).convert('RGB'), Image.open(bottom).convert('RGB')
a = a.crop((0, 0, a.width, a.height - crop_strip_bottom))  # the status bar of the strip
b = b.crop((0, crop_top, b.width, b.height))               # menu bar and tab of the text view
im = Image.new('RGB', (a.width, a.height + b.height), (255, 255, 255))
im.paste(a, (0, 0)); im.paste(b, (0, a.height))
im.save(out)
`;

/**
 * The XML and Extensions JSON views are text editors: there is no diagram in them, so no bpmn.io watermark. The still therefore shows the
 * diagram of the same process (watermark visible) in a strip on top and the text view below, two real screenshots joined into one image.
 */
capture(['extensions-json', 'xml-view'], async () => {
  const files = orderApprovalFiles();
  const grab = async (viewport, prepare, name) => {
    const { context, page } = await newSession({ viewport });
    await importZip(page, zipOf('order-approval', files));
    await openFile(page, 'order-approval.bpmn20.xml');
    await viewToggle(page, 'Project explorer');
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(600);
    await prepare(page);
    await dismissToasts(page);
    await page.mouse.move(1435, 5);
    await page.waitForTimeout(300);
    const raw = join(TMP, `${name}.raw.png`);
    await page.screenshot({ path: raw });
    await context.close();
    return raw;
  };
  const strip = await grab({ width: 1440, height: 520 }, async (page) => {
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(800);
    await page.locator('.editor-panel.active .djs-container').evaluate((el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 25, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);
  }, 'strip');
  const mappingsLine = orderApprovalExtensions().split('\n').findIndex((l) => l.includes('"mappings"'));
  const views = {
    'xml-view': async (page) => {
      await page.getByRole('tab', { name: 'XML', exact: true }).click();
      await page.getByTestId('xml-view').waitFor();
    },
    'extensions-json': async (page) => {
      await page.getByRole('tab', { name: 'Extensions JSON', exact: true }).click();
      await page.getByTestId('json-view').waitFor();
      await page.locator('.cm-scroller').first().evaluate((el, line) => {
        const h = el.querySelector('.cm-line').getBoundingClientRect().height;
        el.scrollTop = Math.max(0, (line - 2) * h);
      }, mappingsLine);
      await page.waitForTimeout(400);
    },
  };
  for (const [name, prepare] of Object.entries(views)) {
    if (!wanted(name)) continue;
    const code = await grab({ width: 1440, height: 720 }, prepare, name);
    const joined = join(TMP, `${name}.joined.png`);
    const r = spawnSync('python3', ['-I', '-c', stackScript, joined, strip, code, String(68 * 2), String(25 * 2)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    shrinkPng(joined, name);
  }
});

// --- GIFs ----------------------------------------------------------------------------------------------------------------------------

/** A project with an unfinished process: a start event and one task, no end event (the lint complains until the model is finished). */
function claimsFiles() {
  const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_claimHandling" targetNamespace="http://activiti.org/bpmn/showcase">
  <process id="claimHandling" name="Claim handling" isExecutable="true">
    <startEvent id="claimReceived" name="Claim received"/>
    <scriptTask id="registerClaim" name="Register claim" scriptFormat="juel">
      <script>\${execution.setVariable('registered', true)}</script>
    </scriptTask>
    <sequenceFlow id="f_claimReceived_registerClaim" sourceRef="claimReceived" targetRef="registerClaim"/>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_claimHandling">
    <bpmndi:BPMNPlane id="BPMNPlane_claimHandling" bpmnElement="claimHandling">
      <bpmndi:BPMNShape id="claimReceived_di" bpmnElement="claimReceived"><dc:Bounds x="152" y="262" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="registerClaim_di" bpmnElement="registerClaim"><dc:Bounds x="240" y="240" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f_claimReceived_registerClaim_di" bpmnElement="f_claimReceived_registerClaim"><di:waypoint x="188" y="280"/><di:waypoint x="240" y="280"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;
  const extensions = json({ id: 'claimHandling-extensions', extensions: { claimHandling: { properties: { p1: { id: 'p1', name: 'registered', type: 'boolean' } } } } });
  return { 'project.json': projectJson('claims'), 'processes/claim-handling.bpmn20.xml': bpmn, 'processes/claim-handling-extensions.json': extensions };
}

function videoSeconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number.parseFloat(r.stdout);
}

/**
 * Runs `script(page)` in a session that records a video and shows a pointer, and turns the part from the start of `script` to its end (plus
 * a short hold) into a GIF. `prepare(page)` runs before and is cut off. The video clock is aligned at the end: the file is closed right
 * after the hold, so the GIF starts at (video length - script time).
 */
async function recordGif(name, prepare, script, { hold = 1500, tail = 0 } = {}) {
  const session = await newSession({ scale: 1, video: true, cursor: true });
  const { page, context } = session;
  await prepare(page);
  await dismissToasts(page);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await script(page);
  await page.waitForTimeout(hold);
  const lengthMs = Date.now() - t0;
  const video = page.video();
  await context.close();
  const path = await video.path();
  const total = videoSeconds(path);
  const startMs = Math.max(0, total * 1000 - lengthMs - 150);
  makeGif(path, name, startMs, lengthMs + 150 - tail);
}

const typeSlowly = (page, text) => page.keyboard.type(text, { delay: 45 });

capture(['modeling'], async () => {
  await recordGif(
    'modeling',
    async (page) => {
      await importZip(page, zipOf('claims', claimsFiles()));
      await openFile(page, 'claim-handling.bpmn20.xml');
      await viewToggle(page, 'Project explorer');
      await page.waitForTimeout(600);
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+=');
      await page.waitForTimeout(500);
    },
    async (page) => {
      const el = (id) => active(page).locator(`.djs-element[data-element-id="${id}"]`);
      const pad = (action) => page.locator(`.djs-context-pad .entry[data-action="${action}"]`);
      await page.waitForTimeout(700); // the lint badge: the model is not finished
      await pointAndClick(page, el('registerClaim'));
      await page.waitForTimeout(300);
      await pointAndClick(page, pad('append.append-task'));
      await page.waitForTimeout(300);
      await typeSlowly(page, 'Approve claim');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await pointAndClick(page, pad('replace'));
      await page.waitForTimeout(300);
      await pointAndClick(page, page.locator('.djs-popup .entry', { hasText: /^User task$/ }));
      await page.waitForTimeout(300);
      await pointAndClick(page, page.locator('[data-entry-id="user.assignee"] .cm-content'));
      await typeSlowly(page, 'alice');
      await page.waitForTimeout(300);
      await pointAndClick(page, pad('append.end-event'));
      await page.waitForTimeout(300);
      await typeSlowly(page, 'Claim closed');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await moveTo(page, 700, 560, 12);
    },
    { hold: 1300 },
  );
});

async function pointAndDblClick(page, locator) {
  await glide(page, locator);
  await page.waitForTimeout(120);
  await page.mouse.dblclick(pointer.x, pointer.y);
  await page.waitForTimeout(300);
}

const menuItem = (page, menu, item) => async () => {
  await pointAndClick(page, page.getByRole('menubar').getByRole('menuitem', { name: menu, exact: true }));
  await pointAndClick(page, page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }));
};

async function serverSessionForGif() {
  const session = await newSession({ scale: 1, video: true, cursor: true });
  await signIn(session.page);
  await openServerProject(session.page, 'order-approval');
  await openFile(session.page, 'approval-route.dmn'); // a DMN editor under the run view keeps the bpmn.io watermark on screen in every frame
  return session;
}

/** Like recordGif, for a session that is already open (the video starts when the session was created). */
async function finishGif(name, session, startedAt, hold, gifOptions = {}) {
  const { page, context } = session;
  await page.waitForTimeout(hold);
  const lengthMs = Date.now() - startedAt;
  const video = page.video();
  await context.close();
  const path = await video.path();
  const total = videoSeconds(path);
  makeGif(path, name, Math.max(0, total * 1000 - lengthMs - 150), lengthMs + 150, gifOptions);
}

capture(['deploy-run'], async () => {
  const session = await serverSessionForGif();
  const { page } = session;
  await page.keyboard.press('Control+P');
  await viewToggle(page, 'Project explorer');
  await dismissToasts(page);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await menuItem(page, 'Run', 'Deploy project')();
  await page.getByTestId('deploy-result').waitFor({ timeout: 60000 });
  await dismissToasts(page);
  await page.waitForTimeout(1000);
  await pointAndClick(page, page.getByTestId('deploy-start-orderApproval').first());
  await valueRow(page, 'orderId').waitFor();
  const type = async (name, text) => {
    await pointAndClick(page, valueRow(page, name));
    await page.keyboard.press('Control+A');
    await typeSlowly(page, text);
  };
  await type('orderId', 'O-2417');
  await type('customerId', 'C-200');
  await pointAndClick(page, page.getByTestId('start-button'));
  await page.getByTestId('instance-view').waitFor();
  await page.getByTestId('instance-diagram-canvas').and(page.locator('[data-loaded="true"]')).waitFor();
  await page.getByTestId('task-claim').waitFor();
  await page.waitForTimeout(900);
  await pointAndClick(page, page.getByTestId('task-complete')); // completing claims the task for the user first
  await pointAndClick(page, page.getByTestId('complete-variables-add'));
  await pointAndClick(page, page.getByTestId('complete-variables-name-0'));
  await typeSlowly(page, 'approved');
  await page.getByTestId('complete-variables-type-0').selectOption('boolean');
  await pointAndClick(page, page.getByTestId('complete-variables-value-0'));
  await typeSlowly(page, 'true');
  await pointAndClick(page, page.getByTestId('task-complete-confirm'));
  await page.getByTestId('instance-state').filter({ hasText: /COMPLETED/i }).waitFor({ timeout: 20000 }).catch(() => undefined);
  await moveTo(page, 760, 700, 10);
  await finishGif('deploy-run', session, t0, 1800, { speed: 1.7 }); // the typing and the deployment are shown 1.7 times faster
});

capture(['token-simulation'], async () => {
  const session = await newSession({ scale: 1, video: true, cursor: true });
  const { page } = session;
  await importZip(page, zipOf('order-approval', orderApprovalFiles()));
  await openFile(page, 'order-approval.bpmn20.xml');
  await viewToggle(page, 'Project explorer');
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(600);
  await dismissToasts(page);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await page.waitForTimeout(600);
  await pointAndClick(page, active(page).getByTestId('simulate-toggle'));
  const pane = active(page).getByTestId('simulation-pane');
  await pane.waitFor();
  await page.waitForTimeout(900);
  await pointAndClick(page, pane.locator('.bts-context-pad').first());
  await moveTo(page, 700, 760, 10);
  await pane.locator('.bts-notification', { hasText: 'Finished' }).waitFor({ timeout: 30000 }).catch(() => undefined);
  await finishGif('token-simulation', session, t0, 2000);
});

capture(['scenario-run'], async () => {
  const session = await serverSessionForGif();
  const { page } = session;
  await page.keyboard.press('Control+P');
  await dismissToasts(page);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await menuItem(page, 'Run', 'Scenarios')();
  await page.waitForTimeout(600);
  await pointAndClick(page, page.getByTestId('scenario-run-order-approval.scenario.json'));
  await page.getByTestId('scenarios-tab').getByTestId('scenario-summary').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1300);
  await pointAndClick(page, page.getByTestId('scenarios-tab').getByTestId('scenario-result-a large order waits for a manager and is released once approved').getByRole('button').first());
  await page.getByTestId('scenarios-tab').getByTestId('scenario-diagram-canvas').and(page.locator('[data-loaded="true"]')).waitFor();
  await moveTo(page, 760, 760, 10);
  await finishGif('scenario-run', session, t0, 3000);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
async function main() {
  if (option('dump-projects')) {
    writeProject(resolve(option('dump-projects')), 'order-approval', orderApprovalFiles());
    return;
  }
  writeProject(WORK, 'order-approval', orderApprovalFiles());
  writeProject(WORK, 'C16-dmn-hit-policies', corpusFiles('C16-dmn-hit-policies'));
  live.url = await startServer();
  browser = await chromium.launch();
  const failures = [];
  try {
    for (const c of captures) {
      if (!c.names.some(wanted)) continue;
      await cleanEngine(live.url);
      try {
        log('capturing', c.names.join(', '));
        await c.fn();
      } catch (e) {
        failures.push(`${c.names.join(', ')}: ${e.stack ?? e}`);
        console.error('[showcase] FAILED', c.names.join(', '), e);
      }
    }
  } finally {
    await browser.close();
    await stopServer();
    if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`\n${failures.length} capture(s) failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
}

await main();
