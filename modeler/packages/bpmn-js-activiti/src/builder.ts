import { judge, placementOf, specOfBusinessObject } from './support-matrix';
import type { PropertyAccessors } from './modules/accessors';
import type { ExtensionsStore } from './modules/extensions';
import { exportProcess, type ExportableModeler } from './export';
import { type BpmnFactory, type DiagramElement, type ElementRegistry, type Modeling, type ModdleElement, is } from './types';
import type { ProcessVariablesMapping } from '@activiti-modeler/activiti-project';

/** bpmn: type names may be written short (`userTask`) or in full (`bpmn:UserTask`). */
export function normalizeType(type: string): string {
  const name = type.startsWith('bpmn:') ? type.slice(5) : type;
  return `bpmn:${name[0]!.toUpperCase()}${name.slice(1)}`;
}

export type EventDefinitionKind = 'message' | 'timer' | 'signal' | 'error' | 'terminate' | 'cancel' | 'compensate' | 'link' | 'escalation' | 'conditional';

export interface ShapeSpec {
  type: string;
  id?: string;
  name?: string;
  /** Id of the sub process or pool to create it in; defaults to the process level. */
  parent?: string;
  /** Centre of the shape; omitted: right of the previous shape of that container (or `after`). */
  at?: { x: number; y: number };
  after?: string;
  /** Added to the vertical position when placed `after` another shape. */
  dy?: number;
  /** For events: the definition (none when omitted). */
  eventDefinition?: EventDefinitionKind;
  /** Start events of an event sub process; boundary events use `cancelActivity`. */
  interrupting?: boolean;
  /** Boundary events: the activity they attach to. */
  attachedTo?: string;
  isExpanded?: boolean;
  /** Size of the shape in pixels (an expanded sub process that has to hold its content); the default size of the type otherwise. */
  size?: { width: number; height: number };
  triggeredByEvent?: boolean;
  /** Extra moddle attributes of the business object, e.g. `{ implementation: 'mailer.SEND' }`. */
  attrs?: Record<string, unknown>;
  /** Skip the support-matrix check (negative tests that build a construct Activiti does not run). */
  allowHidden?: boolean;
  /**
   * Pools: the process the pool runs (id, name, documentation; executable). The first pool created in an open, empty process takes that
   * process over (bpmn-js turns the diagram into a collaboration), so only the later pools need it; without it bpmn-js gives the pool a
   * process with a generated id.
   */
  process?: { id: string; name?: string; documentation?: string };
  /** Pools: a black box pool (collapsed, no process). */
  blackBox?: boolean;
}

/** A value for `DiagramBuilder.setModdleProperty`: plain, a reference to an element / root element by id, or a root element found (or created) by name. */
export type ModdleValue = string | number | boolean | undefined | { ref: string } | { root: string; name: string };

export interface ConnectSpec {
  id?: string;
  /** `sequenceFlow` (default), `messageFlow`, `association`. */
  type?: string;
  name?: string;
  attrs?: Record<string, unknown>;
}

/**
 * Programmatic modeling on a live bpmn-js modeler: creates shapes and connections through the same commands and the
 * same `propertyAccessors` service as the UI. `window.__modelerTestApi` and the corpus `build.ts` files use it, so a
 * generated model is written by exactly the code a user's clicks go through.
 */
export class DiagramBuilder {
  private readonly modeling: Modeling;
  private readonly registry: ElementRegistry;
  private readonly bpmnFactory: BpmnFactory;
  private readonly accessors: PropertyAccessors;
  private readonly store: ExtensionsStore;
  private readonly elementFactory: { createShape(attrs: Record<string, unknown>): DiagramElement; createParticipantShape(attrs?: unknown): DiagramElement };
  private readonly canvas: { getRootElement(): DiagramElement };

  constructor(private readonly modeler: ExportableModeler) {
    this.modeling = modeler.get<Modeling>('modeling');
    this.registry = modeler.get<ElementRegistry>('elementRegistry');
    this.bpmnFactory = modeler.get<BpmnFactory>('bpmnFactory');
    this.accessors = modeler.get<PropertyAccessors>('propertyAccessors');
    this.store = modeler.get<ExtensionsStore>('extensionsStore');
    this.elementFactory = modeler.get('elementFactory');
    this.canvas = modeler.get('canvas');
  }

  element(id: string): DiagramElement {
    const element = this.registry.get(id);
    if (!element) throw new Error(`no element with id ${id}`);
    return element;
  }

  /** The container shapes go into by default: the first pool of a collaboration, else the process root. */
  private defaultParent(): DiagramElement {
    const root = this.canvas.getRootElement();
    if (is(root, 'bpmn:Collaboration')) {
      const pool = (root.children ?? []).find((c) => is(c, 'bpmn:Participant'));
      if (pool) return pool;
    }
    return root;
  }

  private nextPosition(parent: DiagramElement, size: { width: number; height: number }, spec: ShapeSpec): { x: number; y: number } {
    if (spec.at) return spec.at;
    if (spec.after) {
      const after = this.element(spec.after);
      return { x: after.x + after.width + 70 + size.width / 2, y: after.y + after.height / 2 + (spec.dy ?? 0) };
    }
    const siblings = (parent.children ?? []).filter((c) => !c.waypoints && !c.labelTarget && !c.host && !is(c, 'bpmn:Lane'));
    const isRoot = parent === this.canvas.getRootElement();
    const left = siblings.length > 0 ? Math.max(...siblings.map((c) => c.x + c.width)) + 70 : isRoot ? 150 : parent.x + 50;
    const centreY = isRoot ? 200 : parent.y + parent.height / 2;
    return { x: left + size.width / 2, y: centreY + (spec.dy ?? 0) };
  }

  /** Creates a shape and returns its id. */
  createShape(spec: ShapeSpec): string {
    const type = normalizeType(spec.type);
    const parent = spec.parent ? this.element(spec.parent) : spec.attachedTo ? this.element(spec.attachedTo).parent! : this.defaultParent();
    const attrs: Record<string, unknown> = { ...spec.attrs };
    if (spec.id) attrs['id'] = spec.id;
    if (spec.name) attrs['name'] = spec.name;
    if (spec.triggeredByEvent) attrs['triggeredByEvent'] = true;
    if (spec.interrupting === false) attrs[type === 'bpmn:BoundaryEvent' ? 'cancelActivity' : 'isInterrupting'] = false;
    const bo = this.bpmnFactory.create(type, attrs);
    if (spec.eventDefinition) {
      const definition = this.bpmnFactory.create(`bpmn:${spec.eventDefinition[0]!.toUpperCase()}${spec.eventDefinition.slice(1)}EventDefinition`);
      bo.set('eventDefinitions', [definition]);
    }
    const host = spec.attachedTo ? this.element(spec.attachedTo) : undefined;
    const spec2 = specOfBusinessObject(bo, { isExpanded: spec.isExpanded });
    const verdict = judge(spec2, placementOf(parent.businessObject, host?.businessObject));
    if (!verdict.allowed && !spec.allowHidden) throw new Error(`cannot create ${type}${spec.id ? ` "${spec.id}"` : ''}: ${verdict.reason}`);

    if (type === 'bpmn:Participant') {
      let process: ModdleElement | undefined;
      if (spec.process && is(this.canvas.getRootElement(), 'bpmn:Collaboration')) {
        const { id, name, documentation } = spec.process;
        process = this.bpmnFactory.create('bpmn:Process', { id, isExecutable: true, ...(name ? { name } : {}) });
        if (documentation) process.set('documentation', [this.bpmnFactory.create('bpmn:Documentation', { text: documentation })]);
      }
      const pool = this.elementFactory.createParticipantShape({ businessObject: bo, ...(spec.blackBox ? { isExpanded: false } : {}), ...(spec.size ?? {}) });
      // bpmn-js gives every expanded pool a new process of its own; the one asked for replaces it (the shape is not in the diagram yet)
      if (process && !spec.blackBox) pool.businessObject.set('processRef', process);
      return this.modeling.createShape(pool, spec.at ?? { x: 400, y: 300 }, this.canvas.getRootElement(), {}).id;
    }
    const shapeAttrs: Record<string, unknown> = { type, businessObject: bo };
    if (spec.size) Object.assign(shapeAttrs, spec.size);
    if (spec.isExpanded !== undefined) shapeAttrs['isExpanded'] = spec.isExpanded;
    else if (type === 'bpmn:SubProcess' || type === 'bpmn:Transaction') shapeAttrs['isExpanded'] = true;
    const shape = this.elementFactory.createShape(shapeAttrs);

    if (host) {
      const position = spec.at ?? { x: host.x + host.width / 2 - 24 + (host.attachers?.length ?? 0) * 40, y: host.y + host.height };
      return this.modeling.createShape(shape, position, host, { attach: true }).id;
    }
    const position = this.nextPosition(parent, { width: shape.width, height: shape.height }, spec);
    return this.modeling.createShape(shape, position, parent).id;
  }

  /**
   * Adds a lane to a pool (below the existing lanes by default) and returns its id. The first lane of a pool makes bpmn-js create two
   * lanes, the one that takes over the pool's content and the new one; `first` names the former.
   */
  createLane(participantId: string, options: { id?: string; name?: string; position?: 'top' | 'bottom'; first?: { id?: string; name?: string } } = {}): string {
    const pool = this.element(participantId);
    const before = new Set((pool.children ?? []).filter((c) => is(c, 'bpmn:Lane')).map((c) => c.id));
    const lane = (this.modeling as unknown as { addLane(target: DiagramElement, location: string): DiagramElement }).addLane(pool, options.position ?? 'bottom');
    if (options.id || options.name) this.modeling.updateProperties(lane, { ...(options.id ? { id: options.id } : {}), ...(options.name ? { name: options.name } : {}) });
    if (options.first && before.size === 0) {
      const first = (pool.children ?? []).find((c) => is(c, 'bpmn:Lane') && c !== lane);
      if (first) this.modeling.updateProperties(first, { ...(options.first.id ? { id: options.first.id } : {}), ...(options.first.name ? { name: options.first.name } : {}) });
    }
    return lane.id;
  }

  /** Deletes elements (and what they contain) through the modeling command, like selecting them and pressing Delete. */
  removeElements(elementIds: string[]): void {
    this.modeling.removeElements(elementIds.map((id) => this.element(id)));
  }

  /** Adds a root element (message, signal, error, data store, ...) to the definitions and returns its id. */
  addRootElement(type: string, attrs: Record<string, unknown> = {}): string {
    const definitions = this.definitions();
    const created = this.bpmnFactory.create(normalizeType(type), attrs);
    this.modeling.updateModdleProperties(this.canvas.getRootElement(), definitions, { rootElements: [...((definitions.get('rootElements') as ModdleElement[] | undefined) ?? []), created] });
    return created.id as string;
  }

  private definitions(): ModdleElement {
    let current: ModdleElement | undefined = this.canvas.getRootElement().businessObject;
    while (current && current.$type !== 'bpmn:Definitions') current = current.$parent;
    if (!current) throw new Error('the diagram has no bpmn:Definitions');
    return current;
  }

  /**
   * Sets one property of an element's business object through the modeling command (undoable), for what the properties panel does not
   * offer an accessor for: the `messageRef` of a message flow, the `dataStoreRef` of a data store reference, the id of a collaboration
   * (`<pool>#laneSet` as the element id addresses the lane set of a pool, for its id).
   * The value can be a plain value, `{ ref }` (an element of the diagram or a root element, by id) or `{ root, name }` (the root element
   * of that type with that name, created when there is none).
   */
  setModdleProperty(elementId: string, property: string, value: ModdleValue): void {
    // `<pool>#laneSet` addresses the lane set of the pool's process (it has no shape of its own)
    const hash = elementId.indexOf('#');
    if (hash > 0 && elementId.slice(hash + 1) === 'laneSet') {
      const pool = this.element(elementId.slice(0, hash));
      const laneSet = ((pool.businessObject.get('processRef') as ModdleElement | undefined)?.get('laneSets') as ModdleElement[] | undefined)?.[0];
      if (!laneSet) throw new Error(`${pool.id} has no lane set`);
      this.modeling.updateModdleProperties(pool, laneSet, { [property]: value });
      return;
    }
    const element = this.element(elementId);
    let resolved: unknown = value;
    if (value && typeof value === 'object' && 'ref' in value) {
      const target = this.registry.get(value.ref)?.businessObject ?? ((this.definitions().get('rootElements') as ModdleElement[] | undefined) ?? []).find((r) => r.id === value.ref);
      if (!target) throw new Error(`no element or root element with id ${value.ref}`);
      resolved = target;
    } else if (value && typeof value === 'object') {
      const type = normalizeType(value.root);
      const existing = ((this.definitions().get('rootElements') as ModdleElement[] | undefined) ?? []).find((r) => r.$instanceOf(type) && r.get('name') === value.name);
      if (existing) resolved = existing;
      else resolved = this.bpmnFactory.create(type, { name: value.name });
    }
    if (property === 'id') this.modeling.updateProperties(element, { id: resolved as string });
    else this.modeling.updateModdleProperties(element, element.businessObject, { [property]: resolved });
  }

  /** Colours shapes and connections the way the bpmn-js colour picker does (`bioc:` and `color:` attributes). */
  setColor(elementIds: string[], colors: { fill?: string; stroke?: string }): void {
    (this.modeling as unknown as { setColor(elements: DiagramElement[], colors: { fill?: string; stroke?: string }): void }).setColor(elementIds.map((id) => this.element(id)), colors);
  }

  /** Creates a shape `after` another and connects them with a sequence flow. */
  appendShape(sourceId: string, spec: ShapeSpec, flow: ConnectSpec = {}): { id: string; flow: string } {
    const id = this.createShape({ after: sourceId, parent: this.element(sourceId).parent?.id, ...spec });
    return { id, flow: this.connect(sourceId, id, flow) };
  }

  connect(sourceId: string, targetId: string, spec: ConnectSpec = {}): string {
    const source = this.element(sourceId);
    const target = this.element(targetId);
    const type = normalizeType(spec.type ?? 'sequenceFlow');
    // modeling.connect with explicit attributes skips the rules, so ask them first (event-based gateway targets, ...)
    const allowed = this.modeler.get<{ allowed(rule: string, context: Record<string, unknown>): unknown }>('rules').allowed('connection.create', { source, target, hints: {} });
    if (!allowed || (typeof allowed === 'object' && (allowed as { type?: string }).type !== type)) {
      throw new Error(`${type} from ${sourceId} to ${targetId} is not allowed`);
    }
    const attrs: Record<string, unknown> = { type, ...(spec.id || spec.name || spec.attrs ? { businessObject: this.bpmnFactory.create(type, { ...spec.attrs, ...(spec.id ? { id: spec.id } : {}), ...(spec.name ? { name: spec.name } : {}) }) } : {}) };
    const connection = this.modeling.connect(source, target, attrs);
    if (!connection) throw new Error(`${type} from ${sourceId} to ${targetId} is not allowed`);
    return connection.id;
  }

  /** Sets a property through the accessor of that key (the code the properties panel calls). */
  setProperty(elementId: string, key: string, value: unknown): void {
    this.accessors.set(elementId, key, value);
  }

  getProperty(elementId: string, key: string): unknown {
    return this.accessors.get(elementId, key);
  }

  /**
   * Adds a moddle element (for example `activiti:FailedJobRetryTimeCycle`, `{ body: 'R1/PT5S' }`) to the extension elements of an element
   * through the modeling command, bypassing the applicability check of the accessors. For constructs the properties panel does not offer
   * for that element but that a file can contain, and that the corpus keeps on purpose because the engine ignores them (lint L31: the retry
   * cycle on an element that is not a service task). Everything the panel offers goes through `setProperty` instead.
   */
  addExtensionElement(elementId: string, type: string, properties: Record<string, unknown> = {}): void {
    const element = this.element(elementId);
    const holder = element.businessObject;
    const created = this.bpmnFactory.create(type, properties);
    const container = holder.get('extensionElements') as ModdleElement | undefined;
    if (container) {
      this.modeling.updateModdleProperties(element, container, { values: [...((container.get('values') as ModdleElement[] | undefined) ?? []), created] });
    } else {
      this.modeling.updateModdleProperties(element, holder, { extensionElements: this.bpmnFactory.create('bpmn:ExtensionElements', { values: [created] }) });
    }
  }

  /** Sets the whole input / output mapping of an element in the extensions store. */
  setMapping(elementId: string, mapping: ProcessVariablesMapping | undefined): void {
    const processId = this.processIdOf(elementId);
    this.store.setMapping(processId, elementId, mapping);
  }

  setConstants(elementId: string, constants: Record<string, unknown>): void {
    this.accessors.set(elementId, 'constants.values', constants);
  }

  private processIdOf(elementId: string): string {
    const element = this.element(elementId);
    for (let bo: ModdleElement | undefined = element.businessObject; bo; bo = bo.$parent) {
      if (bo.$instanceOf('bpmn:Process')) return bo.id as string;
      if (bo.$instanceOf('bpmn:Participant')) return (bo.get('processRef') as ModdleElement).id as string;
    }
    throw new Error(`${elementId} is not inside a process`);
  }

  export(name?: string): ReturnType<typeof exportProcess> {
    return exportProcess(this.modeler, name);
  }
}
