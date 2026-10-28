import { BaseVariableResolver, type ResolverVariable } from '@bpmn-io/variable-resolver/lib/base/VariableResolver';
import { extractOutline, flowElementsOf, type DecisionLike, type ModdleLike, type OutlineVariable, type ProcessExtensionLike, type VariableUse } from '@activiti-modeler/activiti-variable-resolver';
import { EXTENSIONS_CHANGED, PROJECT_CHANGED, type ExtensionsStore, type ProjectCatalog } from '@activiti-modeler/bpmn-js-activiti';

/**
 * The Activiti adapter of `@bpmn-io/variable-resolver` (feature U14).
 *
 * The package resolves the variables of a diagram with a base extractor per vendor (Camunda 7, Zeebe) that reads that vendor's
 * XML. This adapter plugs in the Activiti one: it reads the process variables of the extensions file, the mappings (also the outputs of
 * a DMN decision), the call activity parameters, the result variables and the multi-instance variables, and which elements read them
 * (see `@activiti-modeler/activiti-variable-resolver`). The caching, the merging of equal variables and the scope queries
 * (`getVariablesForElement`) are the package's own.
 */

/** A variable as the resolver hands it out, with the Activiti details of each writer and reader. */
export interface ActivitiVariable extends ResolverVariable {
  /** The declared type or the type of the first writer that has one; undefined when unknown. */
  valueType?: string;
  declared: boolean;
  external: boolean;
  uses: { writers: VariableUse[]; readers: VariableUse[] };
}

interface EventBusLike {
  on(events: string | string[], handler: (event: unknown) => void): void;
  fire(type: string, data?: Record<string, unknown>): unknown;
}
interface ExtractorContext {
  elements: unknown[];
  containerElement: unknown;
  processVariables: unknown[];
}
type AdditionalExtractor = (context: ExtractorContext) => unknown;

const isProcess = (el: unknown): el is ModdleLike => !!el && typeof (el as ModdleLike).$instanceOf === 'function' && (el as ModdleLike).$instanceOf('bpmn:Process');

export function toResolverVariable(variable: OutlineVariable, container: ModdleLike): ActivitiVariable {
  const writers = variable.writers.map((w) => w.element);
  const detail = variable.writers[0]?.detail ?? (variable.external ? 'read, but no element writes it: it comes with the start or from the caller' : undefined);
  return {
    name: variable.name,
    ...(variable.type ? { type: variable.type, valueType: variable.type } : {}),
    ...(detail ? { info: detail } : {}),
    scope: (variable.scope ?? container) as never,
    origin: [...new Set(writers)],
    // readers are the consumers; a variable nobody reads has none
    ...(variable.readers.length > 0 ? { usedBy: [...new Set(variable.readers.map((r) => r.element))] } : {}),
    declared: variable.declared,
    external: variable.external,
    uses: { writers: variable.writers, readers: variable.readers },
  };
}

export class ActivitiVariableResolver extends BaseVariableResolver {
  static $inject = ['eventBus', 'bpmnjs', 'extensionsStore', 'projectCatalog'];

  constructor(eventBus: EventBusLike, bpmnjs: unknown, store: ExtensionsStore, catalog: ProjectCatalog) {
    super(eventBus, bpmnjs);
    this._baseExtractor = async (container, additionalExtractors) => {
      if (!isProcess(container)) return [];
      const extension = store.getProcess(container.id ?? '') as ProcessExtensionLike | undefined;
      const decision = (reference: string): DecisionLike | undefined => {
        const found = catalog.decision(reference);
        return found ? { id: found.decision.id, ...(found.decision.name ? { name: found.decision.name } : {}), outputs: found.decision.outputs.map((o) => ({ ...(o.name ? { name: o.name } : {}), ...(o.type ? { type: o.type } : {}) })) } : undefined;
      };
      const outline = extractOutline({ root: container, extension, decision });
      const variables: unknown[] = outline.variables.map((v) => toResolverVariable(v, container));
      // variable providers registered with the package (VariableProvider) add theirs
      const elements = [container, ...flowElementsOf(container)];
      for (const extractor of additionalExtractors as AdditionalExtractor[]) await extractor({ elements, containerElement: container, processVariables: variables });
      return variables;
    };
    this._getScope = (_element, container) => container;
    // the extensions file and the project (DMN decisions) are not part of the diagram: tell the resolver when they change
    eventBus.on([EXTENSIONS_CHANGED, PROJECT_CHANGED], () => {
      this.invalidateCache();
      eventBus.fire('variables.changed');
    });
  }
}

/** bpmn-js module: the `variableResolver` service for Activiti. */
export const ActivitiVariablesModule = {
  __init__: ['variableResolver'],
  variableResolver: ['type', ActivitiVariableResolver],
};

export const VARIABLES_CHANGED = 'variables.changed';
