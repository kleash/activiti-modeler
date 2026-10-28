import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Page } from '@playwright/test';

/** A file of an exported project, addressed by its project-relative path. */
export interface ExportedFile {
  path: string;
  content: string;
}

export interface ExportedProject {
  files: ExportedFile[];
  warnings: string[];
}

/** The report of a Camunda 7 conversion (`LossReport` of activiti-project, as far as the tests read it). */
export interface CamundaLossReport {
  source: string;
  general: string[];
  entries: Array<{ kind: 'dropped' | 'approximated' | 'info'; elementId: string; elementName?: string; elementType: string; item: string; what: string; why: string }>;
  converted: Array<{ elementId: string; elementType: string; from: string; to: string }>;
  counts: { converted: number; dropped: number; approximated: number; info: number };
}

/** Parameters of a shape, as `window.__modelerTestApi.createShape` takes them. */
export interface ShapeOptions {
  type: string;
  id?: string;
  name?: string;
  parent?: string;
  at?: { x: number; y: number };
  after?: string;
  dy?: number;
  eventDefinition?: string;
  interrupting?: boolean;
  attachedTo?: string;
  isExpanded?: boolean;
  size?: { width: number; height: number };
  triggeredByEvent?: boolean;
  attrs?: Record<string, unknown>;
  allowHidden?: boolean;
  /** Pools: the process of a pool after the first (the first pool takes over the open process). */
  process?: { id: string; name?: string; documentation?: string };
  /** Pools: a collapsed pool without a process. */
  blackBox?: boolean;
}

/** A value for `setModdleProperty`: plain, `{ ref }` (element or root element by id) or `{ root, name }` (root element by name, created when missing). */
export type ModdleValue = string | number | boolean | undefined | { ref: string } | { root: string; name: string };

export interface FlowOptions {
  id?: string;
  type?: string;
  name?: string;
  attrs?: Record<string, unknown>;
}

export interface ExtensionsOptions {
  elementId?: string;
  mapping?: unknown;
  mappingType?: string;
  inputs?: Record<string, { type: string; value: unknown }>;
  outputs?: Record<string, { type: string; value: unknown; declareType?: string }>;
  constants?: Record<string, unknown>;
  properties?: Array<Record<string, unknown>>;
}

/** The specs of the DMN part of the test API (`app/src/dmnTestApi.ts`). */
export interface DmnPosition {
  x: number;
  y: number;
}

export interface DmnInputSpec {
  label?: string;
  expression: string;
  typeRef?: string;
  allowedValues?: string[];
}

export interface DmnOutputSpec {
  name?: string;
  label?: string;
  typeRef?: string;
  allowedValues?: string[];
}

export interface DmnRuleSpec {
  id: string;
  inputs: string[];
  outputs: string[];
  annotation?: string;
}

export interface DmnTableSpec {
  id: string;
  name?: string;
  variableType?: string;
  hitPolicy?: string;
  aggregation?: string;
  inputs: DmnInputSpec[];
  outputs: DmnOutputSpec[];
  rules: DmnRuleSpec[];
  at?: DmnPosition;
}

export interface DmnLiteralSpec {
  id: string;
  name?: string;
  variableType?: string;
  expression: string;
  expressionType?: string;
  at?: DmnPosition;
}

export interface DmnInputDataSpec {
  id: string;
  name?: string;
  typeRef?: string;
  at?: DmnPosition;
}

export interface DmnBkmSpec {
  id: string;
  name?: string;
  variableType?: string;
  parameters?: Array<{ name: string; typeRef?: string }>;
  expression: string;
  expressionType?: string;
  at?: DmnPosition;
}

export interface DmnContextSpec {
  id: string;
  name?: string;
  variableType?: string;
  entries: Array<{ name?: string; typeRef?: string; expression?: string; invocation?: { function: string; bindings: Array<{ parameter: string; expression: string }> } }>;
  at?: DmnPosition;
}

/**
 * What the corpus builds that also run through the real UI call (C01, C02, C04, C08, C11, C16, C20-loan): `ModelerApi` gives it through
 * the test API, `UiModeler` (`uiModeler.ts`) through clicks and typing.
 */
export type CorpusModeler = Pick<
  ModelerApi,
  'createProject' | 'newProcess' | 'createShape' | 'connect' | 'setProperty' | 'setExtensions' | 'addConnector' | 'addExtensionElement' | 'createDmn' | 'addInputData' | 'addDecisionTable' | 'addRequirement'
>;

/**
 * Typed wrapper around `window.__modelerTestApi` (built into the app when VITE_MODELER_TEST_API=true). Corpus
 * `build.ts` files drive the real modeler through it; `writeProject` puts the exported files on disk.
 */
export class ModelerApi {
  private constructor(private readonly page: Page) {}

  /** Opens the app and waits for the editor and the test API. */
  static async open(page: Page, url = '/'): Promise<ModelerApi> {
    await page.goto(url);
    return ModelerApi.attach(page);
  }

  /**
   * Takes the test API of the page as it is, without loading the app again. `ready` waits for the editor of the visible tab, so
   * the visible tab must be a diagram. (A reload shows the tab that was visible when the session was last written, and the app writes
   * it a moment after a tab is chosen: a reload right after choosing a tab can show the tab before, and `ready` then never returns.)
   */
  static async attach(page: Page): Promise<ModelerApi> {
    await page.waitForFunction(() => '__modelerTestApi' in window);
    const api = new ModelerApi(page);
    await api.call('ready');
    return api;
  }

  private call<T = void>(method: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(
      ([name, params]) => {
        const target = (window as unknown as { __modelerTestApi: Record<string, (...a: unknown[]) => unknown> }).__modelerTestApi;
        return Promise.resolve(target[name as string]!(...(params as unknown[]))) as Promise<never>;
      },
      [method, args] as const,
    );
  }

  /**
   * `defaultMappings: 'none'` switches off the `MAP_ALL` that new user tasks, call activities and message catch events get (and the
   * `MAP_ALL_OUTPUTS` of a multi-instance user task); signal catch events never get one.
   */
  createProject(name: string, options?: { version?: string; defaultMappings?: 'mapAll' | 'none' }): Promise<void> {
    return this.call('createProject', name, options);
  }

  /** `omitExtensions`: the project gets no `-extensions.json` for this process (it must have no variables, mappings or constants), so the engine has no entry for it. */
  newProcess(id: string, name?: string, options?: { file?: string; omitExtensions?: boolean }): Promise<void> {
    return this.call('newProcess', id, name, options);
  }

  openProcess(file: string): Promise<void> {
    return this.call('openProcess', file);
  }

  /** Creates a shape and returns its id. */
  createShape(options: ShapeOptions): Promise<string> {
    return this.call('createShape', options);
  }

  /** Creates a shape right of another one and connects them; returns both ids. */
  appendShape(sourceId: string, options: ShapeOptions, flow?: FlowOptions): Promise<{ id: string; flow: string }> {
    return this.call('appendShape', sourceId, options, flow);
  }

  connect(source: string, target: string, id?: string, attrs?: Omit<FlowOptions, 'id'>): Promise<string> {
    return this.call('connect', source, target, id, attrs);
  }

  /** Sets a property through the accessor of that key (the same code the properties panel uses). */
  setProperty(elementId: string, accessorKey: string, value: unknown): Promise<void> {
    return this.call('setProperty', elementId, accessorKey, value);
  }

  /** Adds a moddle element to the extension elements of an element, bypassing the accessors' applicability check (a construct the panel does not offer). */
  addExtensionElement(elementId: string, type: string, properties?: Record<string, unknown>): Promise<void> {
    return this.call('addExtensionElement', elementId, type, properties);
  }

  /** Adds a lane to a pool; returns its id. The first lane of a pool makes two (`first` names the one that takes over the pool's content). */
  createLane(participantId: string, options?: { id?: string; name?: string; position?: 'top' | 'bottom'; first?: { id?: string; name?: string } }): Promise<string> {
    return this.call('createLane', participantId, options);
  }

  /** Deletes elements, like selecting them and pressing Delete. */
  removeElements(elementIds: string[]): Promise<void> {
    return this.call('removeElements', elementIds);
  }

  /** Adds a root element (`dataStore`, `message`, ...) to the definitions; returns its id. */
  addRootElement(type: string, attrs?: Record<string, unknown>): Promise<string> {
    return this.call('addRootElement', type, attrs);
  }

  /** Sets one business object property through the modeling command; for what the properties panel has no accessor for (message flow `messageRef`, `dataStoreRef`, the id of a collaboration). */
  setModdleProperty(elementId: string, property: string, value: ModdleValue): Promise<void> {
    return this.call('setModdleProperty', elementId, property, value);
  }

  /** Colours elements the way the colour picker does. */
  setColor(elementIds: string[], colors: { fill?: string; stroke?: string }): Promise<void> {
    return this.call('setColor', elementIds, colors);
  }

  getProperty<T = unknown>(elementId: string, accessorKey: string): Promise<T> {
    return this.call('getProperty', elementId, accessorKey);
  }

  /** Selects an element, as a click on the canvas does; without an id the process. */
  select(elementId?: string): Promise<void> {
    return this.call('select', elementId);
  }

  setExtensions(options: ExtensionsOptions): Promise<void> {
    return this.call('setExtensions', options);
  }

  /** Opens a BPMN file the way the editor opens one; `file` is its name in the project (without `.bpmn20.xml`), the process id by default. */
  importXml(xml: string, extensionsJson?: string, options?: { file?: string }): Promise<{ warnings: string[] }> {
    return this.call('importXml', xml, extensionsJson, options);
  }

  /** Imports a Camunda 7 model like the editor's "Convert to Activiti": converted, opened, with the report of what was lost (feature U17). */
  importCamunda(xml: string, options?: { fileName?: string; defaultMappings?: 'mapAll' | 'none' }): Promise<{ converted: boolean; warnings: string[]; report: CamundaLossReport; xml: string; extensionsJson?: string }> {
    return this.call('importCamunda', xml, options);
  }

  addDmn(name: string, content: string): Promise<void> {
    return this.call('addDmn', name, content);
  }

  // --- DMN: real dmn-js modeling commands on a hidden modeler (app/src/dmnTestApi.ts) --------------------------------------------

  /** Starts `processes/<name>.dmn`; `id` and `definitionsName` are those of `definitions`. */
  createDmn(name: string, options?: { id?: string; definitionsName?: string }): Promise<void> {
    return this.call('createDmn', name, options);
  }

  addDecisionTable(dmn: string, spec: DmnTableSpec): Promise<string> {
    return this.call('addDecisionTable', dmn, spec);
  }

  addLiteralDecision(dmn: string, spec: DmnLiteralSpec): Promise<string> {
    return this.call('addLiteralDecision', dmn, spec);
  }

  addContextDecision(dmn: string, spec: DmnContextSpec): Promise<string> {
    return this.call('addContextDecision', dmn, spec);
  }

  addInputData(dmn: string, spec: DmnInputDataSpec): Promise<string> {
    return this.call('addInputData', dmn, spec);
  }

  addBusinessKnowledgeModel(dmn: string, spec: DmnBkmSpec): Promise<string> {
    return this.call('addBusinessKnowledgeModel', dmn, spec);
  }

  addKnowledgeSource(dmn: string, spec: { id: string; name?: string; at?: DmnPosition }): Promise<string> {
    return this.call('addKnowledgeSource', dmn, spec);
  }

  addTextAnnotation(dmn: string, spec: { id: string; text: string; at?: DmnPosition }): Promise<string> {
    return this.call('addTextAnnotation', dmn, spec);
  }

  /** Connects two elements of the DRD; the kind of requirement follows from them. Returns the connection's id. */
  addRequirement(dmn: string, sourceId: string, targetId: string, type?: 'information' | 'knowledge' | 'authority'): Promise<string> {
    return this.call('addRequirement', dmn, sourceId, targetId, type);
  }

  setHitPolicy(dmn: string, decisionId: string, hitPolicy: string, aggregation?: string): Promise<void> {
    return this.call('setHitPolicy', dmn, decisionId, hitPolicy, aggregation);
  }

  addTableInput(dmn: string, decisionId: string, spec: DmnInputSpec): Promise<void> {
    return this.call('addTableInput', dmn, decisionId, spec);
  }

  addTableOutput(dmn: string, decisionId: string, spec: DmnOutputSpec): Promise<void> {
    return this.call('addTableOutput', dmn, decisionId, spec);
  }

  addTableRule(dmn: string, decisionId: string, spec: DmnRuleSpec): Promise<void> {
    return this.call('addTableRule', dmn, decisionId, spec);
  }

  renameDmnElement(dmn: string, elementId: string, change: { id?: string; name?: string }): Promise<void> {
    return this.call('renameDmnElement', dmn, elementId, change);
  }

  /** Opens an existing DMN file as the editor does (a 1.1 / 1.2 file is migrated with `@bpmn-io/dmn-migrate` first); `migratedFrom` names the old version. */
  openDmn(name: string, xml: string): Promise<{ migratedFrom?: string; warnings: string[] }> {
    return this.call('openDmn', name, xml);
  }

  /** The DMN as the modeler would save it. */
  currentDmnXml(dmn: string): Promise<string> {
    return this.call('currentDmnXml', dmn);
  }

  /** Undoes the last command of the view that is open (a table after the operations on a table, the DRD after those on the DRD). */
  undoDmn(dmn: string): Promise<void> {
    return this.call('undoDmn', dmn);
  }

  /** Differences between a seed DMN and a generated one (ids that are no contract, the diagram and the order of requirements are ignored). */
  diffDmn(expectedXml: string, actualXml: string, options?: { allow?: string[] }): Promise<string[]> {
    return this.call('diffDmn', expectedXml, actualXml, options);
  }

  addConnector(name: string, content: string): Promise<void> {
    return this.call('addConnector', name, content);
  }

  /** Replaces the connector of that name (adds it when there is none), as saving an edited `connectors/<name>.json` does. */
  setConnector(name: string, content: string): Promise<void> {
    return this.call('setConnector', name, content);
  }

  removeConnector(name: string): Promise<void> {
    return this.call('removeConnector', name);
  }

  undo(): Promise<void> {
    return this.call('undo');
  }

  redo(): Promise<void> {
    return this.call('redo');
  }

  /** The BPMN XML of the open diagram as it is now (not verified or moved to the origin). */
  currentXml(): Promise<string> {
    return this.call('currentXml');
  }

  elementIds(): Promise<string[]> {
    return this.call('elementIds');
  }

  /** The connector actions in the catalog of the open diagram (`connector.ACTION`): the element templates it offers. */
  catalogActions(): Promise<string[]> {
    return this.call('catalogActions');
  }

  /** Runs the real export pipeline (serializer checks included); rejects with the verification error when a guarantee is broken. */
  exportProject(): Promise<ExportedProject> {
    return this.call('exportProject');
  }

  /** Differences between a seed BPMN and a generated one, ignoring layout, prefixes and attribute order; empty when they are the same model. */
  diffBpmn(expectedXml: string, actualXml: string, options?: { ignoreElements?: string[] }): Promise<string[]> {
    return this.call('diffBpmn', expectedXml, actualXml, options);
  }

  /** Differences between a seed `-extensions.json` (`undefined`: none) and a generated one. */
  diffExtensions(expectedJson: string | undefined, actualJson: string | undefined): Promise<string[]> {
    return this.call('diffExtensions', expectedJson, actualJson);
  }

  /** Exports and writes every file below `directory`; returns the absolute paths written. */
  async writeProject(directory: string): Promise<{ paths: string[]; project: ExportedProject }> {
    const project = await this.exportProject();
    const paths: string[] = [];
    for (const file of project.files) {
      const target = join(directory, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
      paths.push(target);
    }
    return { paths, project };
  }
}
