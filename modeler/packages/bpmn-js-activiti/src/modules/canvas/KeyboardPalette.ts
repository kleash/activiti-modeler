import type { DiagramElement } from '../../types';

interface EventBusLike {
  on(events: string | string[], priority: number, handler: (event: never) => void): void;
}
interface CanvasLike {
  getContainer(): HTMLElement;
  getRootElement(): DiagramElement;
  focus(): void;
  viewbox(): { x: number; y: number; width: number; height: number };
}
interface PaletteLike {
  triggerEntry(entryId: string, action: string, event: Event, autoActivate?: boolean): unknown;
}
interface CreateLike {
  start(event: unknown, shape: unknown, context?: Record<string, unknown>): void;
}
interface ModelingLike {
  createElements(elements: unknown, position: { x: number; y: number }, target: DiagramElement, hints?: Record<string, unknown>): DiagramElement[];
}
interface RulesLike {
  allowed(action: string, context: Record<string, unknown>): unknown;
}
interface SelectionLike {
  select(elements: DiagramElement[] | DiagramElement | null): void;
}
interface InjectorLike {
  get<T>(name: string, strict?: boolean): T | null;
}

const ENTRY = '.entry[data-action]';

/**
 * The palette for the keyboard (feature U30): the palette is one stop of the Tab order (the entries move with the arrow keys),
 * Enter or Space on a tool entry activates the tool, on a create entry puts the new element in the middle of the visible canvas
 * (the pointer is not needed), and Escape goes back to the canvas. Screen readers get a toolbar with named buttons.
 */
export class KeyboardPalette {
  static $inject = ['eventBus', 'canvas', 'palette', 'create', 'modeling', 'selection', 'injector', 'translate'];

  private container: HTMLElement | undefined;
  private current = 0;
  private readonly canvas: CanvasLike;
  private readonly palette: PaletteLike;
  private readonly create: CreateLike;
  private readonly modeling: ModelingLike;
  private readonly selection: SelectionLike;
  private readonly injector: InjectorLike;
  private readonly translate: (text: string) => string;

  constructor(eventBus: EventBusLike, canvas: CanvasLike, palette: PaletteLike, create: CreateLike, modeling: ModelingLike, selection: SelectionLike, injector: InjectorLike, translate: (text: string) => string) {
    this.canvas = canvas;
    this.palette = palette;
    this.create = create;
    this.modeling = modeling;
    this.selection = selection;
    this.injector = injector;
    this.translate = translate;
    eventBus.on('palette.create', 500, ((event: { container: HTMLElement }) => this.attach(event.container)) as never);
    eventBus.on(['palette.changed', 'tool-manager.update'], 500, (() => this.refresh()) as never);
  }

  private entries(): HTMLElement[] {
    return this.container ? Array.from(this.container.querySelectorAll<HTMLElement>(ENTRY)) : [];
  }

  private attach(container: HTMLElement): void {
    this.container = container;
    container.setAttribute('role', 'toolbar');
    container.setAttribute('aria-orientation', 'vertical');
    container.setAttribute('aria-label', this.translate('Palette'));
    container.addEventListener('keydown', (event) => this.onKeyDown(event));
    // a click or focus by other means makes that entry the current one
    container.addEventListener('focusin', (event) => {
      const index = this.entries().indexOf((event.target as HTMLElement).closest<HTMLElement>(ENTRY) as HTMLElement);
      if (index >= 0 && index !== this.current) {
        this.current = index;
        this.refresh();
      }
    });
  }

  /** Roving tabindex and the pressed state of the tools; runs after every rebuild of the palette. */
  private refresh(): void {
    const entries = this.entries();
    if (entries.length === 0) return;
    this.current = Math.min(this.current, entries.length - 1);
    entries.forEach((entry, index) => {
      entry.tabIndex = index === this.current ? 0 : -1;
      if (!entry.hasAttribute('role')) entry.setAttribute('role', 'button');
      if (!entry.hasAttribute('aria-label')) entry.setAttribute('aria-label', entry.getAttribute('title') ?? entry.dataset['action'] ?? '');
      if (/-tool$/.test(entry.dataset['action'] ?? '')) entry.setAttribute('aria-pressed', String(entry.classList.contains('highlighted-entry')));
    });
  }

  private move(to: number): void {
    const entries = this.entries();
    if (entries.length === 0) return;
    this.current = (to + entries.length) % entries.length;
    this.refresh();
    entries[this.current]!.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        this.move(this.current + 1);
        return;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        this.move(this.current - 1);
        return;
      case 'Home':
        event.preventDefault();
        this.move(0);
        return;
      case 'End':
        event.preventDefault();
        this.move(this.entries().length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        this.canvas.focus();
        return;
      case 'Enter':
      case ' ': {
        const entry = (event.target as HTMLElement).closest<HTMLElement>(ENTRY);
        if (!entry) return;
        event.preventDefault();
        this.activate(entry);
        return;
      }
      default:
    }
  }

  /** A pointer event at the middle of the canvas: tools that expect a position get a plausible one. */
  private pointerAtCenter(): MouseEvent {
    const rect = this.canvas.getContainer().getBoundingClientRect();
    return new MouseEvent('click', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true });
  }

  /**
   * Triggers the entry. What a create entry would start dragging is put on the canvas instead, in the middle of the visible part, and
   * selected; the focus goes back to the canvas so the next key works on the new element.
   */
  private activate(entry: HTMLElement): void {
    const id = entry.dataset['action'] as string;
    const event = this.pointerAtCenter();
    const original = this.create.start;
    const created: Array<{ shape: unknown }> = [];
    this.create.start = (_event, shape) => void created.push({ shape });
    try {
      this.palette.triggerEntry(id, 'click', event);
    } finally {
      this.create.start = original;
    }
    if (created.length > 0) {
      this.place(created[0]!.shape);
      this.canvas.focus();
    }
  }

  private place(shape: unknown): void {
    const view = this.canvas.viewbox();
    const root = this.canvas.getRootElement();
    const rules = this.injector.get<RulesLike>('rules', false);
    const elements = ([] as unknown[]).concat(shape);
    const position = { x: Math.round(view.x + view.width / 2), y: Math.round(view.y + view.height / 2) };
    if (rules && rules.allowed('elements.create', { elements, position, target: root }) === false) return;
    const created = this.modeling.createElements(elements, position, root);
    this.selection.select(created.filter((e) => !e.labelTarget).slice(0, 1));
  }
}

export const KeyboardPaletteModule = {
  __init__: ['keyboardPalette'],
  keyboardPalette: ['type', KeyboardPalette],
};
