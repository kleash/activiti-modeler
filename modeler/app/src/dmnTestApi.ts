/**
 * The DMN part of `window.__modelerTestApi` (built into dev and test builds only, see main.tsx): programmatic DMN modeling for the corpus
 * `build.ts` files of C16 and C17 and for the Vitest / Playwright tests. Every operation runs on a real dmn-js modeler with the editor's own
 * options (`createDmnModeler`), through the modeling commands the UI uses: shapes and connections of the DRD, the replace of a decision by a
 * decision table or a literal expression, the rows and columns of a table, cells, hit policy and allowed values. Nothing is written as
 * XML text. The modelers are hidden: they live in the page but are not shown in a tab.
 */
import { detectDmnVersion, diffDmn, normalizeDmn, type DmnDiffOptions } from '@activiti-modeler/activiti-project';
import { migrateDiagram } from '@bpmn-io/dmn-migrate';

import { createDmnModeler, type DmnModelerLike, type DmnView, type DmnViewer, emptyDmnXml } from './editors/dmn/dmnModeler';

export interface DmnInputSpec {
  label?: string;
  /** The FEEL expression the column reads (a variable name, usually). */
  expression: string;
  typeRef?: string;
  /** Allowed values of the column as FEEL literals (`['"gold"', '"silver"']`). */
  allowedValues?: string[];
}

export interface DmnOutputSpec {
  name?: string;
  label?: string;
  typeRef?: string;
  /** Allowed values as FEEL literals; for PRIORITY and OUTPUT ORDER their order is the priority. */
  allowedValues?: string[];
}

export interface DmnRuleSpec {
  /** The rule id: a scenario asserts matched rules by it. */
  id: string;
  /** One FEEL unary test per input column (`-` for any). */
  inputs: string[];
  /** One FEEL expression per output column. */
  outputs: string[];
  annotation?: string;
}

export interface DmnPosition {
  x: number;
  y: number;
}

export interface DmnTableSpec {
  id: string;
  name?: string;
  /** The type of the decision's variable; left out it stays `Any` (the same as no type). */
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
  /** The FEEL expression. */
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
  /** The type of the BKM's variable. */
  variableType?: string;
  parameters?: Array<{ name: string; typeRef?: string }>;
  /** The FEEL body of the function. */
  expression: string;
  expressionType?: string;
  at?: DmnPosition;
}

export interface DmnContextEntrySpec {
  /** Name of the entry's variable; none for the result entry. */
  name?: string;
  typeRef?: string;
  /** A FEEL expression. */
  expression?: string;
  /** Or an invocation of a business knowledge model with one binding per parameter. */
  invocation?: { function: string; bindings: Array<{ parameter: string; expression: string }> };
}

export interface DmnContextSpec {
  id: string;
  name?: string;
  variableType?: string;
  entries: DmnContextEntrySpec[];
  at?: DmnPosition;
}

export interface DmnShapeSpec {
  id: string;
  name?: string;
  at?: DmnPosition;
}

export type DmnRequirementType = 'information' | 'knowledge' | 'authority';

export interface DmnTestApi {
  /** Starts a DMN file `processes/<name>.dmn` (an empty DMN 1.3 definitions element); `id` and `definitionsName` are those of `definitions`. */
  createDmn(name: string, options?: { id?: string; definitionsName?: string }): Promise<void>;
  /** A decision with a decision table: the DRD shape, the table, its hit policy, inputs, outputs and rules. Returns the decision id. */
  addDecisionTable(dmn: string, spec: DmnTableSpec): Promise<string>;
  /** A decision with a literal expression. */
  addLiteralDecision(dmn: string, spec: DmnLiteralSpec): Promise<string>;
  /** A decision whose logic is a boxed context (entries, invocations of business knowledge models): only KIE evaluates it. */
  addContextDecision(dmn: string, spec: DmnContextSpec): Promise<string>;
  addInputData(dmn: string, spec: DmnInputDataSpec): Promise<string>;
  /** A business knowledge model with a function over a literal expression: only KIE evaluates it. */
  addBusinessKnowledgeModel(dmn: string, spec: DmnBkmSpec): Promise<string>;
  addKnowledgeSource(dmn: string, spec: DmnShapeSpec): Promise<string>;
  addTextAnnotation(dmn: string, spec: { id: string; text: string; at?: DmnPosition }): Promise<string>;
  /** Connects two elements of the DRD; the kind of requirement follows from the elements (`type` checks it). Returns the id of the connection. */
  addRequirement(dmn: string, sourceId: string, targetId: string, type?: DmnRequirementType): Promise<string>;
  /** Sets hit policy and aggregation of an existing table, in the decision table view. */
  setHitPolicy(dmn: string, decisionId: string, hitPolicy: string, aggregation?: string): Promise<void>;
  addTableInput(dmn: string, decisionId: string, spec: DmnInputSpec): Promise<void>;
  addTableOutput(dmn: string, decisionId: string, spec: DmnOutputSpec): Promise<void>;
  addTableRule(dmn: string, decisionId: string, spec: DmnRuleSpec): Promise<void>;
  /** Renames the id and name of an element of the DRD (its variable follows the name). */
  renameDmnElement(dmn: string, elementId: string, change: { id?: string; name?: string }): Promise<void>;
  /** The DMN as the modeler would save it: dmn-js's XML, made portable. */
  currentDmnXml(dmn: string): Promise<string>;
  /**
   * Undoes the last command of the view that is open: after `addDecisionTable` and the operations on a table that is the decision table
   * view, after the DRD operations (`addInputData`, `addRequirement`, ...) the DRD. dmn-js keeps one history per view and starts it
   * again when a view is opened.
   */
  undoDmn(dmn: string): Promise<void>;
  /** Semantic comparison of a seed DMN with a generated one. */
  diffDmn(expectedXml: string, actualXml: string, options?: { allow?: string[] }): string[];
  /**
   * Opens an existing DMN file the way the DMN editor opens a tab: a DMN 1.1 or 1.2 file is migrated to 1.3 with `@bpmn-io/dmn-migrate` first
   * (`migratedFrom` names the version), then imported into a dmn-js modeler with the editor's own options. `currentDmnXml` and the export then
   * give the file as a save would write it (`normalizeDmn`). `processes/<name>.dmn` joins the project like a file made with `createDmn`.
   */
  openDmn(name: string, xml: string): Promise<{ migratedFrom?: string; warnings: string[] }>;
}

interface DmnFile {
  name: string;
  modeler: DmnModelerLike;
  host: HTMLElement;
  definitionsName: string;
  /** Where the next shape goes when the spec gives no position. */
  placed: number;
}

interface ModdleBo {
  $type: string;
  id?: string;
  name?: string;
  variable?: ModdleBo;
  decisionLogic?: unknown;
  encapsulatedLogic?: ModdleBo;
  body?: ModdleBo;
  input?: ModdleBo[];
  output?: ModdleBo[];
  inputExpression?: ModdleBo;
  get(property: string): unknown;
  $parent?: unknown;
  [property: string]: unknown;
}

interface DrdElement {
  id: string;
  businessObject: ModdleBo;
}

interface TableViewer extends DmnViewer {
  get<T = unknown>(service: string, strict?: boolean): T;
}

const NEXT_SPACING = 220;

/** The `dmn` API of the test API; `onChange` runs after every operation (the host refreshes the catalog of the open diagrams with the new files). */
export function createDmnTestApi(onChange: () => Promise<void>): DmnTestApi & { reset(): void; files(): Promise<{ files: Array<{ name: string; content: string }>; warnings: string[] }> } {
  const files = new Map<string, DmnFile>();

  const need = (name: string): DmnFile => {
    const file = files.get(name);
    if (!file) throw new Error(`no DMN file "${name}": call createDmn("${name}") first`);
    return file;
  };

  const viewOf = (file: DmnFile, id: string): DmnView => {
    const view = file.modeler.getViews().find((v) => v.id === id);
    if (!view) throw new Error(`${file.name}.dmn has no view for "${id}" (a decision with a decision table or an expression, a business knowledge model)`);
    return view;
  };

  async function drd(file: DmnFile): Promise<DmnViewer> {
    const view = file.modeler.getViews().find((v) => v.type === 'drd');
    if (!view) throw new Error('the file has no DRD view');
    if (file.modeler.getActiveView()?.id !== view.id) await file.modeler.open(view);
    return file.modeler.getActiveViewer() as DmnViewer;
  }

  async function openView(file: DmnFile, id: string): Promise<TableViewer> {
    const view = viewOf(file, id);
    if (file.modeler.getActiveView()?.id !== view.id) await file.modeler.open(view);
    return file.modeler.getActiveViewer() as TableViewer;
  }

  const done = async <T>(value: T): Promise<T> => {
    await onChange();
    return value;
  };

  function position(file: DmnFile, at: DmnPosition | undefined): DmnPosition {
    if (at) return at;
    file.placed += 1;
    return { x: 160 + ((file.placed - 1) % 4) * NEXT_SPACING, y: 100 + Math.floor((file.placed - 1) / 4) * 160 };
  }

  /** Creates a shape of `type` in the DRD and returns it. */
  async function createShape(file: DmnFile, type: string, at: DmnPosition | undefined): Promise<{ viewer: DmnViewer; element: DrdElement }> {
    const viewer = await drd(file);
    const factory = viewer.get<{ createShape(attrs: object): DrdElement }>('elementFactory');
    const modeling = viewer.get<{ createShape(shape: unknown, position: DmnPosition, parent: unknown): DrdElement }>('modeling');
    const canvas = viewer.get<{ getRootElement(): unknown }>('canvas');
    const element = modeling.createShape(factory.createShape({ type }), position(file, at), canvas.getRootElement());
    return { viewer, element };
  }

  function setIdAndName(viewer: DmnViewer, element: DrdElement, id: string, name: string | undefined): void {
    viewer.get<{ updateProperties(el: unknown, props: object): void }>('modeling').updateProperties(element, { id, name: name ?? id });
  }

  /** The variable of a decision, input data or business knowledge model: named like it, with the type. */
  function setVariable(viewer: DmnViewer, element: DrdElement, name: string, typeRef: string | undefined): void {
    const variable = element.businessObject.variable;
    if (!variable) return;
    viewer.get<{ updateModdleProperties(el: unknown, moddleElement: unknown, props: object): void }>('modeling').updateModdleProperties(element, variable, { name, ...(typeRef ? { typeRef } : {}) });
  }

  function replaceBy(viewer: DmnViewer, element: DrdElement, target: { table: boolean; expression: boolean }): DrdElement {
    return viewer.get<{ replaceElement(el: unknown, target: object): DrdElement }>('drdReplace').replaceElement(element, { type: 'dmn:Decision', ...target });
  }

  // --- tables -----------------------------------------------------------------------------------------------------------------

  function configureInput(table: TableViewer, clause: ModdleBo, spec: DmnInputSpec): void {
    const modeling = table.get<{
      updateProperties(el: unknown, props: object): void;
      editInputExpression(el: unknown, props: object): void;
      editAllowedValues(el: unknown, values: string[] | null): void;
    }>('modeling');
    if (spec.label !== undefined) modeling.updateProperties(clause, { label: spec.label });
    modeling.editInputExpression(clause.inputExpression, { text: spec.expression, ...(spec.typeRef ? { typeRef: spec.typeRef } : {}) });
    if (spec.allowedValues) modeling.editAllowedValues(clause, spec.allowedValues);
  }

  function configureOutput(table: TableViewer, clause: ModdleBo, spec: DmnOutputSpec): void {
    const modeling = table.get<{
      updateProperties(el: unknown, props: object): void;
      editOutputName(el: unknown, name: string): void;
      editOutputTypeRef(el: unknown, typeRef: string): void;
      editAllowedValues(el: unknown, values: string[] | null): void;
    }>('modeling');
    if (spec.name !== undefined) modeling.editOutputName(clause, spec.name);
    if (spec.label !== undefined) modeling.updateProperties(clause, { label: spec.label });
    if (spec.typeRef) modeling.editOutputTypeRef(clause, spec.typeRef);
    if (spec.allowedValues) modeling.editAllowedValues(clause, spec.allowedValues);
  }

  const tableBo = (table: TableViewer): ModdleBo => table.get<{ getRoot(): { businessObject: ModdleBo } }>('sheet').getRoot().businessObject;

  async function fillTable(file: DmnFile, spec: DmnTableSpec): Promise<void> {
    const table = await openView(file, spec.id);
    const modeling = table.get<{ editHitPolicy(hitPolicy: string, aggregation?: string): void }>('modeling');
    const actions = table.get<{ trigger(action: string): { businessObject: ModdleBo } }>('editorActions');
    if (spec.hitPolicy) modeling.editHitPolicy(spec.hitPolicy.toUpperCase(), spec.aggregation?.toUpperCase());
    // the new table has one input and one output column: the first spec of each reuses it
    spec.inputs.forEach((input, index) => {
      const clause = index === 0 ? (tableBo(table).input as ModdleBo[])[0]! : actions.trigger('addInput').businessObject;
      configureInput(table, clause, input);
    });
    spec.outputs.forEach((output, index) => {
      const clause = index === 0 ? (tableBo(table).output as ModdleBo[])[0]! : actions.trigger('addOutput').businessObject;
      configureOutput(table, clause, output);
    });
    for (const rule of spec.rules) addRule(table, rule);
  }

  function addRule(table: TableViewer, rule: DmnRuleSpec): void {
    const bo = tableBo(table);
    const inputs = (bo.input ?? []).length;
    const outputs = (bo.output ?? []).length;
    if (rule.inputs.length !== inputs || rule.outputs.length !== outputs) {
      throw new Error(`rule ${rule.id} has ${rule.inputs.length} input and ${rule.outputs.length} output entries, the table has ${inputs} and ${outputs} columns`);
    }
    const dmnFactory = table.get<{ create(type: string, attrs?: object): ModdleBo }>('dmnFactory');
    const moddle = table.get<{ ids: { claim(id: string, element: unknown): void } }>('moddle');
    const modeling = table.get<{ addRow(attrs: object, index?: number): { cells: unknown[] }; editCell(cell: unknown, text: string): void; editAnnotation(row: unknown, text: string): void }>('modeling');
    // the rule id is part of the corpus contract: the rule is made with its id, like the editor makes a pasted rule
    const ruleBo = dmnFactory.create('dmn:DecisionRule', { id: rule.id });
    moddle.ids.claim(rule.id, ruleBo);
    const row = modeling.addRow({ businessObject: ruleBo });
    [...rule.inputs, ...rule.outputs].forEach((text, index) => modeling.editCell(row.cells[index], text));
    if (rule.annotation !== undefined) modeling.editAnnotation(row, rule.annotation);
  }

  // --- the API ----------------------------------------------------------------------------------------------------------------

  return {
    async createDmn(name, options = {}) {
      if (files.has(name)) throw new Error(`a DMN file "${name}" already exists in the project`);
      const host = document.createElement('div');
      host.setAttribute('data-test-api-dmn', name);
      host.style.cssText = 'position:absolute;left:0;top:0;width:1000px;height:700px;visibility:hidden;pointer-events:none;z-index:-1;overflow:hidden';
      document.body.appendChild(host);
      const modeler = createDmnModeler({ container: host });
      const id = options.id ?? `Definitions_${name.replace(/[^A-Za-z0-9_]+/g, '_')}`;
      const definitionsName = options.definitionsName ?? name;
      await modeler.importXML(emptyDmnXml(id, definitionsName));
      files.set(name, { name, modeler, host, definitionsName, placed: 0 });
      await onChange();
    },

    async addDecisionTable(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:Decision', spec.at);
      const table = replaceBy(created.viewer, created.element, { table: true, expression: false });
      setIdAndName(created.viewer, table, spec.id, spec.name);
      setVariable(created.viewer, table, spec.name ?? spec.id, spec.variableType);
      await fillTable(file, spec);
      return done(spec.id);
    },

    async addLiteralDecision(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:Decision', spec.at);
      const element = replaceBy(created.viewer, created.element, { table: false, expression: true });
      setIdAndName(created.viewer, element, spec.id, spec.name);
      setVariable(created.viewer, element, spec.name ?? spec.id, spec.variableType);
      const literal = await openView(file, spec.id);
      const modeling = literal.get<{ editLiteralExpressionText(text: string): void; getDecision(): ModdleBo; updateProperties(el: unknown, props: object): void }>('modeling');
      modeling.editLiteralExpressionText(spec.expression);
      if (spec.expressionType) modeling.updateProperties(modeling.getDecision().decisionLogic, { typeRef: spec.expressionType });
      return done(spec.id);
    },

    async addContextDecision(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:Decision', spec.at);
      setIdAndName(created.viewer, created.element, spec.id, spec.name);
      setVariable(created.viewer, created.element, spec.name ?? spec.id, spec.variableType);
      const factory = created.viewer.get<{ create(type: string, attrs?: object): ModdleBo }>('drdFactory');
      const link = <T extends ModdleBo>(child: T, parent: ModdleBo): T => {
        child.$parent = parent;
        return child;
      };
      const literal = (text: string, parent: ModdleBo, id: string): ModdleBo => link(factory.create('dmn:LiteralExpression', { id, text }), parent);
      const context = factory.create('dmn:Context', { id: `${spec.id}_context` });
      context.contextEntry = spec.entries.map((entry, index) => {
        const contextEntry = link(factory.create('dmn:ContextEntry'), context);
        if (entry.name) contextEntry.variable = link(factory.create('dmn:InformationItem', { id: `${spec.id}_context_${entry.name}`, name: entry.name, ...(entry.typeRef ? { typeRef: entry.typeRef } : {}) }), contextEntry);
        if (entry.invocation) {
          const invocation = link(factory.create('dmn:Invocation', { id: `${spec.id}_invocation` }), contextEntry);
          invocation.calledFunction = literal(entry.invocation.function, invocation, `${spec.id}_invocation_target`);
          invocation.binding = entry.invocation.bindings.map((b) => {
            const binding = link(factory.create('dmn:Binding'), invocation);
            binding.parameter = link(factory.create('dmn:InformationItem', { id: `${spec.id}_binding_${b.parameter}`, name: b.parameter }), binding);
            binding.bindingFormula = literal(b.expression, binding, `${spec.id}_binding_value`);
            return binding;
          });
          contextEntry.value = invocation;
        } else {
          contextEntry.value = literal(entry.expression ?? '', contextEntry, `${spec.id}_context_${entry.name ?? 'result'}${index}`);
        }
        return contextEntry;
      });
      link(context, created.element.businessObject);
      created.viewer.get<{ updateModdleProperties(el: unknown, moddleElement: unknown, props: object): void }>('modeling').updateModdleProperties(created.element, created.element.businessObject, { decisionLogic: context });
      return done(spec.id);
    },

    async addInputData(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:InputData', spec.at);
      setIdAndName(created.viewer, created.element, spec.id, spec.name);
      setVariable(created.viewer, created.element, spec.name ?? spec.id, spec.typeRef);
      return done(spec.id);
    },

    async addBusinessKnowledgeModel(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:BusinessKnowledgeModel', spec.at);
      const element = created.viewer.get<{ replaceElement(el: unknown, target: object): DrdElement }>('drdReplace').replaceElement(created.element, { type: 'dmn:BusinessKnowledgeModel', table: false, expression: true });
      setIdAndName(created.viewer, element, spec.id, spec.name);
      setVariable(created.viewer, element, spec.name ?? spec.id, spec.variableType);
      const boxed = await openView(file, spec.id);
      const modeling = boxed.get<{ updateProperties(el: unknown, props: object): void }>('modeling');
      const dmnFactory = boxed.get<{ create(type: string, attrs?: object): ModdleBo }>('dmnFactory');
      const logic = element.businessObject.encapsulatedLogic as ModdleBo;
      const parameters = (spec.parameters ?? []).map((p) => {
        const item = dmnFactory.create('dmn:InformationItem', { name: p.name, ...(p.typeRef ? { typeRef: p.typeRef } : {}) });
        item.$parent = logic;
        return item;
      });
      if (parameters.length > 0) modeling.updateProperties(logic, { formalParameter: parameters });
      modeling.updateProperties(logic.body, { text: spec.expression, ...(spec.expressionType ? { typeRef: spec.expressionType } : {}) });
      return done(spec.id);
    },

    async addKnowledgeSource(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:KnowledgeSource', spec.at);
      setIdAndName(created.viewer, created.element, spec.id, spec.name);
      return done(spec.id);
    },

    async addTextAnnotation(dmn, spec) {
      const file = need(dmn);
      const created = await createShape(file, 'dmn:TextAnnotation', spec.at);
      const modeling = created.viewer.get<{ updateProperties(el: unknown, props: object): void }>('modeling');
      modeling.updateProperties(created.element, { id: spec.id, text: spec.text });
      return done(spec.id);
    },

    async addRequirement(dmn, sourceId, targetId, type) {
      const file = need(dmn);
      const viewer = await drd(file);
      const registry = viewer.get<{ get(id: string): DrdElement | undefined }>('elementRegistry');
      const source = registry.get(sourceId);
      const target = registry.get(targetId);
      if (!source || !target) throw new Error(`the DRD has no element ${!source ? sourceId : targetId}`);
      const rules = viewer.get<{ canConnect(a: unknown, b: unknown): { type: string } | false | null }>('drdRules');
      const allowed = rules.canConnect(source, target);
      if (!allowed) throw new Error(`${sourceId} cannot be connected to ${targetId}`);
      const expected = { information: 'dmn:InformationRequirement', knowledge: 'dmn:KnowledgeRequirement', authority: 'dmn:AuthorityRequirement' }[type ?? 'information'];
      if (type && allowed.type !== expected) throw new Error(`${sourceId} to ${targetId} is a ${allowed.type}, not a ${expected}`);
      const connection = viewer.get<{ connect(source: unknown, target: unknown): DrdElement }>('modeling').connect(source, target);
      return done(connection.businessObject.id ?? connection.id);
    },

    async setHitPolicy(dmn, decisionId, hitPolicy, aggregation) {
      const file = need(dmn);
      const table = await openView(file, decisionId);
      table.get<{ editHitPolicy(h: string, a?: string): void }>('modeling').editHitPolicy(hitPolicy.toUpperCase(), aggregation?.toUpperCase());
      return done(undefined);
    },

    async addTableInput(dmn, decisionId, spec) {
      const file = need(dmn);
      const table = await openView(file, decisionId);
      const col = table.get<{ trigger(action: string): { businessObject: ModdleBo } }>('editorActions').trigger('addInput');
      configureInput(table, col.businessObject, spec);
      return done(undefined);
    },

    async addTableOutput(dmn, decisionId, spec) {
      const file = need(dmn);
      const table = await openView(file, decisionId);
      const col = table.get<{ trigger(action: string): { businessObject: ModdleBo } }>('editorActions').trigger('addOutput');
      configureOutput(table, col.businessObject, spec);
      return done(undefined);
    },

    async addTableRule(dmn, decisionId, spec) {
      const file = need(dmn);
      const table = await openView(file, decisionId);
      addRule(table, spec);
      return done(undefined);
    },

    async renameDmnElement(dmn, elementId, change) {
      const file = need(dmn);
      const viewer = await drd(file);
      const element = viewer.get<{ get(id: string): DrdElement | undefined }>('elementRegistry').get(elementId);
      if (!element) throw new Error(`the DRD has no element ${elementId}`);
      viewer.get<{ updateProperties(el: unknown, props: object): void }>('modeling').updateProperties(element, change);
      return done(undefined);
    },

    async currentDmnXml(dmn) {
      const file = need(dmn);
      const { xml } = await file.modeler.saveXML({ format: true });
      return normalizeDmn(xml, { definitionsName: file.definitionsName }).xml;
    },

    async undoDmn(dmn) {
      const file = need(dmn);
      file.modeler.getActiveViewer()?.get<{ undo(): void }>('commandStack').undo();
      return done(undefined);
    },

    async openDmn(name, xml) {
      if (files.has(name)) throw new Error(`a DMN file "${name}" already exists in the project`);
      const version = detectDmnVersion(xml);
      if (!version) throw new Error(`${name}.dmn is not a DMN document (the root element is not definitions in a DMN namespace)`);
      let source = xml;
      let migratedFrom: string | undefined;
      if (version === '1.1' || version === '1.2') {
        source = await migrateDiagram(xml);
        migratedFrom = version;
      }
      const host = document.createElement('div');
      host.setAttribute('data-test-api-dmn', name);
      host.style.cssText = 'position:absolute;left:0;top:0;width:1000px;height:700px;visibility:hidden;pointer-events:none;z-index:-1;overflow:hidden';
      document.body.appendChild(host);
      const modeler = createDmnModeler({ container: host });
      const { warnings } = await modeler.importXML(source);
      files.set(name, { name, modeler, host, definitionsName: name, placed: 0 });
      await onChange();
      return { ...(migratedFrom ? { migratedFrom } : {}), warnings: warnings.map((w) => w.message ?? String(w)) };
    },

    diffDmn: (expectedXml, actualXml, options) => diffDmn(expectedXml, actualXml, { allow: (options?.allow ?? []).map((p) => new RegExp(p)) } satisfies DmnDiffOptions),

    reset() {
      for (const file of files.values()) {
        file.modeler.destroy();
        file.host.remove();
      }
      files.clear();
    },

    async files() {
      const out: Array<{ name: string; content: string }> = [];
      const warnings: string[] = [];
      for (const file of files.values()) {
        const { xml } = await file.modeler.saveXML({ format: true });
        const result = normalizeDmn(xml, { definitionsName: file.definitionsName });
        out.push({ name: file.name, content: result.xml });
        warnings.push(...result.warnings.map((w) => `${file.name}.dmn: ${w}`));
      }
      return { files: out, warnings };
    },
  };
}
