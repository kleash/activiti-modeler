import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import './viewer.css';

import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

import { FLOW_TAKEN_CLASS, markerClass, type DiagramStructure, type ViewerOverlays } from './states';

interface Shape {
  id: string;
  type: string;
  parent?: Shape;
  businessObject?: { triggeredByEvent?: boolean; $type?: string };
  waypoints?: unknown[];
  labelTarget?: unknown;
}

interface ViewerServices {
  canvas: {
    addMarker(element: string | Shape, marker: string): void;
    removeMarker(element: string | Shape, marker: string): void;
    zoom(level?: string | number, center?: string | { x: number; y: number }): number;
    resized(): void;
    getRootElement(): Shape;
    scrollToElement(element: string | Shape, padding?: object): void;
  };
  elementRegistry: { get(id: string): Shape | undefined; getAll(): Shape[]; forEach(fn: (element: Shape) => void): void };
  overlays: { add(element: string | Shape, type: string, overlay: object): string; remove(filter: { type: string }): void };
  eventBus: { on(event: string, callback: (event: { element: Shape }) => void): void };
}

export interface BpmnViewerOptions {
  container: HTMLElement;
  /** Extra didi modules (for example the token simulation). */
  additionalModules?: unknown[];
  /** Called when an element of the diagram is clicked (`undefined` for a click on the empty canvas). */
  onElementClick?: (id: string | undefined, type: string | undefined) => void;
}

/** The ids of all flow nodes and sequence flows of the loaded diagram, by kind. */
export interface DiagramElements {
  nodes: string[];
  flows: string[];
}

const SHAPE_FILTER = (e: Shape): boolean => !e.labelTarget && e.type !== 'label' && e.type !== 'bpmn:Process' && e.type !== 'bpmn:Collaboration';

/**
 * A read-only BPMN diagram (bpmn-js `NavigatedViewer`: pan and zoom, no editing) that can mark where an instance is and what it did:
 * tokens on the active elements, the completed path, the sequence flows taken, incidents on elements with a failed or dead-letter job.
 * The "powered by bpmn.io" watermark of bpmn-js is kept (licence); the container must leave it visible.
 *
 * The same class serves the modeler's instance view and the scenario path overlay.
 */
export class BpmnDiagramViewer {
  private readonly viewer: NavigatedViewer;
  private readonly services: () => ViewerServices;
  private marked: Array<{ id: string; marker: string }> = [];
  private selected: string | undefined;
  private loaded = false;

  constructor(private readonly options: BpmnViewerOptions) {
    this.viewer = new NavigatedViewer({
      container: options.container,
      ...(options.additionalModules ? { additionalModules: options.additionalModules } : {}),
    } as never);
    this.services = () => ({
      canvas: this.viewer.get('canvas') as never,
      elementRegistry: this.viewer.get('elementRegistry') as never,
      overlays: this.viewer.get('overlays') as never,
      eventBus: this.viewer.get('eventBus') as never,
    });
    const { eventBus } = this.services();
    eventBus.on('element.click', (event) => {
      const element = event.element;
      if (!element) return;
      if (element.type === 'bpmn:Process' || element.type === 'bpmn:Collaboration' || element.id === '__implicitroot') options.onElementClick?.(undefined, undefined);
      else options.onElementClick?.(element.id, element.type);
    });
  }

  /** The bpmn-js viewer itself, for modules that need it (token simulation). */
  get raw(): NavigatedViewer {
    return this.viewer;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Shows a diagram; a previous one and its overlays are replaced. Rejects when the XML cannot be imported. */
  async load(xml: string): Promise<{ warnings: string[] }> {
    this.marked = [];
    this.selected = undefined;
    const result = await this.viewer.importXML(xml);
    this.loaded = true;
    this.services().canvas.zoom('fit-viewport', 'auto');
    return { warnings: (result.warnings ?? []).map((w) => (w as { message?: string }).message ?? String(w)) };
  }

  /** Re-fits the diagram after the container changed size. */
  resize(): void {
    if (!this.loaded) return;
    this.services().canvas.resized();
  }

  fit(): void {
    if (this.loaded) this.services().canvas.zoom('fit-viewport', 'auto');
  }

  zoomBy(factor: number): void {
    if (!this.loaded) return;
    const { canvas } = this.services();
    canvas.zoom(canvas.zoom() * factor);
  }

  /** What the loaded diagram contains: flow node ids and sequence flow ids. */
  elements(): DiagramElements {
    const result: DiagramElements = { nodes: [], flows: [] };
    if (!this.loaded) return result;
    this.services().elementRegistry.forEach((element) => {
      if (!SHAPE_FILTER(element)) return;
      if (element.waypoints) result.flows.push(element.id);
      else result.nodes.push(element.id);
    });
    return result;
  }

  has(id: string): boolean {
    return this.loaded && this.services().elementRegistry.get(id) !== undefined;
  }

  /** The structure the overlay inference needs (containers, event sub processes). */
  structure(): DiagramStructure {
    const registry = () => this.services().elementRegistry;
    return {
      parentOf: (id) => {
        const parent = registry().get(id)?.parent;
        return parent && SHAPE_FILTER(parent) && parent.type !== 'bpmn:Participant' && parent.type !== 'bpmn:Lane' ? parent.id : undefined;
      },
      isEventSubProcess: (id) => registry().get(id)?.businessObject?.triggeredByEvent === true,
      has: (id) => registry().get(id) !== undefined,
    };
  }

  /** Marks active tokens, completed path, flows taken and incidents. Earlier overlays are removed first. */
  setOverlays(overlays: ViewerOverlays): void {
    if (!this.loaded) return;
    const { canvas, elementRegistry, overlays: overlayService } = this.services();
    for (const { id, marker } of this.marked) {
      if (elementRegistry.get(id)) canvas.removeMarker(id, marker);
    }
    this.marked = [];
    overlayService.remove({ type: 'activiti-token' });
    overlayService.remove({ type: 'activiti-incident' });
    overlayService.remove({ type: 'activiti-badge' });
    const mark = (ids: readonly string[] | undefined, marker: string): void => {
      for (const id of ids ?? []) {
        if (!elementRegistry.get(id)) continue;
        canvas.addMarker(id, marker);
        this.marked.push({ id, marker });
      }
    };
    mark(overlays.completed, markerClass('completed'));
    mark(overlays.flows, FLOW_TAKEN_CLASS);
    // active and incident win over completed: they come later in the CSS and the element carries all its markers
    mark(overlays.active, markerClass('active'));
    mark(overlays.incidents, markerClass('incident'));
    if (this.selected && elementRegistry.get(this.selected)) {
      canvas.addMarker(this.selected, 'activiti-selected');
      this.marked.push({ id: this.selected, marker: 'activiti-selected' });
    }
    for (const id of overlays.active ?? []) {
      if (!elementRegistry.get(id)) continue;
      const count = overlays.tokens?.[id] ?? 1;
      overlayService.add(id, 'activiti-token', { position: { top: -10, left: -10 }, html: `<div class="activiti-token" data-testid="token-${id}" title="${count} token(s)">${count}</div>` });
    }
    for (const id of overlays.incidents ?? []) {
      if (!elementRegistry.get(id)) continue;
      overlayService.add(id, 'activiti-incident', { position: { top: -10, right: 10 }, html: `<div class="activiti-incident-badge" data-testid="incident-${id}" title="failed job / dead letter">!</div>` });
    }
    for (const [id, text] of Object.entries(overlays.badges ?? {})) {
      if (!elementRegistry.get(id)) continue;
      const safe = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      overlayService.add(id, 'activiti-badge', { position: { bottom: 8, left: 0 }, html: `<div class="activiti-badge">${safe}</div>` });
    }
  }

  /** The ids carrying a marker class, for tests and screenshots. */
  markedWith(marker: string): string[] {
    return this.marked.filter((m) => m.marker === marker).map((m) => m.id).sort();
  }

  /** Emphasizes one element (dashed border); `undefined` clears it. */
  select(id: string | undefined): void {
    if (!this.loaded) return;
    const { canvas, elementRegistry } = this.services();
    if (this.selected && elementRegistry.get(this.selected)) {
      canvas.removeMarker(this.selected, 'activiti-selected');
      this.marked = this.marked.filter((m) => !(m.id === this.selected && m.marker === 'activiti-selected'));
    }
    this.selected = id && elementRegistry.get(id) ? id : undefined;
    if (this.selected) {
      canvas.addMarker(this.selected, 'activiti-selected');
      this.marked.push({ id: this.selected, marker: 'activiti-selected' });
    }
  }

  destroy(): void {
    this.viewer.destroy();
    this.loaded = false;
  }
}
