import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

import { addInputRight, addOutputRight, addRuleAtEnd, cellEditor, columnPopup, inputHeader, inputSettled, leaveCell, openColumnEditor, outputHeader, ruleIds, selectHitPolicy } from '../dmn/support';
import { addListItem, addRow, check, entry, panel, pick, reveal, type as typeText, valueOf } from '../properties/support';
import { activePanel, closeExportInfo, dropFiles, idbFiles, menu, tab } from './app';
import type { CorpusModeler, DmnInputDataSpec, DmnInputSpec, DmnOutputSpec, DmnRuleSpec, DmnTableSpec, ExportedProject, ExtensionsOptions, FlowOptions, ShapeOptions } from './modelerApi';

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  width: number;
  height: number;
}

/** The canvas of the visible editor: where its svg is on the screen, and the scale and translation of its viewport. */
interface View {
  box: Box;
  scale: number;
  tx: number;
  ty: number;
}

type OpenFile =
  | { kind: 'bpmn'; title: string; processId: string; omitExtensions: boolean }
  | { kind: 'dmn'; title: string; path: string; ruleIds: Array<[generated: string, wanted: string]> };

/** The entry of the create menu (the palette's "Create element", the `N` menu) for a shape, and a word that finds it in the menu's search. */
const CREATE_ENTRIES: Record<string, [entry: string, search: string]> = {
  startEvent: ['create-none-start-event', 'start event'],
  endEvent: ['create-none-end-event', 'end event'],
  'endEvent/error': ['create-error-end', 'error end'],
  'intermediateCatchEvent/timer': ['create-timer-intermediate-catch', 'timer intermediate'],
  'intermediateCatchEvent/message': ['create-message-intermediate-catch', 'message intermediate catch'],
  'intermediateThrowEvent/compensate': ['create-compensation-intermediate-throw', 'compensation intermediate'],
  userTask: ['create-user-task', 'user task'],
  serviceTask: ['create-service-task', 'service task'],
  decisionTask: ['create-decision-task', 'decision task'],
  scriptTask: ['create-script-task', 'script task'],
  callActivity: ['create-call-activity', 'call activity'],
  subProcess: ['create-expanded-subprocess', 'expanded'],
  exclusiveGateway: ['create-exclusive-gateway', 'exclusive'],
  parallelGateway: ['create-parallel-gateway', 'parallel gateway'],
  inclusiveGateway: ['create-inclusive-gateway', 'inclusive'],
  eventBasedGateway: ['create-event-based-gateway', 'event-based'],
};

/** What the replace menu calls the event definitions of the builds' boundary events and event sub process starts. */
const DEFINITION_NAMES: Record<string, string> = { error: 'error', compensate: 'compensation', timer: 'timer' };

/** The entries of the properties panel by kind (entry id = accessor key); the structured values have code of their own below. */
const SELECTS = new Set(['impl.type', 'mi.type', 'mapping.type', 'script.format', 'error.ref', 'message.ref', 'compensate.activityRef']);
const CHECKS = new Set(['flow.default', 'async.async', 'async.exclusive', 'call.inheritBusinessKey', 'call.inheritVariables', 'mapping.ephemeral', 'compensate.waitForCompletion']);
const TEXTS = new Set([
  'general.name', 'general.targetNamespace', 'documentation.text', 'starters.users', 'starters.groups', 'start.initiator', 'form.key',
  'user.assignee', 'user.owner', 'user.candidateUsers', 'user.candidateGroups', 'user.dueDate', 'user.priority', 'user.category', 'user.businessCalendarName', 'user.humanPerformer', 'user.potentialOwner',
  'mi.cardinality', 'mi.collection', 'mi.elementVariable', 'mi.elementIndexVariable', 'mi.completionCondition', 'mi.outputCollection', 'mi.outputItem',
  'skip.expression', 'impl.class', 'impl.expression', 'impl.resultVariable', 'impl.delegateExpression', 'impl.connector', 'script.text',
  'call.calledElement', 'call.businessKey', 'message.correlationKey', 'flow.condition', 'decision.table',
]);

/** The labels of the hit policies in the decision table (`<hit policy>/<aggregation>`). */
const HIT_POLICIES: Record<string, string> = {
  UNIQUE: 'Unique', FIRST: 'First', PRIORITY: 'Priority', ANY: 'Any', COLLECT: 'Collect', 'COLLECT/SUM': 'Collect (Sum)', 'COLLECT/MIN': 'Collect (Min)', 'COLLECT/MAX': 'Collect (Max)', 'COLLECT/COUNT': 'Collect (Count)', 'RULE ORDER': 'Rule order', 'OUTPUT ORDER': 'Output order',
};

/** The DMN connector of a decision task. */
const DMN_CONNECTOR = 'dmn-connector.EXECUTE_TABLE';
const DMN_MATCHED = '_activiti_dmn_matched_';
const DMN_MATCHED_RULES = '_activiti_dmn_matched_rules_';

/** Where boundary events go on the bottom edge of their host, from its centre: apart, so that a click on one never hits another or its append button. */
const BOUNDARY_OFFSETS = [-30, 30, 0];

/** A value of a mapping, constant or default as the panel shows it: text as it is, anything that would read as JSON in quotes (validation/mapping.ts). */
function valueText(value: unknown): string {
  if (typeof value !== 'string') return value === undefined ? '' : JSON.stringify(value);
  try {
    JSON.parse(value.trim());
    return value.trim() === '' ? value : JSON.stringify(value);
  } catch {
    return value;
  }
}

const isSelected = async (gfx: Locator): Promise<boolean> => /\bselected\b/.test((await gfx.getAttribute('class')) ?? '');

/**
 * Builds a corpus project through the real UI: menus, dialogs, the palette, the create menu, the context pad, the replace menu, the
 * properties panel, the DRD and the cells of the decision table, with real clicks and typing (Playwright's mouse and keyboard). The
 * same `corpus/<id>/build.ts` runs through `ModelerApi` (the test API) and through this driver. Reading the page (which element is
 * new, where a shape is) uses the DOM, the XML a source edit starts from and the semantic diff at the end use read-only calls of the
 * test API. Nothing is modelled through the test API.
 *
 * A build that asks for something this driver cannot do through the UI gets an error that says so.
 */
export class UiModeler implements CorpusModeler {
  private file: OpenFile | undefined;
  /** Event sub process -> the start event bpmn-js put into it, until the build gives it its definition. */
  private readonly eventStarts = new Map<string, string>();
  /** Boundary events this build put on a host, for their place on its edge. */
  private readonly attachers = new Map<string, number>();
  /** Decision id -> the project path of its DMN file (for the decision picker of a decision task). */
  private readonly decisionFiles = new Map<string, string>();
  /** Export warnings of the processes, as the editor of each process shows them after saving. */
  private readonly warnings: string[] = [];

  private constructor(private readonly page: Page) {}

  /** Opens the app; the build starts with `createProject`. */
  static async open(page: Page): Promise<UiModeler> {
    await page.goto('/');
    await activePanel(page).locator('.djs-container svg .djs-element').first().waitFor();
    return new UiModeler(page);
  }

  // --- project and files ----------------------------------------------------------------------------------------------------------

  /** File > New project…; Settings > Default mappings > none first when the build asks for no default mappings. */
  async createProject(name: string, options: { version?: string; defaultMappings?: 'mapAll' | 'none' } = {}): Promise<void> {
    if (options.version !== undefined && options.version !== '1.0.0') throw new Error('the UI driver makes projects of version 1.0.0 (File > New project)');
    if (options.defaultMappings === 'none') {
      await menu(this.page, 'File', 'Settings…');
      await this.page.getByTestId('setting-defaultMappings-none').check();
      await this.page.keyboard.press('Escape');
      await expect(this.page.getByTestId('settings-dialog')).toHaveCount(0);
    }
    await menu(this.page, 'File', 'New project…');
    await this.page.getByTestId('prompt-input').fill(name);
    await this.page.getByTestId('prompt-confirm').click();
    await expect(this.page.getByTestId('project-name')).toHaveText(name);
    // every new project starts with an empty process; the seeds have none
    await this.deleteFile('processes/process.bpmn20.xml');
    // the export warnings of a process are shown in the bottom panel
    if (!(await this.page.getByTestId('bottom-panel').isVisible())) await menu(this.page, 'View', 'Bottom panel');
    await this.page.getByTestId('warnings-tab').click();
  }

  /** File > New file > Empty process; the start event of the template goes, the process gets its id and name in the panel. */
  async newProcess(id: string, name?: string, options: { file?: string; omitExtensions?: boolean } = {}): Promise<void> {
    await this.finishFile();
    const file = options.file ?? id;
    const title = `${file}.bpmn20.xml`;
    this.attachers.clear();
    await this.newFile('Empty process', file, title);
    await this.bpmnCanvas().locator('.djs-container > svg').first().waitFor();
    this.file = { kind: 'bpmn', title, processId: file, omitExtensions: options.omitExtensions === true };
    // the template's start event; its id is the process id of the template (the file name)
    const start = activePanel(this.page).locator('.djs-element.djs-shape[data-element-id^="StartEvent_"]');
    await expect(start).toHaveCount(1);
    await this.remove((await start.getAttribute('data-element-id'))!);
    await expect(entry(this.page, 'general.id').locator('input')).toHaveValue(file);
    await typeText(this.page, 'general.id', id);
    this.file.processId = id;
    await expect(entry(this.page, 'general.id').locator('input')).toHaveValue(id);
    if (name) await typeText(this.page, 'general.name', name);
  }

  /** The connector descriptor dropped on the page as a file (U26): `connectors/<name>.json`. */
  async addConnector(name: string, content: string): Promise<void> {
    await dropFiles(this.page, [{ name: `${name}.json`, content, type: 'application/json' }]);
    const title = `${name}.json`;
    await expect(this.page.getByTestId('file-tree').locator(`[data-path="connectors/${title}"]`)).toHaveCount(1);
    // the import opens the file it imported; this build goes on elsewhere
    await expect(tab(this.page, title)).toHaveCount(1);
    await this.closeTab(title);
  }

  /**
   * Saves and closes the open file, and exports the project with File > Export project as zip; the files of the zip are written below
   * `directory`.
   */
  async writeProject(directory: string): Promise<{ paths: string[]; project: ExportedProject }> {
    await this.finishFile();
    const download = this.page.waitForEvent('download');
    await menu(this.page, 'File', 'Export project as zip');
    const bytes = await readFile((await (await download).path())!);
    await closeExportInfo(this.page);
    const files = Object.entries(unzipSync(new Uint8Array(bytes)))
      .filter(([path]) => !path.endsWith('/'))
      .map(([path, data]) => ({ path, content: strFromU8(data) }));
    const paths: string[] = [];
    for (const file of files) {
      const target = join(directory, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
      paths.push(target);
    }
    return { paths, project: { files, warnings: [...this.warnings] } };
  }

  // --- the semantic comparison: pure functions of the test API ----------------------------------------------------------------------

  diffBpmn(expectedXml: string, actualXml: string, options?: { ignoreElements?: string[] }): Promise<string[]> {
    return this.testApi('diffBpmn', expectedXml, actualXml, options);
  }

  diffExtensions(expectedJson: string | undefined, actualJson: string | undefined): Promise<string[]> {
    return this.testApi('diffExtensions', expectedJson, actualJson);
  }

  diffDmn(expectedXml: string, actualXml: string, options?: { allow?: string[] }): Promise<string[]> {
    return this.testApi('diffDmn', expectedXml, actualXml, options);
  }

  private testApi<T>(method: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(([name, params]) => {
      const target = (window as unknown as { __modelerTestApi: Record<string, (...a: unknown[]) => unknown> }).__modelerTestApi;
      return target[name as string]!(...(params as unknown[])) as T;
    }, [method, args] as const) as Promise<T>;
  }

  // --- BPMN: shapes and flows -------------------------------------------------------------------------------------------------------

  async createShape(spec: ShapeOptions): Promise<string> {
    this.bpmn();
    const unsupported = (['after', 'dy', 'interrupting', 'isExpanded', 'allowHidden', 'process', 'blackBox'] as const).filter((k) => spec[k] !== undefined);
    if (unsupported.length > 0) throw new Error(`the UI driver does not create shapes with ${unsupported.join(', ')}`);
    const attrs = { ...spec.attrs };
    let created: string;
    const ownStart = spec.type === 'startEvent' && spec.parent !== undefined ? this.eventStarts.get(spec.parent) : undefined;
    if (spec.type === 'boundaryEvent') {
      created = await this.attachBoundaryEvent(spec);
    } else if (ownStart) {
      // the start event of an event sub process gets its definition in the replace menu
      if (!spec.eventDefinition) throw new Error(`the start event of the event sub process ${spec.parent} needs a definition`);
      this.eventStarts.delete(spec.parent!);
      created = ownStart;
      await this.replace(created, `replace-with-${DEFINITION_NAMES[spec.eventDefinition]}-start`);
    } else if (spec.type === 'subProcess' && spec.triggeredByEvent) {
      if (!spec.at || !spec.size) throw new Error(`createShape ${spec.id}: the UI driver needs the position and size of an event sub process`);
      created = await this.createEventSubProcess({ x: spec.at.x - spec.size.width / 2 + 175, y: spec.at.y - spec.size.height / 2 + 100 });
      await this.resize(created, { x: spec.at.x - spec.size.width / 2, y: spec.at.y - spec.size.height / 2, ...spec.size });
    } else {
      let kind: string = spec.type;
      if (spec.type === 'serviceTask' && attrs['implementation'] === DMN_CONNECTOR) {
        // the Decision task of the create menu: a service task on the DMN connector
        kind = 'decisionTask';
        delete attrs['implementation'];
      }
      const replaceStart = spec.type === 'startEvent' && spec.eventDefinition !== undefined;
      if (spec.eventDefinition && !replaceStart) kind = `${kind}/${spec.eventDefinition}`;
      const menuEntry = CREATE_ENTRIES[kind];
      if (!menuEntry) throw new Error(`the UI driver has no create menu entry for ${kind}`);
      if (!spec.at) throw new Error(`createShape ${spec.id ?? spec.type}: the UI driver needs a position (at)`);
      // a sized shape is created so that after resizing (the bottom right corner moves) it covers the box the build asks for
      const at = spec.size ? { x: spec.at.x - spec.size.width / 2 + 175, y: spec.at.y - spec.size.height / 2 + 100 } : spec.at;
      created = await this.createAt(menuEntry, at, spec.parent);
      if (replaceStart) throw new Error(`the UI driver gives a definition only to the start event of an event sub process, not to ${spec.id}`);
      if (spec.size) await this.resize(created, { x: spec.at.x - spec.size.width / 2, y: spec.at.y - spec.size.height / 2, ...spec.size });
    }
    if (Object.keys(attrs).length > 0) throw new Error(`the UI driver does not set the attributes ${Object.keys(attrs).join(', ')} at creation`);
    if (spec.id) {
      // the start event of an event sub process stays known under the new id
      const start = this.eventStarts.get(created);
      this.eventStarts.delete(created);
      created = await this.renameElement(created, spec.id);
      if (start) this.eventStarts.set(created, start);
    }
    if (spec.name) await typeText(this.page, 'general.name', spec.name);
    return created;
  }

  /** The context pad's connect tool from the source, then a click on the target; the flow gets its id and name in the panel. */
  async connect(source: string, target: string, id?: string, attrs: Omit<FlowOptions, 'id'> = {}): Promise<string> {
    this.bpmn();
    const { type: kind, name, attrs: extra, ...rest } = attrs;
    if (Object.keys(rest).length > 0) throw new Error(`the UI driver does not connect with ${Object.keys(rest).join(', ')}`);
    if (kind !== undefined && kind !== 'association') throw new Error(`the UI driver draws sequence flows and associations, not ${kind}`);
    // the association of a compensation boundary event is the one with a direction (bpmn-js draws it so)
    if (extra && !(kind === 'association' && Object.keys(extra).length === 1 && extra['associationDirection'] === 'One')) throw new Error(`the UI driver does not set ${JSON.stringify(extra)} on a connection`);
    await this.reveal([await this.centreOf(source), await this.centreOf(target)]);
    await this.select(source);
    const before = new Set(await this.connectionIds());
    await activePanel(this.page).locator('.djs-context-pad .entry[data-action="connect"]').click();
    await this.dropAt(await this.clickPoint(target));
    let created = '';
    await expect.poll(async () => {
      const fresh = (await this.connectionIds()).filter((c) => !before.has(c));
      created = fresh[0] ?? '';
      return fresh.length;
    }, { message: `a connection from ${source} to ${target}` }).toBe(1);
    const expected = kind === 'association' ? /^Association_/ : /^Flow_/;
    if (!expected.test(created)) throw new Error(`connecting ${source} to ${target} drew ${created}, not a ${kind ?? 'sequence flow'}`);
    if (id) created = await this.renameElement(created, id);
    if (name) await typeText(this.page, 'general.name', name);
    return created;
  }

  /** Sets a property in the properties panel of the element: the entry whose id is the accessor key, or its rows and list items. */
  async setProperty(elementId: string, key: string, value: unknown): Promise<void> {
    this.bpmn();
    await this.select(elementId);
    await this.writeEntry(elementId, key, value);
  }

  /** The Process variables group of the process (`properties`, added or updated by name), and the mapping groups of an element. */
  async setExtensions(spec: ExtensionsOptions): Promise<void> {
    const file = this.bpmn();
    if (spec.mapping !== undefined) throw new Error('the UI driver sets mappings by type, inputs, outputs and constants');
    if (spec.properties) {
      await this.select(file.processId);
      await this.declareVariables(spec.properties);
    }
    if (spec.elementId) {
      await this.select(spec.elementId);
      if (spec.mappingType !== undefined) await pick(this.page, 'mapping.type', spec.mappingType);
      if (spec.inputs) await this.mappingRows('mapping.inputs', spec.inputs);
      if (spec.outputs) await this.mappingRows('mapping.outputs', spec.outputs);
      if (spec.constants) await this.constantRows(spec.constants);
    }
  }

  /**
   * The panel offers the exception mapping on Java class delegates and call activities only (lint L32). A mapping on a delegate
   * expression task is made the way a user gets one there: the task becomes a Java class for a moment, the mapping is added in the
   * Error mapping group, and the task goes back to its delegate expression (the implementation switch keeps fields and mappings).
   */
  async addExtensionElement(elementId: string, type: string, properties: Record<string, unknown> = {}): Promise<void> {
    this.bpmn();
    if (type !== 'activiti:MapException') throw new Error(`the UI driver cannot add a ${type} through the panel`);
    const { errorCode, body, includeChildExceptions, ...rest } = properties;
    if (Object.keys(rest).length > 0) throw new Error(`the UI driver does not set ${Object.keys(rest).join(', ')} on an exception mapping`);
    await this.select(elementId);
    if ((await valueOf(this.page, 'impl.type')) !== 'delegateExpression') throw new Error(`${elementId}: the UI driver adds an exception mapping to a delegate expression task only`);
    const expression = await valueOf(this.page, 'impl.delegateExpression');
    await pick(this.page, 'impl.type', 'class');
    await this.addRows('errors.mapExceptions', [{ errorCode: String(errorCode), exceptionClass: body === undefined ? '' : String(body), includeChildExceptions: includeChildExceptions === true }], ['errorCode', 'exceptionClass', 'includeChildExceptions']);
    await pick(this.page, 'impl.type', 'delegateExpression');
    await typeText(this.page, 'impl.delegateExpression', expression);
  }

  // --- DMN -------------------------------------------------------------------------------------------------------------------------

  /** File > New file > DMN decision table; the template's decision and input data go, the definitions get the id in the panel. */
  async createDmn(name: string, options: { id?: string; definitionsName?: string } = {}): Promise<void> {
    if (options.definitionsName !== undefined && options.definitionsName !== name) throw new Error('the definitions of a DMN file are named like the file (the normalizer of the editor names them so)');
    await this.finishFile();
    const title = `${name}.dmn`;
    await this.newFile('DMN decision table', name, title);
    await this.drdCanvas().locator('.djs-container svg .djs-element.djs-shape').first().waitFor();
    this.file = { kind: 'dmn', title, path: `processes/${title}`, ruleIds: [] };
    for (const shape of await this.drdShapeIds()) {
      await this.drdSelect(shape);
      await activePanel(this.page).locator('.djs-context-pad .entry[data-action="delete"]').click();
      await expect(this.drdElement(shape)).toHaveCount(0);
    }
    if (options.id) {
      await this.drdSelectRoot();
      await this.drdText('id', options.id);
    }
  }

  /** The palette's input data, its id, name and variable type in the panel of the DRD. */
  async addInputData(dmn: string, spec: DmnInputDataSpec): Promise<string> {
    this.dmn(dmn);
    const created = await this.drdPlace('create.input-data', spec.at ?? { x: 235, y: 322 });
    await this.drdIdentify(created, spec.id, spec.name ?? spec.id);
    if (spec.typeRef) await this.drdVariableType(spec.typeRef);
    return spec.id;
  }

  /**
   * The palette's decision, replaced by a decision table (context pad > replace), its id, name and variable type in the panel; then
   * the table: hit policy, columns (label, expression, type, allowed values in the column editor), rules and cells. dmn-js has no
   * field for the id of a rule: the rules get the ids the build gives them in the XML source of the file (search and replace) when the
   * file is finished.
   */
  async addDecisionTable(dmn: string, spec: DmnTableSpec): Promise<string> {
    const file = this.dmn(dmn);
    const placed = await this.drdPlace('create.decision', spec.at ?? { x: 250, y: 140 });
    await this.drdReplace(placed, 'replace-with-decision-table');
    await this.drdIdentify(placed, spec.id, spec.name ?? spec.id);
    if (spec.variableType) await this.drdVariableType(spec.variableType);
    this.decisionFiles.set(spec.id, file.path);
    await this.openView(`${spec.name ?? spec.id} table`);
    if (spec.hitPolicy) {
      const policy = spec.aggregation ? `${spec.hitPolicy.toUpperCase()}/${spec.aggregation.toUpperCase()}` : spec.hitPolicy.toUpperCase();
      const label = HIT_POLICIES[policy];
      if (!label) throw new Error(`no hit policy ${policy} in the decision table`);
      await selectHitPolicy(this.page, label);
      await expect(activePanel(this.page).locator('.hit-policy-edit-policy-select .dms-input')).toHaveText(label);
    }
    for (const [index, input] of spec.inputs.entries()) {
      if (index > 0) await addInputRight(this.page, index - 1);
      await this.editInput(index, input);
    }
    for (const [index, output] of spec.outputs.entries()) {
      if (index > 0) await addOutputRight(this.page, index - 1);
      await this.editOutput(index, output);
    }
    for (const rule of spec.rules) await this.addRule(file, rule, spec.inputs.length + spec.outputs.length);
    await this.openView('DRD');
    return spec.id;
  }

  /** The context pad's connect tool from the source to the target in the DRD; the kind of requirement follows from the elements. */
  async addRequirement(dmn: string, sourceId: string, targetId: string, type: 'information' | 'knowledge' | 'authority' = 'information'): Promise<string> {
    this.dmn(dmn);
    const before = new Set(await this.drdConnectionIds());
    await this.drdSelect(sourceId);
    await activePanel(this.page).locator('.djs-context-pad .entry[data-action="connect"]').click();
    await this.dropAt(await this.screenOf(this.drdCanvas(), await this.boxOf(this.drdElement(targetId)).then(centre)), 5);
    let created = '';
    await expect.poll(async () => {
      const fresh = (await this.drdConnectionIds()).filter((c) => !before.has(c));
      created = fresh[0] ?? '';
      return fresh.length;
    }, { message: `a requirement from ${sourceId} to ${targetId}` }).toBe(1);
    const prefix = { information: 'InformationRequirement_', knowledge: 'KnowledgeRequirement_', authority: 'AuthorityRequirement_' }[type];
    if (!created.startsWith(prefix)) throw new Error(`connecting ${sourceId} to ${targetId} drew ${created}, not an ${type} requirement`);
    return created;
  }

  // --- files ------------------------------------------------------------------------------------------------------------------------

  private bpmn(): Extract<OpenFile, { kind: 'bpmn' }> {
    if (this.file?.kind !== 'bpmn') throw new Error('no process is open; call newProcess first');
    return this.file;
  }

  private dmn(name: string): Extract<OpenFile, { kind: 'dmn' }> {
    if (this.file?.kind !== 'dmn' || this.file.title !== `${name}.dmn`) throw new Error(`the open file is not ${name}.dmn: the UI driver builds one file after the other`);
    return this.file;
  }

  /** File > New file > a template, named in the dialog; waits for its tab. */
  private async newFile(template: string, name: string, title: string): Promise<void> {
    await menu(this.page, 'File', 'New file', template);
    await this.page.getByTestId('prompt-input').fill(name);
    await this.page.getByTestId('prompt-confirm').click();
    await expect(tab(this.page, title)).toHaveClass(/\bactive\b/);
  }

  /** Saves the open file (Ctrl+S) and closes its tab; a process that has no extensions file in the seed loses it in the explorer. */
  private async finishFile(): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (file.kind === 'dmn') await this.renameRules(file);
    await this.save(file.title);
    if (file.kind === 'dmn') {
      const saved = (await idbFiles(this.page))[file.path] ?? '';
      for (const [, wanted] of file.ruleIds) if (!saved.includes(`<rule id="${wanted}">`)) throw new Error(`${file.path}: the rule ${wanted} is not in the saved file`);
    } else {
      // what the export of the process reported (dropped extension fields, kept foreign elements), as the bottom panel shows it
      const group = this.page.getByTestId('bottom-panel').locator('.warning-group').filter({ has: this.page.locator('h3', { hasText: `processes/${file.title}` }) });
      for (const warning of await group.locator('li').allInnerTexts()) this.warnings.push(`processes/${file.title}: ${warning}`);
    }
    await this.closeTab(file.title);
    if (file.kind === 'bpmn' && file.omitExtensions) await this.deleteFile(`processes/${file.title.replace(/\.bpmn20\.xml$/, '-extensions.json')}`);
    this.file = undefined;
  }

  private async save(title: string): Promise<void> {
    await this.page.keyboard.press('Control+S');
    await expect(tab(this.page, title), `the tab after Save (toasts: ${await this.page.getByTestId('toasts').innerText().catch(() => '')})`).not.toHaveClass(/\bdirty\b/);
    await expect(this.page.getByTestId('alert-dialog')).toHaveCount(0);
  }

  private async closeTab(title: string): Promise<void> {
    await tab(this.page, title).getByRole('button', { name: `Close ${title}` }).click();
    await expect(tab(this.page, title)).toHaveCount(0);
  }

  /** Explorer: right click on the file, Delete…, Delete. */
  private async deleteFile(path: string): Promise<void> {
    const row = this.page.getByTestId('file-tree').locator(`[data-path="${path}"]`);
    await row.click({ button: 'right' });
    await this.page.getByRole('menuitem', { name: 'Delete…' }).click();
    await this.page.getByTestId('choice-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
  }

  // --- the BPMN canvas --------------------------------------------------------------------------------------------------------------

  private bpmnCanvas(): Locator {
    return activePanel(this.page).getByTestId('bpmn-canvas');
  }

  private gfx(id: string): Locator {
    return activePanel(this.page).locator(`.djs-element[data-element-id="${id}"]`);
  }

  private async elementIds(): Promise<string[]> {
    return activePanel(this.page).locator('.djs-element[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? '').filter((id) => !id.endsWith('_label')));
  }

  private async connectionIds(): Promise<string[]> {
    return activePanel(this.page).locator('.djs-element.djs-connection[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? ''));
  }

  /** Where the canvas is on the screen and how its viewport is scaled and moved (`g.viewport`). */
  private async viewOf(canvas: Locator): Promise<View> {
    return canvas.locator('.djs-container > svg').first().evaluate((svg) => {
      const r = svg.getBoundingClientRect();
      const viewport = svg.querySelector(':scope > g.viewport');
      const m = /matrix\(([^)]+)\)/.exec(viewport?.getAttribute('transform') ?? '');
      const [scale = 1, , , , tx = 0, ty = 0] = (m?.[1] ?? '1 0 0 1 0 0').split(/[\s,]+/).map(Number);
      return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, scale, tx, ty };
    });
  }

  /** Where a diagram point is on the screen in this view. */
  private static onScreen(view: View, point: Point): Point {
    return { x: view.box.x + view.tx + point.x * view.scale, y: view.box.y + view.ty + point.y * view.scale };
  }

  /** Whether a screen point is in the part of the canvas a click or a drop may go to: clear of the palette, the borders (where dragging scrolls) and the watermark. */
  private static isSafe(view: View, point: Point): boolean {
    return point.x >= view.box.x + 130 && point.x <= view.box.x + view.box.width - 130 && point.y >= view.box.y + 70 && point.y <= view.box.y + view.box.height - 90;
  }

  /** The screen point of a diagram point, after scrolling the canvas when the point is not in the safe part of it. */
  private async screenOf(canvas: Locator, point: Point): Promise<Point> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const view = await this.viewOf(canvas);
      const screen = UiModeler.onScreen(view, point);
      if (UiModeler.isSafe(view, screen)) return screen;
      await this.centreOn(canvas, view, screen);
    }
    throw new Error(`cannot scroll the diagram point ${point.x},${point.y} into view`);
  }

  /**
   * Scrolls the canvas with the mouse wheel so that a screen point comes to the middle of the canvas. diagram-js scrolls by three
   * quarters of the wheel delta, and only while the pointer is on the canvas itself (not on a context pad or a marker).
   */
  private async centreOn(canvas: Locator, view: View, screen: Point): Promise<void> {
    const centre = { x: view.box.x + view.box.width / 2, y: view.box.y + view.box.height / 2 };
    if (Math.abs(screen.x - centre.x) < 2 && Math.abs(screen.y - centre.y) < 2) return;
    const spot = await this.emptySpot(canvas);
    await this.page.mouse.move(spot.x, spot.y);
    await this.page.mouse.wheel((screen.x - centre.x) / 0.75, (screen.y - centre.y) / 0.75);
    await expect.poll(async () => {
      const next = await this.viewOf(canvas);
      return next.tx !== view.tx || next.ty !== view.ty;
    }).toBe(true);
  }

  /** Scrolls so that the middle of these diagram points is in the middle of the canvas, when they are not all in its safe part. */
  private async reveal(points: Point[]): Promise<void> {
    const canvas = this.bpmnCanvas();
    const view = await this.viewOf(canvas);
    const screen = points.map((p) => UiModeler.onScreen(view, p));
    if (screen.every((p) => UiModeler.isSafe(view, p))) return;
    const xs = screen.map((p) => p.x);
    const ys = screen.map((p) => p.y);
    await this.centreOn(canvas, view, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  }

  /** Position and size of a shape in diagram coordinates (its own transform and its hit box). */
  private async boxOf(gfx: Locator): Promise<Box> {
    return gfx.first().evaluate((el) => {
      const m = /matrix\(1 0 0 1 (-?[\d.]+) (-?[\d.]+)\)/.exec(el.getAttribute('transform') ?? '');
      const hit = el.querySelector(':scope > .djs-hit');
      return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0), width: Number(hit?.getAttribute('width') ?? 0), height: Number(hit?.getAttribute('height') ?? 0) };
    });
  }

  private async centreOf(id: string): Promise<Point> {
    const gfx = this.gfx(id);
    if (await gfx.evaluate((el) => el.classList.contains('djs-connection'))) {
      const points = await this.waypoints(id);
      return points[Math.floor(points.length / 2)]!;
    }
    return centre(await this.boxOf(gfx));
  }

  private async waypoints(id: string): Promise<Point[]> {
    return this.gfx(id).locator(':scope > .djs-hit').evaluate((el) => (el.getAttribute('points') ?? '').trim().split(/\s+/).map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x: x!, y: y! };
    }));
  }

  /**
   * A screen point that a click on the element hits: candidates on the element (the centre of a shape, near the top left inside an
   * expanded sub process, points along a flow away from its label), the first one where the page shows the element itself and not a
   * label, a context pad or a button of another element. When something covers all of them (the context pad of the flow just drawn
   * sits on the task it ends at), a click on an empty spot closes the context pad first.
   */
  private async clickPoint(id: string): Promise<Point> {
    const point = await this.freePoint(id);
    if (point) return point;
    const pad = activePanel(this.page).locator('.djs-context-pad.open');
    for (let attempt = 0; attempt < 2 && (attempt === 0 || (await pad.count()) > 0); attempt += 1) {
      const spot = await this.emptySpot(this.bpmnCanvas());
      await this.page.mouse.click(spot.x, spot.y);
    }
    await expect(pad).toHaveCount(0);
    const again = await this.freePoint(id);
    if (!again) throw new Error(`no point of ${id} can be clicked: something covers it`);
    return again;
  }

  private async freePoint(id: string): Promise<Point | undefined> {
    const gfx = this.gfx(id);
    let candidates: Point[];
    if (await gfx.evaluate((el) => el.classList.contains('djs-connection'))) {
      const points = await this.waypoints(id);
      candidates = [];
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = points[i]!;
        const b = points[i + 1]!;
        for (const t of [0.25, 0.75, 0.4, 0.6]) candidates.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    } else {
      const box = await this.boxOf(gfx);
      const large = box.width > 200 && box.height > 120;
      candidates = large
        ? [{ x: box.x + 6, y: box.y + box.height / 2 }, { x: box.x + box.width / 2, y: box.y + 6 }, { x: box.x + 6, y: box.y + 6 }]
        : [centre(box), { x: box.x + box.width / 2, y: box.y + box.height * 0.25 }, { x: box.x + box.width * 0.25, y: box.y + box.height / 2 }, { x: box.x + box.width * 0.75, y: box.y + box.height / 2 }];
    }
    await this.screenOf(this.bpmnCanvas(), candidates[0]!);
    const view = await this.viewOf(this.bpmnCanvas());
    const screen = candidates.map((p) => UiModeler.onScreen(view, p));
    const hit = await this.page.evaluate(
      ({ elementId, points }) => {
        const own = document.querySelector(`.editor-panel.active .djs-element[data-element-id="${CSS.escape(elementId)}"]`);
        return points.findIndex((p) => {
          const at = document.elementFromPoint(p.x, p.y);
          return !!at && !!own && at.closest('.djs-element') === own;
        });
      },
      { elementId: id, points: screen },
    );
    return hit < 0 ? undefined : screen[hit];
  }

  /**
   * Ends a create or connect gesture with a click at `point`. On the BPMN canvas the pointer goes there in one move: on its way it
   * would pass the lint markers of other elements, whose list of problems opens on hover and can cover the point. The DRD has no lint
   * markers, and its preview of a requirement needs the pointer to arrive over the canvas (`steps`).
   */
  private async dropAt(point: Point, steps = 1): Promise<void> {
    await this.page.mouse.move(point.x, point.y, { steps });
    const covered = await this.page.evaluate(({ x, y }) => {
      const at = document.elementFromPoint(x, y);
      return at && !at.closest('.editor-panel.active .djs-container svg') ? at.outerHTML.slice(0, 160) : undefined;
    }, point);
    if (covered) throw new Error(`the drop point ${point.x},${point.y} is covered by ${covered}`);
    await this.page.mouse.click(point.x, point.y);
  }

  /** A spot of the canvas with nothing on it. */
  private async emptySpot(canvas: Locator): Promise<Point> {
    const box = (await canvas.locator('.djs-container > svg').first().boundingBox())!;
    const spot = await this.page.evaluate((b) => {
      for (let y = b.y + b.height - 100; y > b.y + 60; y -= 37) {
        for (let x = b.x + b.width - 150; x > b.x + 120; x -= 41) {
          // the background: the root svg of the canvas (it carries the id of the root element) or a layer of it, no element on it
          const at = document.elementFromPoint(x, y);
          const root = at?.closest('svg[data-element-id]');
          if (root && root.closest('.editor-panel.active .djs-container') && !at!.closest('.djs-element')) return { x, y };
        }
      }
      return undefined;
    }, box);
    if (!spot) throw new Error('no empty spot on the canvas');
    return spot;
  }

  /** Ends the label editing that bpmn-js opens on a new task (its name is typed in the panel). */
  private async endDirectEditing(): Promise<void> {
    const editing = activePanel(this.page).locator('.djs-direct-editing-parent');
    if (await editing.isVisible()) {
      await this.page.keyboard.press('Escape');
      await expect(editing).toBeHidden();
    }
  }

  /**
   * Selects an element with a click (the process with a click on an empty spot) and waits until the panel shows it. diagram-js
   * swallows the first click on an element shortly after a drag (its ghost click trap): a click that selected nothing is made again.
   */
  private async select(id: string): Promise<void> {
    const idField = entry(this.page, 'general.id').locator('input');
    const selected = activePanel(this.page).locator('.djs-element.selected');
    if (id === this.bpmn().processId) {
      if ((await selected.count()) === 0 && (await idField.count()) > 0 && (await idField.inputValue()) === id) return;
      await this.endDirectEditing();
      for (let attempt = 0; attempt < 2 && (attempt === 0 || (await selected.count()) > 0); attempt += 1) {
        const spot = await this.emptySpot(this.bpmnCanvas());
        await this.page.mouse.click(spot.x, spot.y);
      }
      await expect(selected).toHaveCount(0);
      await expect(idField).toHaveValue(id);
      return;
    }
    const gfx = this.gfx(id);
    await expect(gfx, `the element ${id}`).toHaveCount(1);
    if ((await isSelected(gfx)) && (await idField.count()) > 0 && (await idField.inputValue()) === id) return;
    await this.endDirectEditing();
    for (let attempt = 0; attempt < 2 && !(await isSelected(gfx)); attempt += 1) {
      const point = await this.clickPoint(id);
      await this.page.mouse.click(point.x, point.y);
    }
    await expect(gfx).toHaveClass(/\bselected\b/);
    await expect(idField).toHaveValue(id);
  }

  /** Palette > Create element (the create menu), the entry found by its search, then a click where the shape goes. */
  private async createAt([menuEntry, search]: [string, string], at: Point, parent?: string): Promise<string> {
    const point = await this.screenOf(this.bpmnCanvas(), at);
    const before = new Set(await this.elementIds());
    await this.endDirectEditing();
    await activePanel(this.page).locator('.djs-palette .entry[data-action="create"]').click();
    const popup = this.page.locator('.djs-popup');
    await expect(popup).toBeVisible();
    // the menu filters on key presses; some entries (the inclusive gateway) only show up in a search
    await popup.locator('.djs-popup-search input').pressSequentially(search);
    await popup.locator(`.entry[data-id="${menuEntry}"]`).click();
    await this.dropAt(point);
    const created = await this.newElement(before, `a ${menuEntry} at ${at.x},${at.y}`);
    await this.endDirectEditing();
    await this.expectParent(created, parent);
    return created;
  }

  private async newElement(before: Set<string>, what: string): Promise<string> {
    let created = '';
    await expect.poll(async () => {
      const fresh = (await this.elementIds()).filter((e) => !before.has(e));
      created = fresh[0] ?? '';
      return fresh.length;
    }, { message: what }).toBe(1);
    return created;
  }

  /** The element is drawn inside the shape it belongs to (the drop target decides the parent): diagram-js puts it in the `djs-children` group next to the parent. */
  private async expectParent(id: string, parent: string | undefined): Promise<void> {
    const owner = await this.gfx(id).evaluate((el) => {
      const children = el.parentElement?.parentElement;
      return children?.classList.contains('djs-children') ? (children.parentElement?.querySelector(':scope > .djs-element')?.getAttribute('data-element-id') ?? null) : null;
    });
    const expected = parent ?? this.bpmn().processId;
    if ((owner ?? this.bpmn().processId) !== expected) throw new Error(`${id} was created in ${owner ?? 'the process'}, not in ${expected}`);
  }

  /**
   * An event sub process: the palette's expanded sub process (bpmn-js puts a start event into it), replaced by an event sub process. A
   * start event cannot be created in an event sub process (only its error and message starts are allowed there, through the replace
   * menu), so the build's start event of the event sub process is that one.
   */
  private async createEventSubProcess(at: Point): Promise<string> {
    const point = await this.screenOf(this.bpmnCanvas(), at);
    const before = new Set(await this.elementIds());
    await this.endDirectEditing();
    await activePanel(this.page).locator('.djs-palette .entry[data-action="create.subprocess-expanded"]').click();
    await this.dropAt(point);
    let fresh: string[] = [];
    await expect.poll(async () => {
      fresh = (await this.elementIds()).filter((e) => !before.has(e));
      return fresh.length;
    }, { message: `an expanded sub process with its start event at ${at.x},${at.y}` }).toBe(2);
    await this.endDirectEditing();
    const kinds = await Promise.all(fresh.map((id) => this.gfx(id).evaluate((el) => el.querySelector(':scope > .djs-visual > circle') !== null)));
    const start = fresh.find((_, i) => kinds[i]);
    const subProcess = fresh.find((_, i) => !kinds[i]);
    if (!start || !subProcess) throw new Error(`the palette's sub process made ${fresh.join(', ')}`);
    await this.replace(subProcess, 'replace-with-event-subprocess');
    this.eventStarts.set(subProcess, start);
    return subProcess;
  }

  /**
   * A boundary event: the palette's intermediate event dropped on the bottom edge of the host (bpmn-js attaches it), then the replace
   * menu for its kind.
   */
  private async attachBoundaryEvent(spec: ShapeOptions): Promise<string> {
    if (!spec.attachedTo) throw new Error('a boundary event needs attachedTo');
    if (spec.at) throw new Error('the UI driver places boundary events on the edge of their host itself');
    const host = await this.boxOf(this.gfx(spec.attachedTo));
    const index = this.attachers.get(spec.attachedTo) ?? 0;
    const offset = BOUNDARY_OFFSETS[index];
    if (offset === undefined) throw new Error(`the UI driver puts at most ${BOUNDARY_OFFSETS.length} boundary events on a host`);
    this.attachers.set(spec.attachedTo, index + 1);
    const point = await this.screenOf(this.bpmnCanvas(), { x: host.x + host.width / 2 + offset, y: host.y + host.height });
    const before = new Set(await this.elementIds());
    await this.endDirectEditing();
    await activePanel(this.page).locator('.djs-palette .entry[data-action="create.intermediate-event"]').click();
    await this.dropAt(point);
    const created = await this.newElement(before, `a boundary event on ${spec.attachedTo}`);
    const attached = await this.page.evaluate(() => document.querySelector('.editor-panel.active .djs-element.selected')?.getAttribute('data-element-id'));
    if (attached !== created) throw new Error(`the boundary event ${created} is not selected after the drop`);
    if (spec.eventDefinition) {
      const kind = DEFINITION_NAMES[spec.eventDefinition];
      if (!kind) throw new Error(`the UI driver has no boundary event with a ${spec.eventDefinition} definition`);
      await this.replace(created, `replace-with-${kind}-boundary`);
    }
    await expect(entry(this.page, 'general.id').locator('input')).toHaveValue(created);
    return created;
  }

  /** The context pad's replace menu (bpmn-js keeps the id of the element). */
  private async replace(id: string, replaceEntry: string): Promise<void> {
    await this.select(id);
    await activePanel(this.page).locator('.djs-context-pad .entry[data-action="replace"]').click();
    await this.page.locator(`.djs-popup .entry[data-id="${replaceEntry}"]`).click();
    await expect(this.page.locator('.djs-popup')).toHaveCount(0);
    await this.select(id);
  }

  /** The resize handle at the bottom right corner of the selected shape, dragged until the shape covers `target`. */
  private async resize(id: string, target: Box): Promise<void> {
    await this.reveal([{ x: target.x, y: target.y }, { x: target.x + target.width, y: target.y + target.height }]);
    await this.select(id);
    const handle = activePanel(this.page).locator('.djs-resizer-se .djs-resizer-hit');
    // a shape that is selected because it was just created has no resize handles yet; a click on it shows them
    for (let attempt = 0; attempt < 2 && (await handle.count()) === 0; attempt += 1) {
      const point = await this.clickPoint(id);
      await this.page.mouse.click(point.x, point.y);
    }
    // both ends of the drag are read from the view as it is now: scrolling in between would leave the pointer off the handle
    const from = centre((await handle.boundingBox())!);
    const view = await this.viewOf(this.bpmnCanvas());
    const to = UiModeler.onScreen(view, { x: target.x + target.width, y: target.y + target.height });
    if (!UiModeler.isSafe(view, to)) throw new Error(`the corner of ${id} after resizing would be outside the canvas`);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 8 });
    await this.page.mouse.up();
    const box = await this.boxOf(this.gfx(id));
    if ([box.x - target.x, box.y - target.y, box.width - target.width, box.height - target.height].some((d) => Math.abs(d) > 12)) {
      throw new Error(`${id} is ${JSON.stringify(box)} after resizing, not ${JSON.stringify(target)}`);
    }
  }

  /** The context pad's delete entry. */
  private async remove(id: string): Promise<void> {
    await this.select(id);
    await activePanel(this.page).locator('.djs-context-pad .entry[data-action="delete"]').click();
    await expect(this.gfx(id)).toHaveCount(0);
  }

  /** The ID field of the General group. */
  private async renameElement(current: string, id: string): Promise<string> {
    await this.select(current);
    if (current === id) return id;
    await typeText(this.page, 'general.id', id);
    await expect(this.gfx(id), `${current} renamed to ${id}`).toHaveCount(1);
    await expect(entry(this.page, 'general.id').locator('input')).toHaveValue(id);
    return id;
  }

  // --- the properties panel -------------------------------------------------------------------------------------------------------

  private async writeEntry(elementId: string, key: string, value: unknown): Promise<void> {
    if ((key === 'mi.outputCollection' || key === 'mi.outputItem') && (await entry(this.page, 'mi.call.hint').count()) > 0) return this.loopOutputInSource(elementId, key, String(value));
    if (TEXTS.has(key)) return typeText(this.page, key, String(value));
    if (SELECTS.has(key)) return pick(this.page, key, String(value));
    if (CHECKS.has(key)) return check(this.page, key, value === true);
    switch (key) {
      case 'definitions.messages':
        return this.listItems('messages', 'definitions.messages', value as Array<Record<string, unknown>>, ['name', 'id']);
      case 'definitions.errors':
        return this.listItems('errors', 'definitions.errors', value as Array<Record<string, unknown>>, ['errorCode', 'name', 'id']);
      case 'listeners.task':
      case 'listeners.execution':
        return this.listeners(key, value as Array<Record<string, unknown>>);
      case 'fields.list':
        return this.newRows('fields.list', (value as Array<Record<string, unknown>>).map(fieldRow), ['name', 'kind', 'value']);
      case 'user.customResource':
        return this.newRows('user.customResource', value as Array<Record<string, unknown>>, ['name', 'expression']);
      case 'call.in':
      case 'call.out':
        return this.newRows(key, (value as Array<Record<string, unknown>>).map(parameterRow), ['kind', 'value', 'target']);
      case 'errors.mapExceptions':
        return this.newRows('errors.mapExceptions', value as Array<Record<string, unknown>>, ['errorCode', 'exceptionClass', 'includeChildExceptions']);
      case 'mapping.inputs':
      case 'mapping.outputs':
        return this.mappingRows(key, value as Record<string, { type: string; value: unknown }>);
      case 'constants.values':
        return this.constantRows(value as Record<string, unknown>);
      case 'timer.definition': {
        const timer = value as { type: string; value: string; endDate?: string };
        await pick(this.page, 'timer.definition.type', timer.type);
        await typeText(this.page, 'timer.definition.value', timer.value);
        if (timer.endDate) await typeText(this.page, 'timer.definition.endDate', timer.endDate);
        return;
      }
      case 'decision.pick':
        return this.pickDecision(value as { decision: string; inputs?: boolean; outputs?: boolean; matched?: string; matchedRules?: string });
      default:
        throw new Error(`the UI driver has no way to set ${key} in the panel`);
    }
  }

  /** The rows of a rows entry, as the panel shows them. */
  private async rows(id: string, keys: string[]): Promise<Array<Record<string, string | boolean>>> {
    await reveal(this.page, id);
    return panel(this.page).locator(`[data-entry-id="${id}"]`).first().evaluate((root, { entryId, fields }) => {
      const out: Array<Record<string, string | boolean>> = [];
      for (let i = 0; ; i += 1) {
        const row = root.querySelector(`[data-entry-id="${CSS.escape(`${entryId}[${i}]`)}"]`);
        if (!row) return out;
        const values: Record<string, string | boolean> = {};
        for (const field of fields) {
          const control = row.querySelector(`[data-entry-id="${CSS.escape(`${entryId}[${i}].${field}`)}"] input, [data-entry-id="${CSS.escape(`${entryId}[${i}].${field}`)}"] select, [data-entry-id="${CSS.escape(`${entryId}[${i}].${field}`)}"] textarea`) as HTMLInputElement | HTMLSelectElement | null;
          if (control) values[field] = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
        }
        out.push(values);
      }
    }, { entryId: id, fields: keys });
  }

  /** Fills one row of a rows entry: selects first (they decide what the other cells mean), then text, then check boxes. */
  private async fillRow(id: string, index: number, row: Record<string, unknown>, keys: string[], current: Record<string, string | boolean> = {}): Promise<void> {
    const cell = (key: string): string => `${id}[${index}].${key}`;
    const kinds = await panel(this.page).locator(`[data-entry-id="${id}[${index}]"]`).evaluate((el, fields) => Object.fromEntries(fields.map((f) => {
      const control = el.querySelector(`[data-entry-id$=".${f}"] input, [data-entry-id$=".${f}"] select, [data-entry-id$=".${f}"] textarea`);
      return [f, control instanceof HTMLSelectElement ? 'select' : control instanceof HTMLInputElement && control.type === 'checkbox' ? 'check' : 'text'];
    })), keys);
    for (const key of keys.filter((k) => kinds[k] === 'select')) if (row[key] !== undefined && current[key] !== row[key]) await pick(this.page, cell(key), String(row[key]));
    for (const key of keys.filter((k) => kinds[k] === 'text')) if (row[key] !== undefined && row[key] !== '' && current[key] !== row[key]) await typeText(this.page, cell(key), String(row[key]));
    for (const key of keys.filter((k) => kinds[k] === 'check')) if (row[key] !== undefined && current[key] !== row[key]) await check(this.page, cell(key), row[key] === true);
  }

  /** The rows of a list the build sets as a whole, on an element that has none yet. */
  private async newRows(id: string, rows: Array<Record<string, unknown>>, keys: string[]): Promise<void> {
    if ((await this.rows(id, keys)).length > 0) throw new Error(`the UI driver sets ${id} on an element without rows only`);
    await this.addRows(id, rows, keys);
  }

  /** Adds rows at the end of a rows entry ("+ Add ..."), one after the other. */
  private async addRows(id: string, rows: Array<Record<string, unknown>>, keys: string[]): Promise<void> {
    for (const row of rows) {
      const index = (await this.rows(id, keys)).length;
      await addRow(this.page, id);
      await expect(panel(this.page).locator(`[data-entry-id="${id}[${index}]"]`)).toHaveCount(1);
      await this.fillRow(id, index, row, keys);
    }
  }

  /** An input or output mapping replaced by `value`: rows of other names are removed, the others updated or added. */
  private async mappingRows(id: string, value: Record<string, { type: string; value: unknown }>): Promise<void> {
    const keys = ['target', 'type', 'value'];
    const wanted = Object.entries(value).map(([target, m]) => ({ target, type: m.type.toUpperCase(), value: m.type.toUpperCase() === 'VARIABLE' ? String(m.value) : m.type.toUpperCase() === 'JSONPATCH' ? JSON.stringify(m.value) : valueText(m.value) }));
    const current = await this.rows(id, keys);
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (!wanted.some((w) => w.target === current[i]!['target'])) await this.removeRow(id, i);
    }
    const kept = await this.rows(id, keys);
    for (const row of wanted) {
      const index = kept.findIndex((r) => r['target'] === row.target);
      if (index >= 0) await this.fillRow(id, index, row, keys, kept[index]);
      else await this.addRows(id, [row], keys);
    }
  }

  private async constantRows(value: Record<string, unknown>): Promise<void> {
    const id = 'constants.values';
    const wanted = Object.entries(value).map(([name, v]) => ({ name, value: valueText(v) }));
    const current = await this.rows(id, ['name', 'value']);
    for (let i = current.length - 1; i >= 0; i -= 1) if (!wanted.some((w) => w.name === current[i]!['name'])) await this.removeRow(id, i);
    const kept = await this.rows(id, ['name', 'value']);
    for (const row of wanted) {
      const index = kept.findIndex((r) => r['name'] === row.name);
      if (index >= 0) await this.fillRow(id, index, row, ['name', 'value'], kept[index]);
      else await this.addRows(id, [row], ['name', 'value']);
    }
  }

  private async removeRow(id: string, index: number): Promise<void> {
    const before = (await this.rows(id, [])).length;
    await panel(this.page).locator(`[data-testid="${id}[${index}]-remove"]`).click();
    const anyway = panel(this.page).locator(`[data-testid="${id}[${index}]-remove-anyway"]`);
    if (await anyway.isVisible()) await anyway.click();
    await expect.poll(async () => (await this.rows(id, [])).length).toBe(before - 1);
  }

  /** The Process variables group: a row per variable, found by name or added at the end. */
  private async declareVariables(variables: Array<Record<string, unknown>>): Promise<void> {
    const id = 'variables.list';
    const keys = ['name', 'type', 'required', 'value'];
    for (const variable of variables) {
      const unknown = Object.keys(variable).filter((k) => !keys.includes(k));
      if (unknown.length > 0) throw new Error(`the UI driver does not set ${unknown.join(', ')} of a process variable`);
      const rows = await this.rows(id, keys);
      let index = rows.findIndex((r) => r['name'] === variable['name']);
      if (index < 0) {
        index = rows.length;
        await addRow(this.page, id);
        await expect(panel(this.page).locator(`[data-entry-id="${id}[${index}]"]`)).toHaveCount(1);
        await typeText(this.page, `${id}[${index}].name`, String(variable['name']));
      }
      if (variable['type'] !== undefined) await pick(this.page, `${id}[${index}].type`, String(variable['type']));
      if (variable['required'] !== undefined) await check(this.page, `${id}[${index}].required`, variable['required'] === true);
      if (variable['value'] !== undefined) await typeText(this.page, `${id}[${index}].value`, typeof variable['value'] === 'string' ? variable['value'] : JSON.stringify(variable['value']));
    }
  }

  /** A list group (messages, errors): "+" in the group header adds an item, whose fields are typed. */
  private async listItems(group: string, id: string, items: Array<Record<string, unknown>>, keys: string[]): Promise<void> {
    if ((await this.listLength(id)) > 0) throw new Error(`the UI driver sets ${id} on an element without items only`);
    for (const item of items) {
      const index = await this.listLength(id);
      await addListItem(this.page, group);
      await expect(entry(this.page, `${id}[${index}]`)).toHaveCount(1);
      for (const key of keys) if (item[key] !== undefined) await typeText(this.page, `${id}[${index}].${key}`, String(item[key]));
    }
  }

  private async listLength(id: string): Promise<number> {
    return panel(this.page).locator('[data-entry-id]').evaluateAll((els, prefix) => els.filter((e) => new RegExp(`^${prefix.replace(/[.[\]]/g, '\\$&')}\\[\\d+\\]$`).test(e.getAttribute('data-entry-id') ?? '')).length, id);
  }

  /** Task and execution listeners: an item per listener (event, type, implementation), with its fields. */
  private async listeners(key: 'listeners.task' | 'listeners.execution', listeners: Array<Record<string, unknown>>): Promise<void> {
    const group = key === 'listeners.task' ? 'taskListeners' : 'executionListeners';
    if ((await this.listLength(key)) > 0) throw new Error(`the UI driver sets ${key} on an element without listeners only`);
    for (const listener of listeners) {
      const { event, fields, ...implementation } = listener;
      const kinds = Object.keys(implementation);
      if (kinds.length !== 1 || !['class', 'expression', 'delegateExpression'].includes(kinds[0]!)) throw new Error(`the UI driver sets listeners with one of class, expression and delegateExpression, not ${kinds.join(', ')}`);
      const kind = kinds[0]!;
      const index = await this.listLength(key);
      const base = `${key}[${index}]`;
      await addListItem(this.page, group);
      await expect(entry(this.page, base)).toHaveCount(1);
      await pick(this.page, `${base}.event`, String(event));
      if (kind !== 'class') await pick(this.page, `${base}.type`, kind);
      await typeText(this.page, `${base}.${kind}`, String(implementation[kind]));
      if (fields) await this.addRows(`${base}.fields`, (fields as Array<Record<string, unknown>>).map(fieldRow), ['name', 'kind', 'value']);
    }
  }

  /**
   * The Decision group of a decision task. Choosing the decision maps what it reads and returns; a decision whose outputs the build maps
   * itself is named in the "Decision id" field instead, and "Map the inputs" maps its inputs. The variables for "a rule matched" and
   * the matched rules are output rows of the mapping.
   */
  private async pickDecision(pickValue: { decision: string; inputs?: boolean; outputs?: boolean; matched?: string; matchedRules?: string }): Promise<void> {
    const { decision, inputs, outputs, matched, matchedRules, ...rest } = pickValue;
    if (Object.keys(rest).length > 0 || inputs === false) throw new Error(`the UI driver does not pick a decision with ${JSON.stringify(pickValue)}`);
    if (outputs === false) {
      await typeText(this.page, 'decision.table', decision);
      await panel(this.page).locator('[data-testid="decision.pick.actions.inputs"]').click();
    } else {
      const file = this.decisionFiles.get(decision);
      if (!file) throw new Error(`the decision ${decision} is in no DMN file this build made`);
      if ((await valueOf(this.page, 'decision.pick.file')) !== file) await pick(this.page, 'decision.pick.file', file);
      await pick(this.page, 'decision.pick', decision);
    }
    await expect(entry(this.page, 'decision.info.summary')).toHaveCount(1);
    const rows: Record<string, { type: string; value: unknown }> = {};
    if (matched) rows[matched] = { type: 'VARIABLE', value: DMN_MATCHED };
    if (matchedRules) rows[matchedRules] = { type: 'VARIABLE', value: DMN_MATCHED_RULES };
    const current = await this.rows('mapping.outputs', ['target', 'type', 'value']);
    for (const [target, m] of Object.entries(rows)) if (!current.some((r) => r['target'] === target)) await this.addRows('mapping.outputs', [{ target, type: m.type, value: m.value }], ['target', 'type', 'value']);
  }

  // --- the DRD ---------------------------------------------------------------------------------------------------------------------

  private drdCanvas(): Locator {
    return activePanel(this.page).getByTestId('dmn-canvas');
  }

  private drdElement(id: string): Locator {
    return this.drdCanvas().locator(`.djs-element[data-element-id="${id}"]`);
  }

  private async drdShapeIds(): Promise<string[]> {
    return this.drdCanvas().locator('.djs-element.djs-shape[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? ''));
  }

  private async drdConnectionIds(): Promise<string[]> {
    return this.drdCanvas().locator('.djs-element.djs-connection[data-element-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-element-id') ?? ''));
  }

  /** A click on a shape of the DRD until it is selected (the ghost click trap, see `select`). */
  private async drdSelect(id: string): Promise<void> {
    const gfx = this.drdElement(id);
    if (await isSelected(gfx)) return;
    await this.drdEndEditing();
    for (let attempt = 0; attempt < 2 && !(await isSelected(gfx)); attempt += 1) {
      const point = await this.screenOf(this.drdCanvas(), centre(await this.boxOf(gfx)));
      await this.page.mouse.click(point.x, point.y);
    }
    await expect(gfx).toHaveClass(/\bselected\b/);
    await expect(this.page.locator('#properties-panel-slot [data-entry-id="id"] input')).toHaveValue(id);
  }

  private async drdSelectRoot(): Promise<void> {
    await this.drdEndEditing();
    const spot = await this.emptySpot(this.drdCanvas());
    await this.page.mouse.click(spot.x, spot.y);
    await expect(this.drdCanvas().locator('.djs-element.selected')).toHaveCount(0);
  }

  private async drdEndEditing(): Promise<void> {
    const editing = this.drdCanvas().locator('.djs-direct-editing-parent');
    if (await editing.isVisible()) {
      await this.page.keyboard.press('Escape');
      await expect(editing).toBeHidden();
    }
  }

  /** A palette tool of the DRD, then a click where the shape goes. */
  private async drdPlace(tool: string, at: Point): Promise<string> {
    const point = await this.screenOf(this.drdCanvas(), at);
    const before = new Set(await this.drdShapeIds());
    await this.drdEndEditing();
    await this.drdCanvas().locator(`.djs-palette [data-action="${tool}"]`).click();
    await this.dropAt(point, 5);
    let created = '';
    await expect.poll(async () => {
      const fresh = (await this.drdShapeIds()).filter((s) => !before.has(s));
      created = fresh[0] ?? '';
      return fresh.length;
    }, { message: `a ${tool} at ${at.x},${at.y}` }).toBe(1);
    await this.drdEndEditing();
    return created;
  }

  /** The replace menu of the DRD's context pad: the decision becomes a decision table (dmn-js gives the new element the old id); its view appears above the canvas. */
  private async drdReplace(id: string, replaceEntry: string): Promise<void> {
    await this.drdSelect(id);
    const views = activePanel(this.page).getByTestId('dmn-views').getByRole('tab');
    const before = await views.count();
    await activePanel(this.page).locator('.djs-context-pad .entry[data-action="replace"]').click();
    await this.page.locator(`.djs-popup .entry[data-id="${replaceEntry}"]`).click();
    await expect(views).toHaveCount(before + 1);
  }

  /** A text field of the DRD's panel (`id`, `name`), left with Tab. */
  private async drdText(entryId: string, text: string): Promise<void> {
    const field = this.page.locator(`#properties-panel-slot [data-entry-id="${entryId}"]`).locator('input, textarea').first();
    await field.fill(text);
    await this.page.keyboard.press('Tab');
    await expect(field).toHaveValue(text);
  }

  private async drdIdentify(current: string, id: string, name: string): Promise<void> {
    await this.drdSelect(current);
    await this.drdText('name', name);
    if (current !== id) {
      await this.drdText('id', id);
      await expect(this.drdElement(id)).toHaveCount(1);
    }
  }

  /** The type of the variable of the selected decision or input data (Variable group). */
  private async drdVariableType(typeRef: string): Promise<void> {
    const select = this.page.locator('#properties-panel-slot [data-entry-id="typeRef"] select');
    await select.selectOption(typeRef);
    await expect(select).toHaveValue(typeRef);
  }

  /** The chip of a view above the canvas, by its label: `DRD`, or the name of a decision and the kind of its logic. */
  private async openView(label: string): Promise<void> {
    const chip = activePanel(this.page).getByTestId('dmn-views').getByRole('tab', { name: label, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-selected', 'true');
  }

  // --- the decision table ------------------------------------------------------------------------------------------------------------

  /** Replaces the text of a field of the column editor: click, select all, insert (inserted at once: the FEEL editor would close brackets as they are typed). */
  private async replaceText(field: Locator, text: string): Promise<void> {
    await field.click();
    await this.page.keyboard.press('Control+A');
    if (text === '') await this.page.keyboard.press('Delete');
    else await this.page.keyboard.insertText(text);
  }

  /** The type of the column in the column editor (a dmn-js select). */
  private async columnType(typeRef: string): Promise<void> {
    const field = columnPopup(this.page).locator('.type-ref-edit-select .dms-input');
    await field.click();
    await this.page.locator(`.dms-select-options .option[data-value="${typeRef}"]`).click();
    await expect(field).toHaveValue(typeRef);
  }

  private async allowedValues(values: string[]): Promise<void> {
    await columnPopup(this.page).locator('.allowed-values-edit input').fill(values.join(','));
    await this.page.keyboard.press('Enter');
  }

  /** The column editor of an input: label, expression, type, allowed values. */
  private async editInput(index: number, spec: DmnInputSpec): Promise<void> {
    await openColumnEditor(inputHeader(this.page, index));
    const popup = columnPopup(this.page);
    if (spec.label !== undefined) await this.replaceText(popup.locator('[aria-label="Input label"]'), spec.label);
    await this.replaceText(popup.locator('[aria-label="Input expression"]'), spec.expression);
    await inputSettled(this.page);
    if (spec.typeRef) await this.columnType(spec.typeRef);
    if (spec.allowedValues) await this.allowedValues(spec.allowedValues);
    await inputSettled(this.page);
    await this.page.keyboard.press('Escape');
    await leaveCell(this.page);
    if (spec.label !== undefined) await expect(inputHeader(this.page, index).locator('.input-label')).toHaveText(spec.label);
  }

  /** The column editor of an output: name, label, type, allowed values. */
  private async editOutput(index: number, spec: DmnOutputSpec): Promise<void> {
    await openColumnEditor(outputHeader(this.page, index));
    const popup = columnPopup(this.page);
    if (spec.label !== undefined) await this.replaceText(popup.locator('[aria-label="Output label"]'), spec.label);
    if (spec.name !== undefined) await popup.locator('[aria-label="Output name"]').fill(spec.name);
    await inputSettled(this.page);
    if (spec.typeRef) await this.columnType(spec.typeRef);
    if (spec.allowedValues) await this.allowedValues(spec.allowedValues);
    await inputSettled(this.page);
    await this.page.keyboard.press('Escape');
    await leaveCell(this.page);
    if (spec.name !== undefined) await expect(outputHeader(this.page, index).locator('.output-name')).toHaveText(spec.name);
  }

  /** A rule at the end of the table, its cells typed; its id is set in the XML source when the file is finished. */
  private async addRule(file: Extract<OpenFile, { kind: 'dmn' }>, rule: DmnRuleSpec, columns: number): Promise<void> {
    if (rule.annotation !== undefined) throw new Error('the UI driver does not type rule annotations');
    const texts = [...rule.inputs, ...rule.outputs];
    if (texts.length !== columns) throw new Error(`rule ${rule.id} has ${texts.length} entries, the table has ${columns} columns`);
    await addRuleAtEnd(this.page);
    const id = (await ruleIds(this.page)).at(-1)!;
    const cols = await activePanel(this.page).locator('th.input-cell, th.output-cell').evaluateAll((els) => els.map((e) => e.getAttribute('data-col-id') ?? ''));
    for (const [i, text] of texts.entries()) {
      const cell = cellEditor(this.page, id, cols[i]!);
      await cell.click();
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.insertText(text);
    }
    await leaveCell(this.page);
    file.ruleIds.push([id, rule.id]);
  }

  /** The rules get the ids the build gives them, in the XML source of the DMN file (dmn-js has no field for the id of a rule). */
  private async renameRules(file: Extract<OpenFile, { kind: 'dmn' }>): Promise<void> {
    const pending = file.ruleIds.filter(([generated, wanted]) => generated !== wanted);
    if (pending.length === 0) return;
    await this.replaceInSource('dmn', pending.map(([generated, wanted]) => [`<rule id="${generated}">`, `<rule id="${wanted}">`]));
    await this.drdCanvas().locator('.djs-container svg .djs-element.djs-shape').first().waitFor();
  }

  /**
   * Edits the XML source of the open file (the XML tab under the canvas): the search and replace of the code editor (Ctrl+F) swaps
   * each text for its replacement, then the tab of the model applies the source. Each text must occur once.
   */
  private async replaceInSource(kind: 'bpmn' | 'dmn', pairs: Array<[from: string, to: string]>): Promise<void> {
    const views = activePanel(this.page).locator('.view-switch');
    await views.getByRole('tab', { name: 'XML' }).click();
    const editor = activePanel(this.page).getByTestId(kind === 'bpmn' ? 'xml-editor' : 'dmn-xml-editor').locator('.cm-content');
    await editor.click();
    await this.page.keyboard.press('Control+F');
    const search = activePanel(this.page).locator('.cm-search');
    const status = activePanel(this.page).getByTestId(kind === 'bpmn' ? 'xml-status' : 'dmn-xml-status');
    for (const [from, to] of pairs) {
      // the panel takes the query on a key press
      await search.locator('input[name="search"]').fill(from);
      await search.locator('input[name="search"]').press('End');
      await search.locator('input[name="replace"]').fill(to);
      await search.locator('input[name="replace"]').press('End');
      await search.locator('button[name="replaceAll"]').click();
      await expect(status).toHaveText('Unapplied changes');
    }
    await views.getByRole('tab', { name: kind === 'bpmn' ? 'Diagram' : 'Model' }).click();
    await expect(activePanel(this.page).getByTestId(kind === 'bpmn' ? 'xml-view' : 'dmn-xml-view')).toHaveCount(0);
  }

  /**
   * The panel offers no output collection on a multi-instance call activity (the engine gives nothing back from the children, engine
   * finding C11.1, user guide "Multi-instance"); the C11 seed has one to prove that. It goes into the XML source of the process: the
   * element is added to the loop of the call activity.
   */
  private async loopOutputInSource(elementId: string, key: string, value: string): Promise<void> {
    const xml = await this.page.evaluate(async () => {
      const api = (window as unknown as { __modelerTestApi: { ready(): Promise<void>; currentXml(): Promise<string> } }).__modelerTestApi;
      await api.ready();
      return api.currentXml();
    });
    const element = new RegExp(`<bpmn:callActivity id="${elementId}"[\\s\\S]*?</bpmn:callActivity>`).exec(xml)?.[0];
    const start = element ? /<bpmn:multiInstanceLoopCharacteristics\b[^>]*>/.exec(element)?.[0] : undefined;
    if (!start) throw new Error(`${elementId}: no multi-instance loop in the XML of the process`);
    if (xml.split(start).length !== 2) throw new Error(`${elementId}: the loop ${start} is not the only one of its kind in the XML`);
    const child = key === 'mi.outputCollection' ? `<bpmn:loopDataOutputRef>${value}</bpmn:loopDataOutputRef>` : `<bpmn:outputDataItem name="${value}" />`;
    const replacement = start.endsWith('/>') ? `${start.replace(/\s*\/>$/, '>')}${child}</bpmn:multiInstanceLoopCharacteristics>` : `${start}${child}`;
    await this.replaceInSource('bpmn', [[start, replacement]]);
    await this.bpmnCanvas().locator(`.djs-element[data-element-id="${elementId}"]`).waitFor();
  }
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A field of a class or delegate task (or listener) as a row: name, Text or Expression, value. */
function fieldRow(field: Record<string, unknown>): Record<string, unknown> {
  return field['expression'] !== undefined ? { name: field['name'], kind: 'expression', value: field['expression'] } : { name: field['name'], kind: 'string', value: field['string'] };
}

/** An in or out parameter of a call activity as a row: from a variable or an expression, the target. */
function parameterRow(parameter: Record<string, unknown>): Record<string, unknown> {
  return parameter['sourceExpression'] !== undefined ? { kind: 'sourceExpression', value: parameter['sourceExpression'], target: parameter['target'] } : { kind: 'source', value: parameter['source'], target: parameter['target'] };
}
