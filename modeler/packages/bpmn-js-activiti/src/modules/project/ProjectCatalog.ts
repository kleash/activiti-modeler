import type { ConnectorAction, ConnectorModel } from '@activiti-modeler/activiti-project';

import { DMN_DECISION_IMPLEMENTATION } from '../../support-matrix';

export const PROJECT_CHANGED = 'activiti.project.changed';

/** An output column of a decision table. */
export interface CatalogDecisionOutput {
  id?: string;
  name?: string;
  /** FEEL type of the column (`typeRef`). */
  type?: string;
}

/** A decision of a DMN file of the project, as a decision task needs it (ADR 0004). */
export interface CatalogDecision {
  /** The decision id: what the task's `_activiti_dmn_table_` constant holds. */
  id: string;
  name?: string;
  /** Names of the variables the task has to provide: the table's input names, those of the required decisions and the required input data. */
  inputs: string[];
  /** Input expressions that are not a plain variable name (they cannot be mapped by name). */
  complexInputs: string[];
  outputs: CatalogDecisionOutput[];
  hitPolicy?: string;
  aggregation?: string;
  /** No other decision of the file requires it: what a file name or definitions name resolves to. */
  sink?: boolean;
}

export interface CatalogDmnFile {
  path: string;
  /** File name without folder and `.dmn`. */
  baseName: string;
  /** `definitions/@name`. */
  name?: string;
  decisions: CatalogDecision[];
}

export interface CatalogProcess {
  id: string;
  name?: string;
  path: string;
}

/** What the properties panel and the templates know about the rest of the project. The host (the app, the test API) fills it. */
export interface ProjectCatalogData {
  connectors: ConnectorModel[];
  dmn: CatalogDmnFile[];
  processes: CatalogProcess[];
}

interface EventBusLike {
  fire(type: string, data?: Record<string, unknown>): unknown;
}

/** The decision a hit policy returns as a list under the decision id (ADR 0004), not as one value per output column. */
export function isMultiResult(decision: Pick<CatalogDecision, 'hitPolicy' | 'aggregation'>): boolean {
  const policy = (decision.hitPolicy ?? 'UNIQUE').toUpperCase();
  if (policy === 'COLLECT') return !decision.aggregation;
  return policy === 'RULE ORDER' || policy === 'OUTPUT ORDER';
}

/**
 * The project as the modeler sees it from one diagram: the connector definitions, the DMN decisions and the other processes.
 * Panel pickers, the generated element templates and the mapping autocomplete read it; the host sets it whenever a file of
 * the project changes. It is not part of the diagram and not undoable.
 */
export class ProjectCatalog {
  static $inject = ['eventBus'];

  private data: ProjectCatalogData = { connectors: [], dmn: [], processes: [] };
  private version = 0;

  constructor(private readonly eventBus: EventBusLike) {}

  /** Replaces the parts that are given. */
  set(data: Partial<ProjectCatalogData>): void {
    this.data = { ...this.data, ...data };
    this.version += 1;
    this.eventBus.fire(PROJECT_CHANGED, { revision: this.version });
  }

  get revision(): number {
    return this.version;
  }

  get connectors(): readonly ConnectorModel[] {
    return this.data.connectors;
  }

  get dmn(): readonly CatalogDmnFile[] {
    return this.data.dmn;
  }

  get processes(): readonly CatalogProcess[] {
    return this.data.processes;
  }

  connector(name: string): ConnectorModel | undefined {
    return this.data.connectors.find((c) => c.name === name);
  }

  /** The action `<connector>.<ACTION>` names, when the project defines it. */
  action(implementation: string | undefined): { connector: ConnectorModel; action: ConnectorAction } | undefined {
    if (!implementation || implementation === DMN_DECISION_IMPLEMENTATION) return undefined;
    const dot = implementation.indexOf('.');
    if (dot < 0) return undefined;
    const connector = this.connector(implementation.slice(0, dot));
    const action = connector?.actions[implementation.slice(dot + 1)];
    return connector && action ? { connector, action } : undefined;
  }

  /** Every `<connector>.<ACTION>` of the project, for the picker. */
  actions(): Array<{ implementation: string; connector: ConnectorModel; action: ConnectorAction }> {
    return this.data.connectors.flatMap((connector) => Object.values(connector.actions).map((action) => ({ implementation: `${connector.name}.${action.id}`, connector, action })));
  }

  /** The decision a `_activiti_dmn_table_` value names: a decision id, else a file's base name or definitions name (its single sink decision). */
  decision(value: string | undefined): { file: CatalogDmnFile; decision: CatalogDecision } | undefined {
    if (!value) return undefined;
    for (const file of this.data.dmn) {
      const decision = file.decisions.find((d) => d.id === value);
      if (decision) return { file, decision };
    }
    for (const file of this.data.dmn) {
      if (file.baseName !== value && file.name !== value) continue;
      const sinks = file.decisions.filter((d) => d.sink ?? file.decisions.length === 1);
      if (sinks.length === 1) return { file, decision: sinks[0]! };
    }
    return undefined;
  }
}

export const ProjectModule = {
  __init__: ['projectCatalog'],
  projectCatalog: ['type', ProjectCatalog],
};
