import type { DiagramElement, ElementRegistry, ExtensionsStore, ProjectCatalog, PropertyAccessors } from '@activiti-modeler/bpmn-js-activiti';

import { EntryBuilder, type Definition } from './builders';
import { PanelEnv, type Debounce, type EventBusLike } from './env';
import { asyncGroups, conditionGroups, errorMappingGroups, jobGroups, multiInstanceGroups, skipGroups } from './groups/activity';
import { eventDefinitionGroups, timerGroups } from './groups/events';
import { dataObjectGroups, definitionGroups, generalGroups } from './groups/general';
import { eventListenerGroup, listenerGroup } from './groups/listeners';
import { decisionGroups } from './groups/decision';
import { constantsGroups, mappingGroups } from './groups/mapping';
import { templateGroups } from './groups/template';
import { variablesGroups } from './groups/variables';
import { calledElementGroups, fieldGroups, formGroups, implementationGroups, mailShellGroups, scriptGroups, userGroups } from './groups/tasks';

interface PropertiesPanelLike {
  registerProvider(priority: number, provider: unknown): void;
}

/** The groups of the panel for an element, in display order. Each group appears only where its accessors apply. */
export function groupsFor(env: PanelEnv, element: DiagramElement): Definition[] {
  const b = new EntryBuilder(env, element);
  const forms = formGroups(b);
  const all: Array<Definition | undefined> = [
    ...generalGroups(b),
    ...templateGroups(b),
    ...variablesGroups(b),
    ...definitionGroups(b),
    ...forms.filter((g) => g?.id === 'startInitiator'),
    ...userGroups(b),
    ...forms.filter((g) => g?.id === 'form'),
    ...implementationGroups(b),
    ...decisionGroups(b),
    ...fieldGroups(b),
    ...mailShellGroups(b),
    ...scriptGroups(b),
    ...calledElementGroups(b),
    ...conditionGroups(b),
    ...skipGroups(b),
    ...eventDefinitionGroups(b),
    ...timerGroups(b),
    ...mappingGroups(b),
    ...constantsGroups(b),
    ...multiInstanceGroups(b),
    ...asyncGroups(b),
    ...jobGroups(b),
    ...errorMappingGroups(b),
    listenerGroup(b, 'task'),
    listenerGroup(b, 'execution'),
    eventListenerGroup(b),
    ...dataObjectGroups(b),
  ];
  return all.filter((g): g is Definition => g !== undefined);
}

/**
 * The properties provider of the Activiti modeler. It builds every group of FEATURE_MATRIX §B that writes XML from the
 * `propertyAccessors` service: the panel reads and writes through the accessors only, so a value typed here goes through the
 * same code as `window.__modelerTestApi` and the corpus builds. (The generic provider of bpmn-js-properties-panel writes the
 * model directly, and no Camunda or Zeebe provider is loaded.)
 */
export class ActivitiPropertiesProvider {
  static $inject = ['propertiesPanel', 'eventBus', 'propertyAccessors', 'elementRegistry', 'extensionsStore', 'debounceInput', 'projectCatalog'];

  readonly env: PanelEnv;

  constructor(propertiesPanel: PropertiesPanelLike, eventBus: EventBusLike, accessors: PropertyAccessors, registry: ElementRegistry, store: ExtensionsStore, debounce: Debounce, catalog: ProjectCatalog) {
    this.env = new PanelEnv(accessors, registry, store, eventBus, debounce, catalog);
    // the message of a refused value belongs to the moment it was typed: another selection or any change of the model ends it
    eventBus.on('selection.changed', (() => {
      this.env.forget();
      this.env.forgetTyping();
      this.env.forgetChoices();
    }) as never);
    eventBus.on('commandStack.changed', (() => {
      this.env.forget();
      this.env.forgetChoices();
    }) as never);
    // a connector or DMN file of the project changed: the pickers and hints show the new state
    eventBus.on('activiti.project.changed', (() => this.env.refresh()) as never);
    // a change of the extensions file alone (a mapping, a variable) changes no diagram element, so the panel is not told: the notes and pickers depend on it
    eventBus.on('activiti.extensions.changed', (() => this.env.refresh()) as never);
    propertiesPanel.registerProvider(500, this);
  }

  getGroups(element: DiagramElement) {
    return (groups: Definition[]): Definition[] => {
      if (!element?.businessObject || element.labelTarget) return groups;
      return [...groups, ...groupsFor(this.env, element)];
    };
  }
}
