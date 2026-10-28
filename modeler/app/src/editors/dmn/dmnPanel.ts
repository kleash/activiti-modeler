/**
 * The properties panel of the DRD (feature row DM properties): id, name and documentation of the definitions, decisions, input data,
 * business knowledge models, knowledge sources and text annotations, with `dmn-js-properties-panel`. The panel is the generic DMN one:
 * no Camunda or Zeebe provider is loaded. Activiti reads neither the question nor the allowed answers of a decision, so the filter below
 * leaves them out; the variable group offers the FEEL types (`common.dataTypes`).
 */
import { DmnPropertiesPanelModule, DmnPropertiesProviderModule } from 'dmn-js-properties-panel';

import 'dmn-js-properties-panel/dist/assets/properties-panel.css';

/** The entry ids of the documentation group that Activiti does not read. */
const HIDDEN_ENTRIES = new Set(['question', 'allowedAnswers']);

interface Group {
  id: string;
  entries?: Array<{ id: string }>;
}

/** Runs after the DMN provider (lower priority) and drops what Activiti ignores. */
export class ActivitiDmnPanelFilter {
  static $inject = ['propertiesPanel'];
  constructor(propertiesPanel: { registerProvider(priority: number, provider: object): void }) {
    propertiesPanel.registerProvider(500, this);
  }
  getGroups(): (groups: Group[]) => Group[] {
    return (groups) => groups.map((group) => (group.entries ? { ...group, entries: group.entries.filter((entry) => !HIDDEN_ENTRIES.has(entry.id)) } : group)).filter((group) => !group.entries || group.entries.length > 0);
  }
}

const filterModule = { __init__: ['activitiDmnPanelFilter'], activitiDmnPanelFilter: ['type', ActivitiDmnPanelFilter] };

/** The modules the DRD viewer gets. */
export const DRD_PANEL_MODULES: unknown[] = [DmnPropertiesPanelModule, DmnPropertiesProviderModule, filterModule];

export interface PanelHost {
  attachTo(container: HTMLElement): void;
  detach(): void;
}

let current: PanelHost | undefined;
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: the panel slot of the shell follows the DRD panel of the visible DMN tab. */
export function subscribeDmnPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getDmnPanel = (): PanelHost | undefined => current;

/** The editor of the visible DMN tab announces the panel of its DRD (or none, when another view is open). */
export function setDmnPanel(panel: PanelHost | undefined): void {
  if (current === panel) return;
  current = panel;
  for (const listener of [...listeners]) listener();
}
