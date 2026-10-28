import { judge, placementOf, specOfBusinessObject } from '../../support-matrix';
import type { DiagramElement } from '../../types';
import { isTemplatable, ElementTemplates, ElementTemplatesLoader } from './ElementTemplates';

type Entries = Record<string, unknown>;

interface PopupMenuLike {
  registerProvider(id: string, priority: number, provider: unknown): void;
  close(): void;
}
interface ContextPadLike {
  registerProvider(priority: number, provider: unknown): void;
}

const PRIORITY = 400;

/**
 * Entries that open the template chooser: "Apply template..." in the replace menu of a task, and "Append task from template" in the
 * context pad of a flow node. (The panel has its own button; all three fire `elementTemplates.select`.)
 */
export class TemplateEntries {
  static $inject = ['popupMenu', 'contextPad', 'elementTemplates', 'translate'];

  constructor(
    private readonly popupMenu: PopupMenuLike,
    contextPad: ContextPadLike,
    private readonly templates: ElementTemplates,
    private readonly translate: (text: string) => string,
  ) {
    popupMenu.registerProvider('bpmn-replace', PRIORITY, {
      getPopupMenuEntries: (element: DiagramElement) => (entries: Entries): Entries => {
        // a task that is a construct Activiti does not run (a web service task, a camel task) is not offered a template: it needs a lint fix, not a template
        if (!isTemplatable(element) || !judge(specOfBusinessObject(element.businessObject), placementOf(element.parent?.businessObject ?? undefined, element.host?.businessObject)).allowed) return entries;
        return {
          ...entries,
          'apply-template': {
            label: this.translate('Apply template...'),
            className: 'bpmn-icon-service',
            group: { id: 'templates', name: this.translate('Templates') },
            action: () => {
              this.popupMenu.close();
              this.templates.choose(element);
            },
          },
        };
      },
      getPopupMenuHeaderEntries: () => (entries: Entries): Entries => entries,
    });
    contextPad.registerProvider(PRIORITY, {
      getContextPadEntries: (element: DiagramElement) => (entries: Entries): Entries => {
        if (!('append.append-task' in entries)) return entries;
        const out: Entries = {};
        for (const [id, entry] of Object.entries(entries)) {
          out[id] = entry;
          if (id === 'append.append-task') {
            out['append.template'] = {
              group: 'model',
              className: 'bpmn-icon-service',
              title: this.translate('Append task from template'),
              action: { click: () => this.templates.choose(element) },
            };
          }
        }
        return out;
      },
    });
  }
}

export const TemplatesModule = {
  __depends__: [] as unknown[],
  __init__: ['elementTemplates', 'elementTemplatesLoader', 'templateEntries'],
  elementTemplates: ['type', ElementTemplates],
  elementTemplatesLoader: ['type', ElementTemplatesLoader],
  templateEntries: ['type', TemplateEntries],
};
