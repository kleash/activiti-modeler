import { activitiModdleDescriptor } from '@activiti-modeler/activiti-moddle';

import { AccessorsModule } from './modules/accessors';
import { BehaviorsModule } from './modules/behaviors/behaviors';
import { AppendIndicatorModule } from './modules/canvas/AppendIndicator';
import { KeyboardPaletteModule } from './modules/canvas/KeyboardPalette';
import { ContextPadModule } from './modules/context-pad/ActivitiContextPadProvider';
import { ExtensionsModule } from './modules/extensions';
import { PaletteModule } from './modules/palette/ActivitiPaletteProvider';
import { PopupMenuModule } from './modules/popup-menu/ActivitiPopupMenuProviders';
import { RendererModule } from './modules/renderer/ActivitiRenderer';
import { RulesModule } from './modules/rules/ActivitiRules';
import { ProjectModule } from './modules/project/ProjectCatalog';
import { TemplatesModule } from './modules/templates/TemplateEntries';

export * from './modules/accessors';
export { ActivitiRenderer, taskKindOf, type TaskKind } from './modules/renderer/ActivitiRenderer';
export * from './modules/extensions';
export { PROJECT_CHANGED, ProjectCatalog, isMultiResult, type CatalogDecision, type CatalogDecisionOutput, type CatalogDmnFile, type CatalogProcess, type ProjectCatalogData } from './modules/project/ProjectCatalog';
export { ElementTemplates, ElementTemplatesLoader, isTemplatable, TEMPLATES_CHANGED, TEMPLATES_SELECT } from './modules/templates/ElementTemplates';
export {
  BUILTIN_PREFIX, buildTemplates, connectorTemplates, connectorVersion, templateIconKind, templateLinkOf, TEMPLATE_ICONS, TEMPLATE_ID_ATTRIBUTE, TEMPLATE_VERSION_ATTRIBUTE,
  type ActivitiElementTemplate, type TemplateKind, type TemplateLink,
} from './modules/templates/templates';
export { AppendIndicator, APPEND_INDICATOR_CLASS, APPEND_INDICATOR_TYPE, isDangling } from './modules/canvas/AppendIndicator';
export { KeyboardPalette } from './modules/canvas/KeyboardPalette';
export * from './support-matrix';
export type { CommandStack, DiagramElement, ElementRegistry, ModdleElement } from './types';

/**
 * bpmn-js `moddleExtensions` option that teaches the editor the `activiti:` namespace:
 * `new BpmnModeler({ moddleExtensions: activitiModdleExtensions })`.
 */
export const activitiModdleExtensions = {
  activiti: activitiModdleDescriptor,
} as const;

/**
 * bpmn-js additional module (didi module declaration) that makes the editor Activiti-native: palette, context pad and
 * replace menu restricted to what Activiti runs, creation and connection rules, behaviours, renderer, the extensions
 * store and the property accessors. No Camunda or Zeebe module is involved.
 */
export const ActivitiModule = {
  __depends__: [ExtensionsModule, ProjectModule, AccessorsModule, TemplatesModule, RulesModule, PaletteModule, ContextPadModule, PopupMenuModule, BehaviorsModule, RendererModule, AppendIndicatorModule, KeyboardPaletteModule] as unknown[],
  __init__: [] as string[],
} as const;

export { exportProcess, exportProject, importProcess, type ExportableModeler, type ExportedProcess, type ExportProjectOptions, type ImportableModeler } from './export';
export { DiagramBuilder, normalizeType, type ConnectSpec, type EventDefinitionKind, type ModdleValue, type ShapeSpec } from './builder';
