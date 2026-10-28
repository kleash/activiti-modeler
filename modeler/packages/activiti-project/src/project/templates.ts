/**
 * New-from-template file contents (feature U2). Every BPMN a template creates passes the ADR 0003 serializer checks
 * (`verifyBpmnXml`, tested), every extensions file is written with `serializeExtensions`, and process, decision and
 * connector ids are unique within the project so that a project built from several templates deploys.
 */
import { type ExtensionsFile, serializeExtensions } from '../extensions';
import { basename, joinPath, splitName } from './paths';

export type TemplateId =
  | 'empty-process'
  | 'user-task-approval'
  | 'connector-call'
  | 'decision-task'
  | 'dmn-decision-table'
  | 'dmn-drd'
  | 'scenario'
  | 'connector-definition';

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  description: string;
  /** Folder the main file goes to. */
  folder: 'processes' | 'scenarios' | 'connectors';
  /** Suffix of the main file (`name` + suffix). */
  suffix: string;
  defaultName: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'empty-process', label: 'Empty process', description: 'An executable process with a start event', folder: 'processes', suffix: '.bpmn20.xml', defaultName: 'process' },
  { id: 'user-task-approval', label: 'User task approval', description: 'Start, user task for a group, approved? gateway, two end events', folder: 'processes', suffix: '.bpmn20.xml', defaultName: 'approval' },
  { id: 'connector-call', label: 'Connector call', description: 'A service task that calls a connector action with input and output mappings (adds a connector definition)', folder: 'processes', suffix: '.bpmn20.xml', defaultName: 'notify' },
  { id: 'decision-task', label: 'Decision task', description: 'A service task that evaluates a DMN decision table through dmn-connector.EXECUTE_TABLE (adds the DMN file)', folder: 'processes', suffix: '.bpmn20.xml', defaultName: 'decide' },
  { id: 'dmn-decision-table', label: 'DMN decision table', description: 'One decision with a UNIQUE decision table', folder: 'processes', suffix: '.dmn', defaultName: 'decision' },
  { id: 'dmn-drd', label: 'DMN DRD', description: 'Two decisions and two input data elements in a decision requirements diagram', folder: 'processes', suffix: '.dmn', defaultName: 'drd' },
  { id: 'scenario', label: 'Scenario file', description: 'A test scenario that starts a process and expects it to complete', folder: 'scenarios', suffix: '.scenario.json', defaultName: 'happy-path' },
  { id: 'connector-definition', label: 'Connector definition', description: 'A connector descriptor with one action', folder: 'connectors', suffix: '.json', defaultName: 'mailer' },
];

export interface TemplateFile {
  path: string;
  content: string;
}

export interface TemplateContext {
  /** Name typed by the user (a base name or a name with the file suffix). */
  name: string;
  /** Existing project file paths. */
  paths: Iterable<string>;
  /** Ids of the processes already in the project (read from the BPMN files by the caller). */
  processIds?: Iterable<string>;
  /** Ids of the DMN decisions already in the project. */
  decisionIds?: Iterable<string>;
  /** For the scenario template: the process key to start. */
  processKey?: string;
}

export interface TemplateResult {
  /** Main file first; the files after it are companions (extensions JSON, DMN, connector definition) that did not exist yet. */
  files: TemplateFile[];
}

const NAME_CHARS = /[^A-Za-z0-9._-]+/g;

/** Base file name from what the user typed: letters, digits, `.`, `_`, `-`; known suffixes are removed. */
export function fileBaseName(input: string): string {
  let name = basename(input.trim());
  for (const suffix of ['.bpmn20.xml', '.scenario.json', '.bpmn', '.dmn', '.json']) {
    if (name.toLowerCase().endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  name = name.replace(NAME_CHARS, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/[-.]+$/, '');
  return name || 'untitled';
}

/** A valid XML id (NCName) from free text; the same text always gives the same id. */
export function toIdentifier(input: string): string {
  const id = input.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[^A-Za-z_]+/, (m) => `p_${m.replace(/[^A-Za-z0-9_.-]/g, '')}`).replace(/\.+/g, '_');
  return id || 'process';
}

/** `candidate` if it is free, otherwise `candidate_2`, `candidate_3`, ... (`from` = 1 numbers the first one too: `Process_1`). */
function unique(candidate: string, taken: Set<string>, from = 0): string {
  if (from === 0) {
    if (!taken.has(candidate)) return candidate;
    from = 2;
  }
  for (let n = from; ; n += 1) if (!taken.has(`${candidate}_${n}`)) return `${candidate}_${n}`;
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Element text: quotes need no escaping, and FEEL entries are full of them. */
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- BPMN ---------------------------------------------------------------------------------------------------------

interface Node {
  id: string;
  type: 'startEvent' | 'endEvent' | 'userTask' | 'serviceTask' | 'exclusiveGateway';
  name?: string;
  x: number;
  y: number;
  attrs?: Record<string, string>;
}

interface Flow {
  id: string;
  from: string;
  to: string;
  name?: string;
  condition?: string;
  /** Where the flow leaves the source: right (default), bottom or top. */
  exit?: 'right' | 'bottom' | 'top';
}

const SIZE: Record<Node['type'], { w: number; h: number }> = {
  startEvent: { w: 36, h: 36 },
  endEvent: { w: 36, h: 36 },
  userTask: { w: 100, h: 80 },
  serviceTask: { w: 100, h: 80 },
  exclusiveGateway: { w: 50, h: 50 },
};

function bpmnDocument(processId: string, processName: string | undefined, nodes: Node[], flows: Flow[], defaults: Record<string, string> = {}): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const box = (n: Node) => ({ ...SIZE[n.type], x: n.x, y: n.y });
  const processXml: string[] = [];
  for (const n of nodes) {
    const attrs = { ...(n.attrs ?? {}) };
    if (defaults[n.id]) attrs['default'] = defaults[n.id]!;
    const attrText = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
    processXml.push(`    <bpmn:${n.type} id="${n.id}"${n.name ? ` name="${escapeXml(n.name)}"` : ''}${attrText} />`);
  }
  for (const f of flows) {
    const head = `    <bpmn:sequenceFlow id="${f.id}"${f.name ? ` name="${escapeXml(f.name)}"` : ''} sourceRef="${f.from}" targetRef="${f.to}"`;
    processXml.push(
      f.condition
        ? `${head}>\n      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escapeText(f.condition)}</bpmn:conditionExpression>\n    </bpmn:sequenceFlow>`
        : `${head} />`,
    );
  }
  const di: string[] = [];
  for (const n of nodes) {
    const b = box(n);
    di.push(`      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.type === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`);
  }
  for (const f of flows) {
    const s = box(byId.get(f.from)!);
    const t = box(byId.get(f.to)!);
    const sMid = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    const tMid = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    const points =
      f.exit === 'bottom'
        ? [{ x: sMid.x, y: s.y + s.h }, { x: sMid.x, y: tMid.y }, { x: t.x, y: tMid.y }]
        : f.exit === 'top'
          ? [{ x: sMid.x, y: s.y }, { x: sMid.x, y: tMid.y }, { x: t.x, y: tMid.y }]
          : [{ x: s.x + s.w, y: sMid.y }, { x: t.x, y: tMid.y }];
    const waypoints = points.map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n');
    di.push(`      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">\n${waypoints}\n      </bpmndi:BPMNEdge>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_${processId}" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="${processId}"${processName ? ` name="${escapeXml(processName)}"` : ''} isExecutable="true">
${processXml.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${processId}">
    <bpmndi:BPMNPlane id="BPMNPlane_${processId}" bpmnElement="${processId}">
${di.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

function extensionsDocument(base: string, processId: string, extension: ExtensionsFile['extensions'][string]): string {
  return serializeExtensions({ id: `process-${base}`, extensions: { [processId]: extension } });
}

const property = (id: string, name: string, type: string) => ({ id, name, type, required: false });

// --- DMN ----------------------------------------------------------------------------------------------------------

const DMN_HEAD = (id: string, name: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="${id}" name="${escapeXml(name)}" namespace="http://activiti.org/schema/1.0/dmn/${id}">`;

function inputData(name: string, type: string): string {
  return `  <inputData id="InputData_${name}" name="${name}">\n    <variable id="InputData_${name}_variable" name="${name}" typeRef="${type}" />\n  </inputData>`;
}

const shape = (ref: string, x: number, y: number, w: number, h: number): string =>
  `      <dmndi:DMNShape id="DMNShape_${ref}" dmnElementRef="${ref}">\n        <dc:Bounds height="${h}" width="${w}" x="${x}" y="${y}" />\n      </dmndi:DMNShape>`;

const edge = (ref: string, from: [number, number], to: [number, number]): string =>
  `      <dmndi:DMNEdge id="DMNEdge_${ref}" dmnElementRef="${ref}">\n        <di:waypoint x="${from[0]}" y="${from[1]}" />\n        <di:waypoint x="${to[0]}" y="${to[1]}" />\n      </dmndi:DMNEdge>`;

interface RuleSpec {
  id: string;
  inputs: string[];
  outputs: string[];
}

/** A decision with one UNIQUE decision table over `inputs` (FEEL type names, `-` for any) and one output column named like the decision. */
function decisionTable(decisionId: string, outputType: string, inputs: Array<{ label: string; expression: string; type: string }>, requirements: string[], rules: RuleSpec[], outputName = decisionId): string {
  const reqs = requirements
    .map((r) => (r.startsWith('InputData_') ? `    <informationRequirement id="${decisionId}_req_${r}">\n      <requiredInput href="#${r}" />\n    </informationRequirement>` : `    <informationRequirement id="${decisionId}_req_${r}">\n      <requiredDecision href="#${r}" />\n    </informationRequirement>`))
    .join('\n');
  const inputXml = inputs
    .map((input, i) => `      <input id="${decisionId}_input${i + 1}" label="${escapeXml(input.label)}">\n        <inputExpression id="${decisionId}_inputExpression${i + 1}" typeRef="${input.type}">\n          <text>${escapeText(input.expression)}</text>\n        </inputExpression>\n      </input>`)
    .join('\n');
  const ruleXml = rules
    .map(
      (rule) =>
        `      <rule id="${decisionId}_${rule.id}">\n${rule.inputs.map((t, i) => `        <inputEntry id="${decisionId}_${rule.id}_in${i + 1}"><text>${escapeText(t)}</text></inputEntry>`).join('\n')}\n${rule.outputs.map((t, i) => `        <outputEntry id="${decisionId}_${rule.id}_out${i + 1}"><text>${escapeText(t)}</text></outputEntry>`).join('\n')}\n      </rule>`,
    )
    .join('\n');
  return `  <decision id="${decisionId}" name="${decisionId}">
    <variable id="${decisionId}_variable" name="${decisionId}" typeRef="${outputType}" />
${reqs}
    <decisionTable id="${decisionId}_table" hitPolicy="UNIQUE">
${inputXml}
      <output id="${decisionId}_output1" name="${outputName}" typeRef="${outputType}" />
${ruleXml}
    </decisionTable>
  </decision>`;
}

function dmnDecisionTableFile(definitionsId: string, name: string, decisionId: string): string {
  return `${DMN_HEAD(definitionsId, name)}
${inputData('amount', 'number')}
${decisionTable(
  decisionId,
  'string',
  [{ label: 'Amount', expression: 'amount', type: 'number' }],
  ['InputData_amount'],
  [
    { id: 'small', inputs: ['< 1000'], outputs: ['"standard"'] },
    { id: 'large', inputs: ['>= 1000'], outputs: ['"review"'] },
  ],
  'route',
)}
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
${shape(decisionId, 160, 100, 180, 80)}
${shape('InputData_amount', 175, 300, 150, 45)}
${edge(`${decisionId}_req_InputData_amount`, [250, 300], [250, 180])}
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

function dmnDrdFile(definitionsId: string, name: string, riskId: string, offerId: string): string {
  return `${DMN_HEAD(definitionsId, name)}
${inputData('score', 'number')}
${inputData('amount', 'number')}
${decisionTable(
  riskId,
  'string',
  [{ label: 'Score', expression: 'score', type: 'number' }],
  ['InputData_score'],
  [
    { id: 'high', inputs: ['< 500'], outputs: ['"HIGH"'] },
    { id: 'low', inputs: ['>= 500'], outputs: ['"LOW"'] },
  ],
)}
${decisionTable(
  offerId,
  'string',
  [
    { label: 'Risk', expression: riskId, type: 'string' },
    { label: 'Amount', expression: 'amount', type: 'number' },
  ],
  [riskId, 'InputData_amount'],
  [
    { id: 'approve', inputs: ['"LOW"', '-'], outputs: ['"APPROVE"'] },
    { id: 'small', inputs: ['"HIGH"', '< 1000'], outputs: ['"REVIEW"'] },
    { id: 'decline', inputs: ['"HIGH"', '>= 1000'], outputs: ['"DECLINE"'] },
  ],
)}
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
${shape(offerId, 160, 40, 180, 80)}
${shape(riskId, 60, 200, 180, 80)}
${shape('InputData_score', 80, 380, 120, 45)}
${shape('InputData_amount', 380, 200, 120, 45)}
${edge(`${offerId}_req_${riskId}`, [150, 200], [250, 120])}
${edge(`${offerId}_req_InputData_amount`, [440, 200], [330, 120])}
${edge(`${riskId}_req_InputData_score`, [140, 380], [150, 280])}
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

// --- the templates --------------------------------------------------------------------------------------------------

function connectorDefinition(name: string): string {
  return `${JSON.stringify(
    {
      id: name,
      name,
      description: `Connector ${name} (bean ${name}.SEND)`,
      actions: {
        SEND: {
          id: 'SEND',
          name: 'Send',
          description: 'Sends a message',
          inputs: [
            { id: 'to', name: 'to', type: 'string', required: true },
            { id: 'subject', name: 'subject', type: 'string' },
          ],
          outputs: [{ id: 'messageId', name: 'messageId', type: 'string' }],
        },
      },
    },
    null,
    2,
  )}\n`;
}

const FLOW_TASK_Y = 100;

/**
 * Creates the files of a template. Throws when the main file already exists. Companion files that already exist are
 * left out, so applying a template twice never overwrites anything.
 */
export function createFromTemplate(id: TemplateId, context: TemplateContext): TemplateResult {
  const info = TEMPLATES.find((t) => t.id === id);
  if (!info) throw new Error(`Unknown template ${id}`);
  const paths = new Set(context.paths);
  const processIds = new Set(context.processIds ?? []);
  const decisionIds = new Set(context.decisionIds ?? []);
  const base = fileBaseName(context.name || info.defaultName);
  const main = joinPath(info.folder, `${base}${info.suffix}`);
  if (paths.has(main)) throw new Error(`A file ${main} already exists`);
  const files: TemplateFile[] = [{ path: main, content: '' }];
  const addCompanion = (path: string, content: string): void => {
    if (!paths.has(path) && !files.some((f) => f.path === path)) files.push({ path, content });
  };
  const idBase = toIdentifier(base);

  switch (id) {
    case 'empty-process': {
      const processId = idBase === 'process' ? unique('Process', processIds, 1) : unique(idBase, processIds);
      const start = processId === 'Process_1' ? 'StartEvent_1' : `StartEvent_${processId}`;
      files[0]!.content = bpmnDocument(processId, undefined, [{ id: start, type: 'startEvent', x: 179, y: 159 }], []);
      addCompanion(joinPath('processes', `${base}-extensions.json`), extensionsDocument(base, processId, { properties: {}, mappings: {}, constants: {} }));
      break;
    }
    case 'user-task-approval': {
      const p = unique(idBase, new Set([...processIds, 'start', 'review', 'decide', 'approved_end', 'rejected_end']));
      files[0]!.content = bpmnDocument(
        p,
        'Approval',
        [
          { id: 'start', type: 'startEvent', name: 'Request submitted', x: 152, y: 142 },
          { id: 'review', type: 'userTask', name: 'Review request', x: 240, y: FLOW_TASK_Y, attrs: { 'activiti:candidateGroups': 'managers' } },
          { id: 'decide', type: 'exclusiveGateway', name: 'Approved?', x: 395, y: 115 },
          { id: 'approved_end', type: 'endEvent', name: 'Approved', x: 502, y: 52 },
          { id: 'rejected_end', type: 'endEvent', name: 'Rejected', x: 502, y: 232 },
        ],
        [
          { id: 'flow_start_review', from: 'start', to: 'review' },
          { id: 'flow_review_decide', from: 'review', to: 'decide' },
          { id: 'flow_approved', from: 'decide', to: 'approved_end', name: 'approved', condition: '${approved == true}', exit: 'top' },
          { id: 'flow_rejected', from: 'decide', to: 'rejected_end', name: 'rejected', exit: 'bottom' },
        ],
        { decide: 'flow_rejected' },
      );
      addCompanion(
        joinPath('processes', `${base}-extensions.json`),
        extensionsDocument(base, p, { properties: { Property_approved: property('Property_approved', 'approved', 'boolean') }, mappings: { review: { mappingType: 'MAP_ALL' } }, constants: {} }),
      );
      break;
    }
    case 'connector-call': {
      const p = unique(idBase, new Set([...processIds, 'start', 'notify', 'end']));
      const connector = 'mailer';
      files[0]!.content = bpmnDocument(
        p,
        'Notify',
        [
          { id: 'start', type: 'startEvent', name: 'Start', x: 152, y: 142 },
          { id: 'notify', type: 'serviceTask', name: 'Send notification', x: 240, y: FLOW_TASK_Y, attrs: { implementation: `${connector}.SEND` } },
          { id: 'end', type: 'endEvent', name: 'End', x: 402, y: 142 },
        ],
        [
          { id: 'flow_start_notify', from: 'start', to: 'notify' },
          { id: 'flow_notify_end', from: 'notify', to: 'end' },
        ],
      );
      addCompanion(
        joinPath('processes', `${base}-extensions.json`),
        extensionsDocument(base, p, {
          properties: {
            Property_recipient: property('Property_recipient', 'recipient', 'string'),
            Property_messageId: property('Property_messageId', 'messageId', 'string'),
          },
          mappings: {
            notify: {
              inputs: { to: { type: 'VARIABLE', value: 'recipient' }, subject: { type: 'VALUE', value: 'Hello from Activiti' } },
              outputs: { messageId: { type: 'VARIABLE', value: 'messageId' } },
            },
          },
          constants: {},
        }),
      );
      addCompanion(joinPath('connectors', `${connector}.json`), connectorDefinition(connector));
      break;
    }
    case 'decision-task': {
      const p = unique(idBase, new Set([...processIds, 'start', 'decision', 'end']));
      const decisionId = unique(`${idBase}_route`, decisionIds);
      files[0]!.content = bpmnDocument(
        p,
        'Decide',
        [
          { id: 'start', type: 'startEvent', name: 'Start', x: 152, y: 142 },
          { id: 'decision', type: 'serviceTask', name: 'Route by amount', x: 240, y: FLOW_TASK_Y, attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } },
          { id: 'end', type: 'endEvent', name: 'End', x: 402, y: 142 },
        ],
        [
          { id: 'flow_start_decision', from: 'start', to: 'decision' },
          { id: 'flow_decision_end', from: 'decision', to: 'end' },
        ],
      );
      addCompanion(
        joinPath('processes', `${base}-extensions.json`),
        extensionsDocument(base, p, {
          properties: {
            Property_amount: property('Property_amount', 'amount', 'integer'),
            Property_route: property('Property_route', 'route', 'string'),
          },
          mappings: { decision: { inputs: { amount: { type: 'VARIABLE', value: 'amount' } }, outputs: { route: { type: 'VARIABLE', value: 'route' } } } },
          constants: { decision: { _activiti_dmn_table_: { value: decisionId } } },
        }),
      );
      addCompanion(joinPath('processes', `${base}-rules.dmn`), dmnDecisionTableFile(`Definitions_${idBase}`, base, decisionId));
      break;
    }
    case 'dmn-decision-table': {
      const decisionId = unique(idBase === 'decision' ? 'decision' : idBase, decisionIds);
      files[0]!.content = dmnDecisionTableFile(`Definitions_${idBase}`, base, decisionId);
      break;
    }
    case 'dmn-drd': {
      const risk = unique(`${idBase}_riskClass`, decisionIds);
      const offer = unique(`${idBase}_offer`, new Set([...decisionIds, risk]));
      files[0]!.content = dmnDrdFile(`Definitions_${idBase}`, base, risk, offer);
      break;
    }
    case 'scenario': {
      const key = context.processKey ?? 'process';
      files[0]!.content = `${JSON.stringify(
        {
          name: base,
          users: { alice: [] },
          scenarios: [{ name: 'happy path', start: { process: key, user: 'alice', variables: {} }, expect: { state: 'COMPLETED' } }],
        },
        null,
        2,
      )}\n`;
      break;
    }
    case 'connector-definition': {
      const name = base.replace(/\./g, '-');
      files[0]!.path = joinPath('connectors', `${name}.json`);
      if (paths.has(files[0]!.path)) throw new Error(`A file ${files[0]!.path} already exists`);
      files[0]!.content = connectorDefinition(name);
      break;
    }
  }
  return { files };
}

/** Process ids declared in BPMN XML text (a cheap scan; the editors do the real parsing). */
export function scanProcessIds(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w-]+:)?process\b[^>]*?\bid="([^"]+)"/g)].map((m) => m[1]!);
}

/** Decision ids declared in DMN XML text. */
export function scanDecisionIds(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w-]+:)?decision\b[^>]*?\bid="([^"]+)"/g)].map((m) => m[1]!);
}

/** The folder a dropped or imported file belongs to in the ADR 0003 layout. */
export function defaultFolderFor(fileName: string): string {
  const { suffix } = splitName(fileName);
  if (fileName.endsWith('.scenario.json')) return 'scenarios';
  if (['.bpmn20.xml', '.bpmn', '-extensions.json', '.dmn'].some((s) => fileName.endsWith(s))) return 'processes';
  if (suffix === '.json') return 'connectors';
  if (suffix === '.form') return 'forms';
  return '';
}

