import { activityAccessors } from './activity';
import { decisionAccessors } from './decision';
import { definitionsAccessors } from './definitions';
import { eventAccessors } from './events';
import { flowAccessors } from './flow';
import { generalAccessors } from './general';
import { implementationAccessors } from './implementation';
import { listenerAccessors } from './listeners';
import { mappingAccessors } from './mapping';
import { templateAccessors } from './templates';
import { userAccessors } from './user';
import { AccessorError, type AccessorContext, type AnyAccessor, type BpmnReplace, type Moddle, type PropertyAccessor } from './types';
import type { BpmnFactory, CommandStack, DiagramElement, ElementRegistry, Modeling } from '../../types';
import type { ExtensionsStore } from '../extensions';
import { ProjectModule, type ProjectCatalog } from '../project/ProjectCatalog';

export * from './types';
export { assertNcName } from './helpers';
export type { FieldInput } from './implementation';
export type { ListenerValue, EventListenerValue } from './listeners';
export type { CallParameter } from './implementation';
export type { MapExceptionValue, MultiInstanceType } from './activity';
export type { TimerValue, EventDefinitionName } from './events';
export type { CustomResourceValue, FormPropertyValue } from './user';
export type { MappingInputs, MappingOutputs } from './mapping';
export { DMN_MATCHED, DMN_MATCHED_RULES, decisionOf, decisionSourceTypes, variableTypeOfFeel, type DecisionPick } from './decision';
export { mergeActionMapping, type TemplateInfo, type TemplateState } from './templates';
export type { MessageInput, SignalInput, ErrorInput } from './definitions';
export type { VariableInput, VariableUse } from './general';
export { implementationTypeOf, type ImplementationType } from './implementation';
export { ENTITY_TYPES, EXECUTION_EVENTS, TASK_EVENTS, TRANSACTION_MODES } from './listeners';
export { DATA_TYPES, type DataObjectInput } from './flow';
export { usageOf, referencesBelow, type DefinitionsUsage } from './definitions';
export { compensationTargets, eventPlacement, linkCatchEvents, variableSuggestions, type CompensationTarget, type ElementChoice, type EventPlacement, type VariableKind, type VariableSuggestion } from './queries';

/** Every FEATURE_MATRIX §B accessor of the core set, in panel order. */
export const ACCESSORS: readonly AnyAccessor[] = [
  ...generalAccessors,
  ...userAccessors,
  ...implementationAccessors,
  ...activityAccessors,
  ...eventAccessors,
  ...listenerAccessors,
  ...flowAccessors,
  ...definitionsAccessors,
  ...mappingAccessors,
  ...decisionAccessors,
  ...templateAccessors,
];

interface InjectorLike {
  get<T>(name: string, strict?: boolean): T;
}

interface BatchContext {
  run: () => void;
  error?: unknown;
}

/** Nested commands run inside one command, so one undo reverts them all; errors are reported after the command ends. */
class BatchHandler {
  preExecute(context: BatchContext): void {
    try {
      context.run();
    } catch (e) {
      context.error = e;
    }
  }
  execute(): void {}
  revert(): void {}
}

/**
 * The `propertyAccessors` service: one get / set per FEATURE_MATRIX §B entry, implemented as diagram-js commands on the
 * XML and on the extensions store. The properties panel and `window.__modelerTestApi` both call it.
 */
export class PropertyAccessors {
  static $inject = ['injector'];

  private readonly byKey = new Map<string, AnyAccessor>(ACCESSORS.map((a) => [a.key, a]));
  private readonly injector: InjectorLike;
  private context: AccessorContext | undefined;

  constructor(injector: InjectorLike) {
    this.injector = injector;
    injector.get<CommandStack>('commandStack').registerHandler('activiti.batch', BatchHandler);
    if (this.byKey.size !== ACCESSORS.length) throw new Error('duplicate accessor key');
  }

  private ctx(): AccessorContext {
    if (!this.context) {
      const commandStack = this.injector.get<CommandStack>('commandStack');
      this.context = {
        modeling: this.injector.get<Modeling>('modeling'),
        bpmnFactory: this.injector.get<BpmnFactory>('bpmnFactory'),
        bpmnReplace: this.injector.get<BpmnReplace>('bpmnReplace'),
        moddle: this.injector.get<Moddle>('moddle'),
        commandStack,
        elementRegistry: this.injector.get<ElementRegistry>('elementRegistry'),
        store: this.injector.get<ExtensionsStore>('extensionsStore'),
        catalog: this.injector.get<ProjectCatalog>('projectCatalog'),
        batch: (fn) => this.batch(fn),
        run: (element, key, value) => {
          const el = this.resolve(element);
          const accessor = this.accessor(key) as PropertyAccessor;
          if (!accessor.appliesTo(el)) throw new AccessorError('NOT_APPLICABLE', key, `${key} does not apply to ${el.id} (${el.type})`);
          accessor.set(this.ctx(), el, value);
        },
      };
    }
    return this.context;
  }

  /** Runs `fn` (any commands, accessor sets included) as one undoable step; on an error the partial work is undone and the error rethrown. */
  atomically(fn: () => void): void {
    this.batch(fn);
  }

  private batch(fn: () => void): void {
    const commandStack = this.injector.get<CommandStack>('commandStack');
    const context: BatchContext = { run: fn };
    commandStack.execute('activiti.batch', context as unknown as Record<string, unknown>);
    if (context.error !== undefined) {
      commandStack.undo();
      // drop the undone step so a redo cannot replay half of it
      const internal = commandStack as unknown as { _stack?: unknown[]; _stackIdx?: number };
      if (internal._stack && typeof internal._stackIdx === 'number') internal._stack.length = internal._stackIdx + 1;
      throw context.error;
    }
  }

  private resolve(element: DiagramElement | string): DiagramElement {
    if (typeof element !== 'string') return element;
    const found = this.ctx().elementRegistry.get(element);
    if (!found) throw new AccessorError('UNKNOWN_ELEMENT', '', `no element with id ${element}`);
    return found;
  }

  /** All accessor keys. */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  accessor(key: string): AnyAccessor {
    const accessor = this.byKey.get(key);
    if (!accessor) throw new AccessorError('UNKNOWN_ACCESSOR', key, `unknown accessor "${key}"`);
    return accessor;
  }

  /** The accessors that apply to an element, for the panel to render. */
  applicable(element: DiagramElement | string): AnyAccessor[] {
    const el = this.resolve(element);
    return ACCESSORS.filter((a) => (a as PropertyAccessor).appliesTo(el));
  }

  has(element: DiagramElement | string, key: string): boolean {
    return (this.accessor(key) as PropertyAccessor).appliesTo(this.resolve(element));
  }

  get<T = unknown>(element: DiagramElement | string, key: string): T {
    const el = this.resolve(element);
    const accessor = this.accessor(key) as PropertyAccessor<T>;
    if (!accessor.appliesTo(el)) throw new AccessorError('NOT_APPLICABLE', key, `${key} does not apply to ${el.id} (${el.type})`);
    return accessor.get(this.ctx(), el);
  }

  set<T = unknown>(element: DiagramElement | string, key: string, value: T): void {
    const el = this.resolve(element);
    const accessor = this.accessor(key) as PropertyAccessor<T>;
    if (!accessor.appliesTo(el)) throw new AccessorError('NOT_APPLICABLE', key, `${key} does not apply to ${el.id} (${el.type})`);
    this.batch(() => accessor.set(this.ctx(), el, value));
  }
}

export const AccessorsModule = {
  __depends__: [ProjectModule] as unknown[],
  __init__: ['propertyAccessors'],
  propertyAccessors: ['type', PropertyAccessors],
};
