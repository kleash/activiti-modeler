import type { DiagramElement } from '../../types';

interface EventBusLike {
  on(events: string | string[], priority: number, handler: (event: unknown) => void): void;
}
interface OverlaysLike {
  add(element: DiagramElement | string, type: string, overlay: Record<string, unknown>): string;
  remove(filter: { id?: string; element?: DiagramElement | string; type?: string }): void;
}
interface ElementRegistryLike {
  filter(fn: (element: DiagramElement) => boolean): DiagramElement[];
  get(id: string): DiagramElement | undefined;
}
interface PopupMenuLike {
  isEmpty(element: DiagramElement, id: string): boolean;
  open(element: DiagramElement, id: string, position: Record<string, unknown>, options?: Record<string, unknown>): void;
}

export const APPEND_INDICATOR_TYPE = 'activiti-append-indicator';
export const APPEND_INDICATOR_CLASS = 'activiti-append-indicator';
const SIZE = 22;
const GAP = 8;

/**
 * Can something be appended to this element, and does it end a flow? Elements that already continue (an outgoing sequence flow),
 * or that no flow reaches (a task on its own), get no indicator; a start event or a boundary event without a flow does.
 */
export function isDangling(element: DiagramElement): boolean {
  const bo = element.businessObject;
  if (!bo || element.labelTarget || element.waypoints || element.type === 'label') return false;
  if (!bo.$instanceOf('bpmn:FlowNode')) return false;
  const flows = (list: DiagramElement[] | undefined): DiagramElement[] => (list ?? []).filter((c) => c.businessObject?.$instanceOf('bpmn:SequenceFlow'));
  if (flows(element.outgoing).length > 0) return false;
  return flows(element.incoming).length > 0 || bo.$instanceOf('bpmn:StartEvent') || bo.$instanceOf('bpmn:BoundaryEvent');
}

/**
 * The append indicator (feature U30): a small "+" button right of every element where a flow ends without continuing. A click, or Enter / Space
 * on the focused button, opens the append menu of the element (the same menu as the context pad and the `A` key). Elements the menu has
 * nothing for (end events, link throw events, compensation handlers) get none. It follows the diagram: moving the element moves
 * the indicator, adding the next element removes it.
 */
export class AppendIndicator {
  static $inject = ['eventBus', 'overlays', 'elementRegistry', 'popupMenu', 'translate'];

  private readonly overlays: OverlaysLike;
  private readonly registry: ElementRegistryLike;
  private readonly popupMenu: PopupMenuLike;
  private readonly translate: (text: string, replacements?: Record<string, string>) => string;
  private readonly shown = new Set<string>();
  private pending = false;

  constructor(eventBus: EventBusLike, overlays: OverlaysLike, registry: ElementRegistryLike, popupMenu: PopupMenuLike, translate: (text: string, replacements?: Record<string, string>) => string) {
    this.overlays = overlays;
    this.registry = registry;
    this.popupMenu = popupMenu;
    this.translate = translate;
    eventBus.on(['import.done', 'commandStack.changed', 'elements.changed'], 500, () => this.schedule());
    eventBus.on('diagram.clear', 500, () => this.shown.clear());
  }

  /** Re-reads the diagram once per tick: a command changes many elements at once. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.update();
    });
  }

  /** The ids of the elements that show an indicator now. */
  ids(): string[] {
    return [...this.shown];
  }

  update(): void {
    const wanted = new Map<string, DiagramElement>();
    for (const element of this.registry.filter((e) => isDangling(e))) {
      if (!this.popupMenu.isEmpty(element, 'bpmn-append')) wanted.set(element.id, element);
    }
    for (const id of [...this.shown]) {
      const element = this.registry.get(id);
      // an element that is gone took its overlays with it
      if (!wanted.has(id)) {
        if (element) this.overlays.remove({ element, type: APPEND_INDICATOR_TYPE });
        this.shown.delete(id);
      }
    }
    for (const [id, element] of wanted) {
      if (this.shown.has(id)) {
        // the label can change, the position follows the element by itself
        this.relabel(element);
        continue;
      }
      this.overlays.add(element, APPEND_INDICATOR_TYPE, {
        position: { top: Math.round(element.height / 2 - SIZE / 2), left: element.width + GAP },
        html: this.button(element),
        scale: { min: 0.8 },
      });
      this.shown.add(id);
    }
  }

  private labelOf(element: DiagramElement): string {
    const name = element.businessObject.get('name') as string | undefined;
    return this.translate('Append element after {name}', { name: name || element.id });
  }

  private relabel(element: DiagramElement): void {
    const button = document.querySelector(`.${APPEND_INDICATOR_CLASS}[data-element-id="${CSS.escape(element.id)}"]`);
    if (button) button.setAttribute('aria-label', this.labelOf(element));
  }

  private button(element: DiagramElement): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = APPEND_INDICATOR_CLASS;
    button.dataset['elementId'] = element.id;
    button.title = this.translate('Append element');
    button.setAttribute('aria-label', this.labelOf(element));
    button.setAttribute('aria-haspopup', 'menu');
    button.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
    // diagram-js listens for mouse events on the canvas: the button handles its own
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      this.popupMenu.open(element, 'bpmn-append', { x: rect.right + 5, y: rect.top, cursor: { x: event.clientX, y: event.clientY } }, {
        title: this.translate('Append element'),
        width: 'var(--bpmn-append-popup-width, 300px)',
        search: true,
      });
    });
    return button;
  }
}

export const AppendIndicatorModule = {
  __init__: ['appendIndicator'],
  appendIndicator: ['type', AppendIndicator],
};
