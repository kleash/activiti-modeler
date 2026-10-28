import type { BpmnFactory, DiagramElement, ModdleElement, Modeling, CommandStack, ElementRegistry } from '../../types';
import type { ExtensionsStore } from '../extensions';
import type { ProjectCatalog } from '../project/ProjectCatalog';

export interface BpmnReplace {
  replaceElement(element: DiagramElement, target: Record<string, unknown>, hints?: Record<string, unknown>): DiagramElement;
}

export interface Moddle {
  create(type: string, attrs?: Record<string, unknown>): ModdleElement;
  ids: { assigned(id: string): unknown; claim(id: string, element: ModdleElement): void; unclaim(id: string): void };
}

/** Services an accessor may use. */
export interface AccessorContext {
  modeling: Modeling;
  bpmnFactory: BpmnFactory;
  bpmnReplace: BpmnReplace;
  moddle: Moddle;
  commandStack: CommandStack;
  elementRegistry: ElementRegistry;
  store: ExtensionsStore;
  /** The connectors, DMN decisions and processes of the project (read only; the host fills it). */
  catalog: ProjectCatalog;
  /** Runs `fn` as one undoable step. */
  batch(fn: () => void): void;
  /** Runs another accessor inside the current step (an accessor that composes others, such as applying a template). */
  run(element: DiagramElement | string, key: string, value: unknown): void;
}

export class AccessorError extends Error {
  readonly code: string;
  readonly key: string;
  constructor(code: string, key: string, message: string) {
    super(message);
    this.name = 'AccessorError';
    this.code = code;
    this.key = key;
  }
}

/** One get / set pair of a FEATURE_MATRIX §B entry. */
export interface PropertyAccessor<T = unknown> {
  /** `group.field`, e.g. `user.assignee`. */
  key: string;
  /** FEATURE_MATRIX §B group. */
  group: string;
  label: string;
  /** What `set` changes: the BPMN XML or the extensions JSON. */
  writes: 'xml' | 'ext';
  appliesTo(element: DiagramElement): boolean;
  get(ctx: AccessorContext, element: DiagramElement): T;
  /** Executes diagram-js commands; throws AccessorError (without changing anything) for an invalid value. */
  set(ctx: AccessorContext, element: DiagramElement, value: T): void;
}

export type AnyAccessor = PropertyAccessor<never> | PropertyAccessor<unknown>;
