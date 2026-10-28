/**
 * `window.__modelerTestApi`: programmatic modeling for the corpus `build.ts` files and the Playwright tests. It is built
 * into dev and test builds only (see main.tsx). Every call goes through the same property accessors and diagram-js
 * commands as the UI, and `exportProject()` uses the real export pipeline with its serializer checks.
 */
import {
  PROJECT_CHANGED, assertNcName, DiagramBuilder, exportProcess, importProcess, type ConnectSpec, type DefaultMappings, type ModdleValue, type ExtensionsStore, type ProjectCatalog, type ProjectCatalogData, type ShapeSpec, type VariableInput,
} from '@activiti-modeler/bpmn-js-activiti';
import { assembleProject, convertCamundaBpmn, diffBpmn, diffExtensions, type BpmnDiffOptions, type DmnFileInput, type LossReport, type ProcessVariablesMapping, type ProjectFile } from '@activiti-modeler/activiti-project';

import { CatalogBuilder, pushCatalog } from './catalog';
import { createDmnTestApi, type DmnTestApi } from './dmnTestApi';
import { type ActiveModeler, whenModelerReady } from './modelerRegistry';

interface StoredProcess {
  file: string;
  processId: string;
  xml: string;
  extensionsJson: string;
  /** Warnings of the export of this process (dropped extension fields, kept foreign elements). */
  warnings: string[];
  /** Write no `-extensions.json` for this process (it must have nothing to put in it). */
  omitExtensions: boolean;
}

export interface ExtensionsSpec {
  /** Element whose mapping / constants are set; omit for process-level `properties`. */
  elementId?: string;
  mapping?: ProcessVariablesMapping | null;
  mappingType?: string;
  inputs?: Record<string, { type: string; value: unknown }>;
  outputs?: Record<string, { type: string; value: unknown; declareType?: string }>;
  constants?: Record<string, unknown>;
  /** Process variables, added to (or updated by name in) the declared list; the variables declared for output mappings stay. */
  properties?: VariableInput[];
}

export interface TestApi extends DmnTestApi {
  /** Resolves when the editor is mounted. */
  ready(): Promise<void>;
  /**
   * Starts a project. `defaultMappings: 'none'` switches off the `MAP_ALL` that new user tasks, call activities and
   * message catch events get, and the `MAP_ALL_OUTPUTS` of a multi-instance user task (ADR 0006); the corpus builds use it to reproduce hand-written seeds exactly.
   */
  createProject(name: string, options?: { version?: string; defaultMappings?: DefaultMappings }): Promise<void>;
  /** Opens a new, empty executable process (no elements); the previous one is kept in the project. */
  newProcess(id: string, name?: string, options?: { file?: string; omitExtensions?: boolean }): Promise<void>;
  openProcess(file: string): Promise<void>;
  createShape(spec: ShapeSpec): string;
  appendShape(sourceId: string, spec: ShapeSpec, flow?: ConnectSpec): { id: string; flow: string };
  connect(source: string, target: string, id?: string, attrs?: Omit<ConnectSpec, 'id'>): string;
  setProperty(elementId: string, accessorKey: string, value: unknown): void;
  /** Adds a moddle element to the extension elements of an element, bypassing the accessors' applicability check (see `DiagramBuilder.addExtensionElement`). */
  addExtensionElement(elementId: string, type: string, properties?: Record<string, unknown>): void;
  getProperty(elementId: string, accessorKey: string): unknown;
  /** Adds a lane to a pool (see `DiagramBuilder.createLane`) and returns its id. */
  createLane(participantId: string, options?: { id?: string; name?: string; position?: 'top' | 'bottom'; first?: { id?: string; name?: string } }): string;
  /** Deletes elements through the modeling command. */
  removeElements(elementIds: string[]): void;
  /** Adds a root element (message, data store, ...) to the definitions and returns its id (see `DiagramBuilder.addRootElement`). */
  addRootElement(type: string, attrs?: Record<string, unknown>): string;
  /** Sets one business object property through the modeling command (see `DiagramBuilder.setModdleProperty`). */
  setModdleProperty(elementId: string, property: string, value: ModdleValue): void;
  /** Colours elements like the colour picker does. */
  setColor(elementIds: string[], colors: { fill?: string; stroke?: string }): void;
  setExtensions(spec: ExtensionsSpec): void;
  /** Selects an element (the properties panel follows the selection, like after a click on the canvas); no id selects the process. */
  select(elementId?: string): void;
  /** Opens a BPMN file the way the editor opens one; `file` is its name in the project (without `.bpmn20.xml`), the process id by default. */
  importXml(xml: string, extensionsJson?: string, options?: { file?: string }): Promise<{ warnings: string[] }>;
  /**
   * Imports a Camunda 7 model the way the editor's "Convert to Activiti" does (feature U17): the converter runs on the XML, the
   * converted diagram and its extensions are opened, and the report of what could not be translated comes back.
   */
  importCamunda(xml: string, options?: { fileName?: string; defaultMappings?: DefaultMappings }): Promise<{ converted: boolean; warnings: string[]; report: LossReport; xml: string; extensionsJson?: string }>;
  addDmn(name: string, content: string): Promise<void>;
  addConnector(name: string, content: string): Promise<void>;
  /** Replaces the connector of that name (adds it when there is none), like saving an edited `connectors/<name>.json`. */
  setConnector(name: string, content: string): Promise<void>;
  /** Removes `connectors/<name>.json` from the project. */
  removeConnector(name: string): Promise<void>;
  undo(): void;
  redo(): void;
  /** Ids of the elements of the open process. */
  elementIds(): string[];
  /** The connector actions in the catalog of the open diagram (`connector.ACTION`): the element templates it offers. */
  catalogActions(): string[];
  /** The current BPMN XML (not verified or moved to the origin). */
  currentXml(): Promise<string>;
  /** Runs the export pipeline over every process of the project and returns the files. */
  exportProject(): Promise<{ files: ProjectFile[]; warnings: string[] }>;
  /**
   * Semantic comparison of a seed against a generated file (the browser's DOMParser does the XML work); the entries
   * of the result say what differs, empty means the same model. Used by the corpus builds.
   */
  diffBpmn(expectedXml: string, actualXml: string, options?: BpmnDiffOptions): string[];
  diffExtensions(expectedJson: string | undefined, actualJson: string | undefined): string[];
}

declare global {
  interface Window {
    __modelerTestApi?: TestApi;
  }
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const fileNameFor = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+|[.-]+$/g, '') || 'process';

export function emptyProcessXml(id: string, name?: string): string {
  assertNcName('newProcess', id);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_${id}" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="${id}"${name ? ` name="${escapeAttr(name)}"` : ''} isExecutable="true" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_${id}">
    <bpmndi:BPMNPlane id="BPMNPlane_${id}" bpmnElement="${id}" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/** A process whose sidecar is left out must have nothing in it: an entry that carries variables, mappings or constants would be lost. */
function omittable(p: StoredProcess): { extensions?: undefined } {
  const file = JSON.parse(p.extensionsJson) as { extensions?: Record<string, { properties?: object; mappings?: object; constants?: object }> };
  for (const [id, ext] of Object.entries(file.extensions ?? {})) {
    if (Object.keys(ext.properties ?? {}).length + Object.keys(ext.mappings ?? {}).length + Object.keys(ext.constants ?? {}).length > 0) {
      throw new Error(`${p.file}: the extensions of ${id} are not empty, so the file cannot be left out`);
    }
  }
  return {};
}

export function createTestApi(): TestApi {
  let modeler: ActiveModeler | undefined;
  let project = { name: 'project', version: '1.0.0' };
  const processes = new Map<string, StoredProcess>();
  const dmn: DmnFileInput[] = [];
  const connectors: DmnFileInput[] = [];
  let current: { file: string; processId: string } | undefined;
  let builder: DiagramBuilder | undefined;
  /** Files whose project has no extensions sidecar (`newProcess(..., { omitExtensions: true })`). */
  const omit = new Set<string>();
  const catalogBuilder = new CatalogBuilder();
  const lastCatalog: { json?: string } = {};
  let ownedCatalog: ProjectCatalogData | undefined;
  const guarded = new WeakSet<object>();
  // the DMN files made with `createDmn` and the DMN operations (dmnTestApi.ts); they join the catalog and the export like `addDmn` files
  const dmnApi = createDmnTestApi(() => refreshCatalog());

  /** The connectors and DMN files added with `addConnector` / `addDmn` reach the pickers and templates of the open diagram. */
  async function refreshCatalog(): Promise<void> {
    if (!modeler) return;
    const generated = await dmnApi.files();
    const files = [
      ...connectors.map((c) => ({ path: `connectors/${c.name}.json`, content: c.content })),
      ...dmn.map((d) => ({ path: `processes/${d.name}.dmn`, content: d.content })),
      ...generated.files.map((d) => ({ path: `processes/${d.name}.dmn`, content: d.content })),
      ...[...processes.values()].map((p) => ({ path: `processes/${p.file}.bpmn20.xml`, content: p.xml })),
    ];
    ownedCatalog = catalogBuilder.build(files);
    pushCatalog(modeler.get<ProjectCatalog>('projectCatalog'), ownedCatalog, lastCatalog);
  }

  /**
   * The editor of the open tab also fills the catalog of its modeler, from the files of ITS workspace (debounced, after every change of the
   * workspace, and once the app has restored its session), and a project made through this API is not in that workspace: a late push of the
   * editor would replace the connectors and decisions of the test project with nothing, whenever the machine is slow enough. So the project of
   * the test API wins: when the catalog of the modeler stops being the one this API pushed, it is pushed again.
   */
  function keepCatalog(target: ActiveModeler): void {
    const bus = target.get<{ on(event: string, handler: () => void): void }>('eventBus');
    bus.on(PROJECT_CHANGED, () => {
      if (!ownedCatalog) return;
      const catalog = target.get<ProjectCatalog>('projectCatalog');
      const current = JSON.stringify({ connectors: catalog.connectors, dmn: catalog.dmn, processes: catalog.processes });
      if (current === JSON.stringify(ownedCatalog)) return;
      lastCatalog.json = undefined;
      pushCatalog(catalog, ownedCatalog, lastCatalog);
    });
  }

  const need = (): { modeler: ActiveModeler; builder: DiagramBuilder } => {
    if (!modeler || !builder) throw new Error('the editor is not ready; await __modelerTestApi.ready()');
    return { modeler, builder };
  };
  const currentProcess = (): { file: string; processId: string } => {
    if (!current) throw new Error('no process is open; call newProcess(id, name) first');
    return current;
  };

  async function flush(): Promise<void> {
    if (!current) return;
    const { modeler: m } = need();
    const exported = await exportProcess(m, current.file);
    processes.set(current.file, { file: current.file, processId: current.processId, xml: exported.xml, extensionsJson: exported.extensionsJson, warnings: exported.warnings, omitExtensions: omit.has(current.file) });
  }

  async function open(file: string, xml: string, extensionsJson: string | undefined, processId: string): Promise<void> {
    const { modeler: m } = need();
    const { warnings } = await importProcess(m, { xml, extensionsJson, name: file });
    if (warnings.length > 0) throw new Error(`import warnings: ${warnings.join('; ')}`);
    current = { file, processId };
  }

  const processIdOfXml = (xml: string): string => {
    const match = /<(?:\w+:)?process\b[^>]*\bid="([^"]+)"/.exec(xml);
    if (!match) throw new Error('the XML has no process');
    return match[1]!;
  };

  return {
    async ready() {
      modeler = await whenModelerReady();
      if (!guarded.has(modeler)) {
        guarded.add(modeler);
        keepCatalog(modeler);
      }
      builder = new DiagramBuilder(modeler);
    },

    async createProject(name, options = {}) {
      await this.ready();
      project = { name: fileNameFor(name), version: options.version ?? '1.0.0' };
      processes.clear();
      dmn.length = 0;
      connectors.length = 0;
      dmnApi.reset();
      current = undefined;
      need().modeler.get<ExtensionsStore>('extensionsStore').defaultMappings = options.defaultMappings ?? 'mapAll';
      await refreshCatalog();
    },

    async newProcess(id, name, options = {}) {
      await this.ready();
      await flush();
      const file = options.file ?? fileNameFor(name ?? id);
      if (processes.has(file) || current?.file === file) throw new Error(`a process file "${file}" already exists in the project`);
      if (options.omitExtensions) omit.add(file);
      else omit.delete(file);
      await open(file, emptyProcessXml(id, name), undefined, id);
    },

    async openProcess(file) {
      await this.ready();
      await flush();
      const stored = processes.get(file);
      if (!stored) throw new Error(`no process file "${file}" in the project`);
      await open(file, stored.xml, stored.extensionsJson, stored.processId);
    },

    createShape: (spec) => need().builder.createShape(spec),
    appendShape: (sourceId, spec, flow) => need().builder.appendShape(sourceId, spec, flow),
    connect: (source, target, id, attrs) => need().builder.connect(source, target, { ...attrs, ...(id ? { id } : {}) }),
    setProperty: (elementId, key, value) => need().builder.setProperty(elementId, key, value),
    addExtensionElement: (elementId, type, properties) => need().builder.addExtensionElement(elementId, type, properties),
    getProperty: (elementId, key) => need().builder.getProperty(elementId, key),
    createLane: (participantId, options) => need().builder.createLane(participantId, options),
    removeElements: (elementIds) => need().builder.removeElements(elementIds),
    addRootElement: (type, attrs) => need().builder.addRootElement(type, attrs),
    setModdleProperty: (elementId, property, value) => need().builder.setModdleProperty(elementId, property, value),
    setColor: (elementIds, colors) => need().builder.setColor(elementIds, colors),

    setExtensions(spec) {
      const { builder: b } = need();
      if (spec.properties) {
        // upsert by name, so variables declared automatically for output mappings are kept
        const root = currentProcess().processId;
        const merged = new Map((b.getProperty(root, 'variables.list') as VariableInput[]).map((v) => [v.name, v]));
        for (const variable of spec.properties) merged.set(variable.name, { ...merged.get(variable.name), ...variable });
        b.setProperty(root, 'variables.list', [...merged.values()]);
      }
      if (spec.elementId) {
        if (spec.mapping !== undefined) b.setMapping(spec.elementId, spec.mapping ?? undefined);
        if (spec.mappingType !== undefined) b.setProperty(spec.elementId, 'mapping.type', spec.mappingType);
        if (spec.inputs) b.setProperty(spec.elementId, 'mapping.inputs', spec.inputs);
        if (spec.outputs) b.setProperty(spec.elementId, 'mapping.outputs', spec.outputs);
        if (spec.constants) b.setProperty(spec.elementId, 'constants.values', spec.constants);
      }
    },

    select(elementId) {
      const { modeler: m } = need();
      const registry = m.get<{ get(id: string): unknown }>('elementRegistry');
      const canvas = m.get<{ getRootElement(): unknown }>('canvas');
      const element = elementId ? registry.get(elementId) : canvas.getRootElement();
      if (!element) throw new Error(`no element with id ${elementId}`);
      m.get<{ select(element: unknown): void }>('selection').select(element);
    },

    async importXml(xml, extensionsJson, options = {}) {
      await this.ready();
      await flush();
      const processId = processIdOfXml(xml);
      const file = options.file ?? fileNameFor(processId);
      const { modeler: m } = need();
      const { warnings } = await importProcess(m, { xml, extensionsJson, name: file });
      current = { file, processId };
      return { warnings };
    },

    async importCamunda(xml, options = {}) {
      await this.ready();
      await flush();
      const { modeler: m } = need();
      const store = m.get<ExtensionsStore>('extensionsStore');
      const catalog = m.get<ProjectCatalog>('projectCatalog');
      const result = convertCamundaBpmn(xml, {
        fileName: options.fileName ?? 'process.bpmn',
        defaultMappings: options.defaultMappings ?? store.defaultMappings,
        decision: (ref) => {
          const found = catalog.decision(ref);
          return found ? { id: found.decision.id, ...(found.decision.name ? { name: found.decision.name } : {}), inputs: found.decision.inputs, outputs: found.decision.outputs.map((o) => ({ ...(o.name ? { name: o.name } : {}), ...(o.type ? { type: o.type } : {}) })) } : undefined;
        },
      });
      const processId = processIdOfXml(result.xml);
      const file = fileNameFor(options.fileName?.replace(/\.(bpmn20\.xml|bpmn|xml)$/i, '') ?? processId);
      const { warnings } = await importProcess(m, { xml: result.xml, ...(result.extensionsJson !== undefined ? { extensionsJson: result.extensionsJson } : {}), name: file });
      current = { file, processId };
      return { converted: result.converted, warnings, report: result.report, xml: result.xml, ...(result.extensionsJson !== undefined ? { extensionsJson: result.extensionsJson } : {}) };
    },

    diffBpmn,
    diffExtensions,

    ...dmnApi,

    addDmn(name, content) {
      dmn.push({ name, content });
      return refreshCatalog();
    },
    addConnector(name, content) {
      connectors.push({ name, content });
      return refreshCatalog();
    },
    setConnector(name, content) {
      const index = connectors.findIndex((c) => c.name === name);
      if (index < 0) connectors.push({ name, content });
      else connectors[index] = { name, content };
      return refreshCatalog();
    },
    removeConnector(name) {
      const index = connectors.findIndex((c) => c.name === name);
      if (index >= 0) connectors.splice(index, 1);
      return refreshCatalog();
    },

    undo: () => need().modeler.get<{ undo(): void }>('commandStack').undo(),
    redo: () => need().modeler.get<{ redo(): void }>('commandStack').redo(),
    elementIds: () => need().modeler.get<{ getAll(): Array<{ id: string }> }>('elementRegistry').getAll().map((e) => e.id),
    catalogActions: () => need().modeler.get<ProjectCatalog>('projectCatalog').actions().map((a) => a.implementation),
    currentXml: async () => (await need().modeler.saveXML({ format: true })).xml ?? '',

    async exportProject() {
      await this.ready();
      await flush();
      const generated = await dmnApi.files();
      const assembled = assembleProject({
        name: project.name,
        version: project.version,
        processes: [...processes.values()].map((p) => ({ name: p.file, xml: p.xml, ...(p.omitExtensions ? omittable(p) : { extensions: p.extensionsJson }) })),
        dmn: [...dmn, ...generated.files],
        connectors: [...connectors],
      });
      return { files: assembled.files, warnings: [...[...processes.values()].flatMap((p) => p.warnings), ...generated.warnings, ...assembled.warnings] };
    },
  };
}

export function installTestApi(): void {
  window.__modelerTestApi = createTestApi();
}
