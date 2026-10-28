/**
 * The dmn-js modeler of the app (feature rows DM1, DM2, DM4, DM7): DRD, decision table, literal expression and boxed expression
 * views with the FEEL data types, FEEL variable suggestions (the DRD inputs, the variables of the processes that call the file)
 * and the search of the DRD. The bpmn.io watermark of every view stays as dmn-js draws it (feature U20).
 */
import DmnModeler from 'dmn-js/lib/Modeler';

import { DRD_PANEL_MODULES } from './dmnPanel';

import 'dmn-js/dist/assets/diagram-js.css';
import 'dmn-js/dist/assets/dmn-js-shared.css';
import 'dmn-js/dist/assets/dmn-js-drd.css';
import 'dmn-js/dist/assets/dmn-js-decision-table.css';
import 'dmn-js/dist/assets/dmn-js-decision-table-controls.css';
import 'dmn-js/dist/assets/dmn-js-literal-expression.css';
import 'dmn-js/dist/assets/dmn-js-boxed-expression.css';
import 'dmn-js/dist/assets/dmn-js-boxed-expression-controls.css';
import 'dmn-js/dist/assets/dmn-font/css/dmn-embedded.css';

/**
 * How long dmn-js waits after the last keystroke in a cell, an expression or a label before it executes the edit (one undo step for a
 * burst of typing). A save that starts while the user is still typing waits for it (`DmnTabEditor`).
 */
export const INPUT_DEBOUNCE_MS = 250;

/** The edits that wait for the input delay, each by its flush. */
const pendingInput = new Set<() => void>();

/**
 * dmn-js's `debounceInput` service with the same delay, but the edits that are still waiting are known: a save executes them at once
 * (`flushDmnInput`) instead of waiting for the delay, and the tests wait until there is none (`pendingDmnInput`).
 */
function trackedDebounceInput() {
  return <A extends unknown[]>(fn: (...args: A) => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: { self: unknown; args: A } | undefined;
    const cancel = (): void => {
      clearTimeout(timer);
      timer = undefined;
      pendingInput.delete(flush);
    };
    const flush = (): void => {
      if (timer === undefined || !last) return;
      cancel();
      fn.apply(last.self, last.args);
    };
    return Object.assign(
      function debounced(this: unknown, ...args: A): void {
        last = { self: this, args };
        clearTimeout(timer);
        timer = setTimeout(flush, INPUT_DEBOUNCE_MS);
        pendingInput.add(flush);
      },
      { flush, cancel },
    );
  };
}

const trackedInput = { debounceInput: ['factory', trackedDebounceInput] };

/**
 * dmn-js keeps the id of a deleted DRD element claimed, so no new element can have it until the file is opened again (the panel refuses
 * it as taken). Like bpmn-js does for BPMN, the id is given free when the element is deleted, in the same undo step.
 */
class UnclaimDeletedIds {
  static $inject = ['eventBus', 'modeling'];
  constructor(eventBus: { on(events: string[], callback: (event: { context: { shape?: { businessObject?: { id?: string } }; connection?: { businessObject?: { id?: string } } } }) => void): void }, modeling: { unclaimId(id: string, element: unknown): void }) {
    eventBus.on(['commandStack.shape.delete.preExecute', 'commandStack.connection.delete.preExecute'], ({ context }) => {
      const bo = (context.shape ?? context.connection)?.businessObject;
      if (bo?.id) modeling.unclaimId(bo.id, bo);
    });
  }
}

const unclaimDeletedIds = { __init__: ['unclaimDeletedIds'], unclaimDeletedIds: ['type', UnclaimDeletedIds] };

/** Executes the typed edits that still wait for the input delay. */
export function flushDmnInput(): void {
  for (const flush of [...pendingInput]) flush();
}

/** How many typed edits wait for the input delay. */
export function pendingDmnInput(): number {
  return pendingInput.size;
}

/** The type names the editor offers: FEEL's own (DMN 1.3), as both engines read them (docs/user-guide/dmn-conventions.md rule 4). */
export const FEEL_DATA_TYPES: readonly string[] = ['string', 'number', 'boolean', 'date', 'time', 'date and time', 'days and time duration', 'years and months duration', 'Any'];

export type DmnViewType = 'drd' | 'decisionTable' | 'literalExpression' | 'boxedExpression';

export interface DmnView {
  id: string;
  name?: string;
  type: DmnViewType;
  element: { id: string; $type: string };
}

export interface DmnViewer {
  get<T = unknown>(service: string, strict?: boolean): T;
  on(event: string | string[], callback: (event: never) => void): void;
  off(event: string, callback: (event: never) => void): void;
}

/** What the app uses of a dmn-js `Modeler`. */
export interface DmnModelerLike {
  importXML(xml: string, options?: { open?: boolean }): Promise<{ warnings: Array<{ message?: string }> }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  getViews(): DmnView[];
  getActiveView(): DmnView | undefined;
  getActiveViewer(): DmnViewer | undefined;
  getDefinitions(): { $type: string; id?: string; name?: string; get(property: string): unknown } | undefined;
  open(view: DmnView): Promise<unknown>;
  on(event: string | string[], callback: (event: never) => void): void;
  off(event: string, callback: (event: never) => void): void;
  destroy(): void;
}

/** A variable the FEEL editors suggest (the shape of `@bpmn-io/feel-editor`). */
export interface SuggestedVariable {
  name: string;
  detail?: string;
  info?: string;
}

/** The variables of the project that the FEEL editors of one file suggest next to the DRD's own: process variables of the callers. */
export class ProjectVariables {
  variables: SuggestedVariable[] = [];
  set(variables: SuggestedVariable[]): void {
    this.variables = variables;
  }
}

/** A variable provider for `@bpmn-io/dmn-variable-resolver` (the resolver of the decision table, the literal expression and the boxed expression). */
function projectVariablesModule(store: ProjectVariables): { __init__: string[]; [service: string]: unknown } {
  class ProjectVariableProvider {
    static $inject = ['variableResolver'];
    constructor(variableResolver: { registerProvider(provider: object): void }) {
      variableResolver.registerProvider(this);
    }
    getVariables(variables: SuggestedVariable[]): SuggestedVariable[] {
      const known = new Set(variables.map((v) => v.name));
      return variables.concat(store.variables.filter((v) => !known.has(v.name)));
    }
  }
  return { __init__: ['projectVariableProvider'], projectVariableProvider: ['type', ProjectVariableProvider] };
}

export interface CreateDmnModelerOptions {
  container?: HTMLElement;
  projectVariables?: ProjectVariables;
  /**
   * The DRD gets the properties panel. The panel renders as soon as a diagram is imported and watches its groups with an
   * `IntersectionObserver`; where the environment has none (the jsdom of the unit tests, which build models and never show them)
   * the panel is left out. The model is the same either way.
   */
  propertiesPanel?: boolean;
}

/** A dmn-js modeler with the editor's options; the test API makes its own with the same options, so what it builds is what the editor writes. */
export function createDmnModeler(options: CreateDmnModelerOptions = {}): DmnModelerLike {
  const variables = projectVariablesModule(options.projectVariables ?? new ProjectVariables());
  return new DmnModeler({
    ...(options.container ? { container: options.container } : {}),
    common: {
      dataTypes: [...FEEL_DATA_TYPES],
      // FEEL is the only language the engines evaluate (ADR 0004)
      expressionLanguages: { options: [{ value: 'feel', label: 'FEEL' }], defaults: { editor: 'feel' } },
    },
    // the groups are short: they start open
    drd: { additionalModules: [...((options.propertiesPanel ?? typeof IntersectionObserver !== 'undefined') ? DRD_PANEL_MODULES : []), trackedInput, unclaimDeletedIds], propertiesPanel: { layout: { groups: { general: { open: true }, documentation: { open: true }, variable: { open: true } } } } },
    decisionTable: { additionalModules: [variables, trackedInput] },
    literalExpression: { additionalModules: [variables, trackedInput] },
    boxedExpression: { additionalModules: [variables, trackedInput] },
  }) as unknown as DmnModelerLike;
}

/** A new, empty DMN 1.3 file: one definitions element with the Activiti namespace, no decision. */
export function emptyDmnXml(id: string, name: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="${esc(id)}" name="${esc(name)}" namespace="http://activiti.org/schema/1.0/dmn/${esc(id)}">
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1" />
  </dmndi:DMNDI>
</definitions>
`;
}
