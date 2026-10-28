import type { DiagramElement } from '../../types';
import { templateInfoOf, type TemplateInfo } from '../accessors/templates';
import type { PropertyAccessors } from '../accessors';
import type { ProjectCatalog } from '../project/ProjectCatalog';
import { buildTemplates, templateLinkOf, type ActivitiElementTemplate } from './templates';

interface EventBusLike {
  fire(type: string, data?: Record<string, unknown>): unknown;
  on(type: string, handler: (event: never) => void): void;
}
interface ElementRegistryLike {
  get(id: string): DiagramElement | undefined;
}
interface SelectionLike {
  select(element: DiagramElement): void;
}
interface ModelingLike {
  appendShape(source: DiagramElement, shape: unknown, position: { x: number; y: number }): DiagramElement;
}
interface AutoPlaceLike {
  append(source: DiagramElement, shape: unknown): DiagramElement;
}
interface ElementFactoryLike {
  createShape(attrs: Record<string, unknown>): DiagramElement;
}

export const TEMPLATES_CHANGED = 'elementTemplates.changed';
/** Fired (with `{ element }`) to ask for the template chooser; `@bpmn-io/element-template-chooser` answers it. */
export const TEMPLATES_SELECT = 'elementTemplates.select';

/** The elements a template can be applied to in place. */
export const isTemplatable = (element: DiagramElement | undefined): boolean => !!element && !element.labelTarget && ['bpmn:Task', 'bpmn:ServiceTask', 'bpmn:SendTask'].includes(element.type);

/**
 * The `elementTemplates` service of the `@bpmn-io/element-template-chooser` contract (`getLatest`, `applyTemplate`) over the generated
 * templates of the project. Everything it writes goes through the `template.*` accessors, so the panel, the chooser and the test API
 * share one code path and one undo step per template action.
 */
export class ElementTemplates {
  static $inject = ['eventBus', 'propertyAccessors', 'projectCatalog', 'elementRegistry', 'selection', 'modeling', 'elementFactory', 'injector'];

  private extra: ActivitiElementTemplate[] = [];

  constructor(
    private readonly eventBus: EventBusLike,
    private readonly accessors: PropertyAccessors & { atomically(fn: () => void): void },
    private readonly catalog: ProjectCatalog,
    private readonly registry: ElementRegistryLike,
    private readonly selection: SelectionLike,
    private readonly modeling: ModelingLike,
    private readonly elementFactory: ElementFactoryLike,
    private readonly injector: { get<T>(name: string, strict?: boolean): T },
  ) {
    eventBus.on('activiti.project.changed', (() => eventBus.fire(TEMPLATES_CHANGED)) as never);
  }

  /** Templates added by `elementTemplatesLoader.setTemplates` (custom ones) after the generated ones. */
  setExtra(templates: ActivitiElementTemplate[]): void {
    this.extra = templates;
    this.eventBus.fire(TEMPLATES_CHANGED);
  }

  /** Every template, in a stable order: the built-ins, the connector actions, the custom ones. */
  getAll(): ActivitiElementTemplate[] {
    return [...buildTemplates(this.catalog.connectors), ...this.extra];
  }

  get(id: string): ActivitiElementTemplate | undefined {
    return this.getAll().find((t) => t.id === id);
  }

  /** The templates the chooser offers for `element`: those that apply to its type; for any other flow node, the templates of a task appended to it. */
  getLatest(element?: DiagramElement): ActivitiElementTemplate[] {
    const all = this.getAll();
    if (!element) return all;
    if (isTemplatable(element)) return all.filter((t) => t.appliesTo.includes(element.type));
    return all.filter((t) => t.appliesTo.includes('bpmn:ServiceTask'));
  }

  /** Link and state of the template an element was created from. */
  infoOf(element: DiagramElement): TemplateInfo | undefined {
    return templateInfoOf({ catalog: this.catalog } as never, element);
  }

  linkOf(element: DiagramElement): { id: string; version: string } | undefined {
    return templateLinkOf(element.businessObject);
  }

  /**
   * Applies `template` to a task, or - when `element` is any other flow node - to a new task appended after it. Returns the element that
   * carries the template. An abstract task is replaced by a service task of the same id.
   */
  applyTemplate(element: DiagramElement, template: ActivitiElementTemplate | string): DiagramElement {
    const id = typeof template === 'string' ? template : template.id;
    if (isTemplatable(element)) {
      this.accessors.set(element, 'template.apply', { id });
      const applied = this.registry.get(element.id) ?? element;
      this.selection.select(applied);
      return applied;
    }
    let created: DiagramElement | undefined;
    this.accessors.atomically(() => {
      const shape = this.elementFactory.createShape({ type: 'bpmn:ServiceTask' });
      const autoPlace = this.injector.get<AutoPlaceLike | null>('autoPlace', false);
      created = autoPlace ? autoPlace.append(element, shape) : this.modeling.appendShape(element, shape, { x: element.x + element.width + 130, y: element.y + element.height / 2 });
      this.accessors.set(created, 'template.apply', { id });
    });
    const applied = this.registry.get(created!.id) ?? created!;
    this.selection.select(applied);
    return applied;
  }

  unlinkTemplate(element: DiagramElement): void {
    this.accessors.set(element, 'template.unlink', true);
  }

  updateTemplate(element: DiagramElement): void {
    this.accessors.set(element, 'template.update', true);
  }

  /** Asks for the chooser for `element` (a task to apply a template to, or a flow node to append a templated task to). */
  choose(element: DiagramElement): void {
    this.eventBus.fire(TEMPLATES_SELECT, { element });
  }
}

/** Where custom templates come from. The generated ones need no loader; `setTemplates` adds hand-written ones (the chooser's documented API). */
export class ElementTemplatesLoader {
  static $inject = ['elementTemplates'];

  private loaded: ActivitiElementTemplate[] = [];

  constructor(private readonly templates: ElementTemplates) {}

  setTemplates(templates: ActivitiElementTemplate[]): void {
    this.loaded = templates;
    this.templates.setExtra(templates);
  }

  getTemplates(): ActivitiElementTemplate[] {
    return this.loaded;
  }
}
