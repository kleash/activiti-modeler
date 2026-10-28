import { BpmnPropertiesPanelModule } from 'bpmn-js-properties-panel';

import { ActivitiPropertiesProvider } from './provider';
import { loadPanelLayout, savePanelLayout } from './layoutStore';

export { ActivitiPropertiesProvider, groupsFor } from './provider';
export { registerExpressionSource, type ExpressionSource, type ExpressionSuggestion, type SuggestionRequest } from './sources';
export { LINT_FOCUS_EVENT, focusPanelEntry, type LintFocusDetail } from './focus';
export { docsUrl, DOCS_BASE } from './help';
export { loadPanelLayout, savePanelLayout } from './layoutStore';

/**
 * bpmn-js additional module: the panel host of bpmn-js-properties-panel (BpmnPropertiesPanelModule, the renderer that mounts
 * the groups of the registered providers) and the Activiti provider. The generic BPMN provider and the Camunda and Zeebe
 * providers of that package are not used: they write the model directly and name `camunda:` types.
 */
export const ActivitiPropertiesModule = {
  __depends__: [BpmnPropertiesPanelModule],
  __init__: ['activitiPropertiesProvider'],
  activitiPropertiesProvider: ['type', ActivitiPropertiesProvider],
};

/**
 * bpmn-js options for the panel: the groups the user left open come back, and a change of the layout is stored. Pass the
 * result as `propertiesPanel`, and `debounceInput` for the typing delay.
 */
export function propertiesPanelConfig(): { layout: ReturnType<typeof loadPanelLayout> } {
  return { layout: loadPanelLayout() };
}

export { savePanelLayout as storePanelLayout };
