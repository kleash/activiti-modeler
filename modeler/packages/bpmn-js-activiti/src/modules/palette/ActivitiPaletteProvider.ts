import { DMN_DECISION_IMPLEMENTATION, judge } from '../../support-matrix';
import type { BpmnFactory, DiagramElement } from '../../types';

interface PaletteEntry {
  group?: string;
  className?: string;
  imageUrl?: string;
  title?: string;
  action?: Record<string, (event: Event) => void>;
  [key: string]: unknown;
}
type PaletteEntries = Record<string, PaletteEntry>;

interface PaletteLike {
  registerProvider(priority: number, provider: unknown): void;
}
interface Create {
  start(event: Event, shape: unknown, context?: Record<string, unknown>): void;
}
interface ElementFactory {
  createShape(attrs: Record<string, unknown>): DiagramElement;
}

/** The decision-table glyph of the Decision task palette entry (also drawn on the shape by the renderer). */
export const DECISION_TASK_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="#222" stroke-width="1.6"/>' +
      '<path d="M3 9h18M3 14h18M9 4v16" fill="none" stroke="#222" stroke-width="1.4"/></svg>',
  );

const LOW_PRIORITY = 500;

/**
 * Palette: removes what Activiti does not run (the group artifact) and adds the Decision task, a service task that
 * calls the DMN connector. The standard entries create plain, always-allowed elements.
 */
export class ActivitiPaletteProvider {
  static $inject = ['palette', 'create', 'elementFactory', 'bpmnFactory', 'translate'];

  private readonly create: Create;
  private readonly elementFactory: ElementFactory;
  private readonly bpmnFactory: BpmnFactory;
  private readonly translate: (text: string) => string;

  constructor(palette: PaletteLike, create: Create, elementFactory: ElementFactory, bpmnFactory: BpmnFactory, translate: (text: string) => string) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.bpmnFactory = bpmnFactory;
    this.translate = translate;
    palette.registerProvider(LOW_PRIORITY, this);
  }

  getPaletteEntries(): (entries: PaletteEntries) => PaletteEntries {
    return (entries) => {
      const out: PaletteEntries = {};
      for (const [id, entry] of Object.entries(entries)) {
        if (id === 'create.group') continue;
        out[id] = entry;
      }
      const createDecisionTask = (event: Event): void => {
        const businessObject = this.bpmnFactory.create('bpmn:ServiceTask', { implementation: DMN_DECISION_IMPLEMENTATION, name: this.translate('Decision task') });
        this.create.start(event, this.elementFactory.createShape({ type: 'bpmn:ServiceTask', businessObject }));
      };
      // placed right after the generic task
      const ordered: PaletteEntries = {};
      for (const [id, entry] of Object.entries(out)) {
        ordered[id] = entry;
        if (id === 'create.task') {
          ordered['create.decision-task'] = {
            group: 'activity',
            imageUrl: DECISION_TASK_ICON,
            title: this.translate('Create decision task (DMN)'),
            action: { dragstart: createDecisionTask, click: createDecisionTask },
          };
        }
      }
      return ordered;
    };
  }
}

export const PaletteModule = {
  __init__: ['activitiPaletteProvider'],
  activitiPaletteProvider: ['type', ActivitiPaletteProvider],
};

export { judge };
