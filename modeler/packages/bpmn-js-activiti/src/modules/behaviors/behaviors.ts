import { DMN_DECISION_IMPLEMENTATION, DMN_TABLE_CONSTANT } from '../../support-matrix';
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';

import type { CommandStack, DiagramElement, ElementRegistry, ModdleElement, Modeling } from '../../types';
import { shapeOfEventDefinition } from '../accessors/helpers';
import { processIdOf, type ExtensionsStore } from '../extensions';
import { emptyProcessExtension } from '@activiti-modeler/activiti-project';
import { templateIconKind, templateLinkOf, TEMPLATE_ID_ATTRIBUTE, TEMPLATE_VERSION_ATTRIBUTE, type TemplateKind } from '../templates/templates';

interface EventBusLike {
  on(event: string, priority: number | ((event: never) => void), handler?: (event: never) => void): void;
}
interface Event<C = Record<string, unknown>> {
  context: C;
}

const sameValue = (a: unknown, b: unknown): boolean => a === b;

// --- executable -------------------------------------------------------------------------------------------------------------

/**
 * Activiti skips processes that are not `isExecutable="true"` (R1 §2.1, ADR 0003), and bpmn-js writes false by
 * default. The flag is forced on import, on creation of a pool and on every update.
 */
export class ExecutableBehavior extends CommandInterceptor {
  static override $inject = ['eventBus'];

  constructor(eventBus: EventBusLike) {
    super(eventBus as never);

    eventBus.on('import.parse.complete', 1500, ((event: { definitions?: ModdleElement }) => {
      for (const root of (event.definitions?.get('rootElements') as ModdleElement[] | undefined) ?? []) {
        if (root.$instanceOf('bpmn:Process') && root.get('isExecutable') !== true) root.set('isExecutable', true);
      }
    }) as never);

    this.preExecute('shape.create', (e: Event<{ shape?: DiagramElement }>) => {
      const process = e.context.shape?.businessObject?.get('processRef') as ModdleElement | undefined;
      if (process && process.get('isExecutable') !== true) process.set('isExecutable', true);
    });

    this.preExecute(['element.updateProperties', 'element.updateModdleProperties'], (e: Event<{ element?: DiagramElement; moddleElement?: ModdleElement; properties?: Record<string, unknown> }>) => {
      const bo = e.context.moddleElement ?? e.context.element?.businessObject;
      if (bo?.$instanceOf('bpmn:Process') && e.context.properties && 'isExecutable' in e.context.properties) e.context.properties['isExecutable'] = true;
    });
  }
}

// --- field injection placement -----------------------------------------------------------------------------------------------

/**
 * Activiti 9.0.0 reads `activiti:field` on a service task, send task and message event definition inside
 * `extensionElements` and as a direct child of the element (BpmnXMLUtil.parseChildElements runs the field parser in either
 * place). The editor works with the extensionElements form, so a file that uses the direct form is normalised to it on
 * import, before the first command: the field accessors see the fields and the next export writes the XSD-conformant form.
 */
export class FieldPlacementBehavior {
  static $inject = ['eventBus'];

  constructor(eventBus: EventBusLike) {
    eventBus.on('import.parse.complete', 1500, ((event: { definitions?: ModdleElement }) => {
      const visit = (element: ModdleElement): void => {
        const direct = element.$descriptor?.propertiesByName?.['activiti:fields'] ? ((element.get('activiti:fields') as ModdleElement[] | undefined) ?? []) : [];
        if (direct.length > 0) {
          const container = (element.get('extensionElements') as ModdleElement | undefined) ?? (element.$model as { create(type: string, attrs: Record<string, unknown>): ModdleElement }).create('bpmn:ExtensionElements', { values: [] });
          container.set('values', [...((container.get('values') as ModdleElement[] | undefined) ?? []), ...direct]);
          element.set('extensionElements', container);
          element.set('activiti:fields', []);
        }
        for (const name of ['flowElements', 'eventDefinitions']) {
          for (const child of (element.$descriptor?.propertiesByName?.[name] ? ((element.get(name) as ModdleElement[] | undefined) ?? []) : [])) visit(child);
        }
      };
      for (const root of (event.definitions?.get('rootElements') as ModdleElement[] | undefined) ?? []) if (root.$instanceOf('bpmn:Process')) visit(root);
    }) as never);
  }
}

// --- implementation type ----------------------------------------------------------------------------------------------------

const IMPL_ATTRS = ['activiti:class', 'activiti:expression', 'activiti:delegateExpression', 'implementation', 'activiti:type'] as const;
type ImplAttr = (typeof IMPL_ATTRS)[number];
/** Attributes each implementation attribute excludes (a task has exactly one implementation). */
const EXCLUDES: Record<ImplAttr, readonly string[]> = {
  'activiti:class': ['activiti:expression', 'activiti:delegateExpression', 'implementation', 'activiti:type', 'activiti:resultVariableName'],
  'activiti:expression': ['activiti:class', 'activiti:delegateExpression', 'implementation', 'activiti:type'],
  'activiti:delegateExpression': ['activiti:class', 'activiti:expression', 'implementation', 'activiti:type', 'activiti:resultVariableName'],
  implementation: ['activiti:class', 'activiti:expression', 'activiti:delegateExpression', 'activiti:type', 'activiti:resultVariableName'],
  'activiti:type': ['activiti:class', 'activiti:expression', 'activiti:delegateExpression', 'implementation', 'activiti:resultVariableName'],
};

function familyOf(get: (name: string) => unknown): string {
  const type = get('activiti:type');
  if (type === 'mail' || type === 'shell') return type as string;
  if (get('activiti:class') !== undefined) return 'class';
  if (get('activiti:expression') !== undefined) return 'expression';
  if (get('activiti:delegateExpression') !== undefined) return 'delegateExpression';
  if (get('implementation') !== undefined) return 'connector';
  return 'none';
}
/** The template kind an implementation stands for: what a task linked to a template of that kind must still be to stay linked. */
function kindOf(get: (name: string) => unknown): TemplateKind | 'none' {
  const type = get('activiti:type');
  if (type === 'mail' || type === 'shell') return type;
  if (get('activiti:class') !== undefined) return 'class';
  if (get('activiti:expression') !== undefined) return 'expression';
  if (get('activiti:delegateExpression') !== undefined) return 'delegateExpression';
  const implementation = get('implementation');
  if (implementation === DMN_DECISION_IMPLEMENTATION) return 'decision';
  return implementation !== undefined ? 'connector' : 'none';
}

/** Families whose field injection means something; the others lose their fields on a switch. */
const FIELD_FAMILIES = new Set(['class', 'delegateExpression', 'mail', 'shell']);

/**
 * Keeps a service task consistent when its implementation changes: setting one implementation attribute clears the
 * others (switching Java class to connector removes activiti:class), and fields that the new implementation cannot
 * use are removed. It works inside the update command, so one undo reverts everything.
 */
export class ImplementationBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling'];

  constructor(eventBus: EventBusLike, modeling: Modeling) {
    super(eventBus as never);

    this.preExecute('element.updateProperties', (e: Event<{ element: DiagramElement; properties: Record<string, unknown> }>) => {
      const { element, properties } = e.context;
      const bo = element.businessObject;
      if (!bo.$instanceOf('bpmn:ServiceTask') && !bo.$instanceOf('bpmn:SendTask')) return;
      const set = IMPL_ATTRS.filter((a) => a in properties && properties[a] !== undefined);
      if (set.length === 0) return;
      // when several are set at once (the accessor does that), the call is already consistent
      const before = familyOf((n) => bo.get(n));
      for (const attr of set) {
        for (const excluded of EXCLUDES[attr]) {
          if (set.includes(excluded as ImplAttr)) continue;
          if (bo.get(excluded) !== undefined && !(excluded in properties && properties[excluded] === undefined)) properties[excluded] = undefined;
        }
      }
      const after = familyOf((n) => (n in properties ? properties[n] : bo.get(n)));
      if (before !== after && !FIELD_FAMILIES.has(after)) removeFields(modeling, element);
      // a task stops being an instance of its element template when its implementation is no longer what the template makes
      const link = templateLinkOf(bo);
      if (link && !(TEMPLATE_ID_ATTRIBUTE in properties)) {
        const next = (n: string): unknown => (n in properties ? properties[n] : bo.get(n));
        const expected = templateIconKind(link.id);
        if (kindOf(next) !== expected || (expected === 'connector' && next('implementation') !== link.id)) {
          properties[TEMPLATE_ID_ATTRIBUTE] = undefined;
          properties[TEMPLATE_VERSION_ATTRIBUTE] = undefined;
        }
      }
    });
  }
}

function removeFields(modeling: Modeling, element: DiagramElement): void {
  const bo = element.businessObject;
  const container = bo.get('extensionElements') as ModdleElement | undefined;
  const values = (container?.get('values') as ModdleElement[] | undefined) ?? [];
  if (!container || !values.some((v) => v.$type === 'activiti:Field')) return;
  const rest = values.filter((v) => v.$type !== 'activiti:Field');
  if (rest.length === 0) modeling.updateModdleProperties(element, bo, { extensionElements: undefined });
  else modeling.updateModdleProperties(element, container, { values: rest });
}

// --- send task ---------------------------------------------------------------------------------------------------------------

/**
 * Only mail works on a send task (R1 §3.3): a new or converted send task gets exactly `activiti:type="mail"`; what the
 * element carried as a service task (shell type, connector, web service) does not apply to it and is dropped.
 */
export class SendTaskBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling'];

  constructor(eventBus: EventBusLike, modeling: Modeling) {
    super(eventBus as never);
    const fix = (shape: DiagramElement | undefined): void => {
      const bo = shape?.businessObject;
      if (!shape || !bo?.$instanceOf('bpmn:SendTask')) return;
      if (bo.get('activiti:type') === 'mail' && bo.get('implementation') === undefined && bo.get('operationRef') === undefined) return;
      modeling.updateProperties(shape, { 'activiti:type': 'mail', implementation: undefined, operationRef: undefined });
    };
    this.postExecuted('shape.create', (e: Event<{ shape?: DiagramElement }>) => fix(e.context.shape));
    this.postExecuted('shape.replace', 900, (e: Event<{ newShape?: DiagramElement }>) => fix(e.context.newShape));
    this.postExecuted('elements.create', (e: Event<{ elements?: DiagramElement[] }>) => (e.context.elements ?? []).forEach(fix));
  }
}

// --- decision task -----------------------------------------------------------------------------------------------------------

/**
 * A Decision task is a service task that calls `dmn-connector.EXECUTE_TABLE`; the decision is passed as the constant
 * `_activiti_dmn_table_` of that task. The constant is created with the task and removed when the task stops being one.
 */
export class DecisionTaskBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'commandStack', 'extensionsStore'];

  constructor(eventBus: EventBusLike, commandStack: CommandStack, store: ExtensionsStore) {
    super(eventBus as never);

    const ensureConstant = (shape: DiagramElement | undefined): void => {
      const bo = shape?.businessObject;
      if (!shape || !bo?.$instanceOf('bpmn:ServiceTask') || bo.get('implementation') !== DMN_DECISION_IMPLEMENTATION) return;
      const processId = processIdOf(bo);
      if (!processId || store.getProcess(processId)?.constants[shape.id]?.[DMN_TABLE_CONSTANT]) return;
      store.update('declare the decision constant', (file) => {
        const ext = (file.extensions[processId] ??= emptyProcessExtension());
        ext.constants[shape.id] = { ...(ext.constants[shape.id] ?? {}), [DMN_TABLE_CONSTANT]: { value: '' } };
      });
    };
    this.postExecuted('shape.create', (e: Event<{ shape?: DiagramElement }>) => ensureConstant(e.context.shape));
    this.postExecuted('elements.create', 900, (e: Event<{ elements?: DiagramElement[] }>) => (e.context.elements ?? []).forEach(ensureConstant));

    this.postExecuted('element.updateProperties', (e: Event<{ element: DiagramElement; properties: Record<string, unknown>; oldProperties: Record<string, unknown> }>) => {
      const { element, properties, oldProperties } = e.context;
      if (!('implementation' in properties) || sameValue(properties['implementation'], oldProperties['implementation'])) return;
      const bo = element.businessObject;
      if (!bo.$instanceOf('bpmn:ServiceTask')) return;
      if (properties['implementation'] === DMN_DECISION_IMPLEMENTATION) {
        ensureConstant(element);
      } else if (oldProperties['implementation'] === DMN_DECISION_IMPLEMENTATION) {
        const processId = processIdOf(bo);
        if (processId && store.getProcess(processId)?.constants[element.id]?.[DMN_TABLE_CONSTANT]) {
          store.update('drop the decision constant', (file) => {
            const constants = file.extensions[processId]?.constants;
            if (!constants?.[element.id]) return;
            delete constants[element.id]![DMN_TABLE_CONSTANT];
            if (Object.keys(constants[element.id]!).length === 0) delete constants[element.id];
          });
        }
      }
    });
    void commandStack;
  }
}

// --- boundary events ---------------------------------------------------------------------------------------------------------

/** Error and cancel boundary events are always interrupting; keep `cancelActivity` consistent with the definition. */
export class BoundaryEventBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling'];

  constructor(eventBus: EventBusLike, modeling: Modeling) {
    super(eventBus as never);
    const alwaysInterrupting = (bo: ModdleElement): boolean => {
      const type = (bo.get('eventDefinitions') as Array<{ $type: string }> | undefined)?.[0]?.$type;
      return type === 'bpmn:ErrorEventDefinition' || type === 'bpmn:CancelEventDefinition';
    };
    this.preExecute('element.updateProperties', (e: Event<{ element: DiagramElement; properties: Record<string, unknown> }>) => {
      const bo = e.context.element.businessObject;
      if (bo.$instanceOf('bpmn:BoundaryEvent') && alwaysInterrupting(bo) && e.context.properties['cancelActivity'] === false) e.context.properties['cancelActivity'] = true;
    });
    this.postExecuted('shape.replace', 900, (e: Event<{ newShape?: DiagramElement }>) => {
      const shape = e.context.newShape;
      const bo = shape?.businessObject;
      if (shape && bo?.$instanceOf('bpmn:BoundaryEvent') && alwaysInterrupting(bo) && bo.get('cancelActivity') === false) modeling.updateProperties(shape, { cancelActivity: true });
    });
  }
}

// --- link events -------------------------------------------------------------------------------------------------------------

const LINK_DEFINITION = 'bpmn:LinkEventDefinition';
const linkDefinitionOf = (bo: ModdleElement | undefined): ModdleElement | undefined =>
  ((bo?.get('eventDefinitions') as ModdleElement[] | undefined) ?? []).find((d) => d.$instanceOf(LINK_DEFINITION));

/**
 * A link throw event points at its catch event (`target`), the catch event lists its throw events (`source`). Deleting
 * either end removes it from the other, in the same undo step, so the exported XML never refers to a link event that is gone.
 */
export class LinkEventBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling', 'elementRegistry'];

  constructor(eventBus: EventBusLike, modeling: Modeling, registry: ElementRegistry) {
    super(eventBus as never);
    this.postExecuted('shape.delete', (e: Event<{ shape?: DiagramElement }>) => {
      const bo = e.context.shape?.businessObject;
      const definition = linkDefinitionOf(bo);
      if (!definition) return;
      const shapeOf = (definitionElement: ModdleElement): DiagramElement | undefined => shapeOfEventDefinition(registry, definitionElement);
      // a deleted throw event leaves the source list of its catch event
      const target = definition.get('target') as ModdleElement | undefined;
      const targetShape = target ? shapeOf(target) : undefined;
      if (target && targetShape) {
        const sources = ((target.get('source') as ModdleElement[] | undefined) ?? []).filter((s) => s !== definition);
        modeling.updateModdleProperties(targetShape, target, { source: sources });
      }
      // a deleted catch event is no longer the target of its throw events
      for (const source of ((definition.get('source') as ModdleElement[] | undefined) ?? []).slice()) {
        const sourceShape = shapeOf(source);
        if (sourceShape && source.get('target') === definition) modeling.updateModdleProperties(sourceShape, source, { target: undefined });
      }
    });
  }
}

// --- definitions-level references --------------------------------------------------------------------------------------------

const REFERENCES = [
  ['messageRef', 'bpmn:Message'],
  ['signalRef', 'bpmn:Signal'],
  ['errorRef', 'bpmn:Error'],
] as const;

/**
 * Picking a message, signal or error for an event definition registers it at definitions level when it is new, in
 * the same step (ADR: reference entries are created when a reference is picked).
 */
export class DefinitionsReferenceBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling'];

  constructor(eventBus: EventBusLike, modeling: Modeling) {
    super(eventBus as never);
    this.preExecute(['element.updateProperties', 'element.updateModdleProperties'], (e: Event<{ element: DiagramElement; moddleElement?: ModdleElement; properties: Record<string, unknown> }>) => {
      const { element, properties } = e.context;
      for (const [property, type] of REFERENCES) {
        const ref = properties[property] as ModdleElement | undefined;
        if (!ref || typeof ref !== 'object' || !ref.$instanceOf?.(type)) continue;
        let definitions: ModdleElement | undefined = (e.context.moddleElement ?? element.businessObject) as ModdleElement;
        while (definitions && definitions.$type !== 'bpmn:Definitions') definitions = definitions.$parent;
        if (!definitions) continue;
        const roots = (definitions.get('rootElements') as ModdleElement[] | undefined) ?? [];
        if (roots.includes(ref)) continue;
        modeling.updateModdleProperties(element, definitions, { rootElements: [...roots, ref] });
      }
    });
  }
}

export const BehaviorsModule = {
  __init__: ['executableBehavior', 'fieldPlacementBehavior', 'implementationBehavior', 'sendTaskBehavior', 'decisionTaskBehavior', 'boundaryEventBehavior', 'linkEventBehavior', 'definitionsReferenceBehavior'],
  executableBehavior: ['type', ExecutableBehavior],
  fieldPlacementBehavior: ['type', FieldPlacementBehavior],
  implementationBehavior: ['type', ImplementationBehavior],
  sendTaskBehavior: ['type', SendTaskBehavior],
  decisionTaskBehavior: ['type', DecisionTaskBehavior],
  boundaryEventBehavior: ['type', BoundaryEventBehavior],
  linkEventBehavior: ['type', LinkEventBehavior],
  definitionsReferenceBehavior: ['type', DefinitionsReferenceBehavior],
};
