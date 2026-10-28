import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';

import { judge, placementOf, specOfBusinessObject, isAllowedSequenceFlow } from '../../support-matrix';
import type { DiagramElement } from '../../types';

interface EventBusLike {
  on(event: string, priority: number, handler: (event: never) => unknown): void;
}

const HIGH_PRIORITY = 1500;

function isCreatableIn(shape: DiagramElement, parent: DiagramElement | null | undefined): boolean {
  const bo = shape.businessObject;
  if (!bo || shape.labelTarget) return true;
  if (bo.$instanceOf('bpmn:Group')) return false;
  // boundary events are judged by what they attach to (see shape.attach)
  if (bo.$instanceOf('bpmn:BoundaryEvent')) return true;
  const spec = specOfBusinessObject(bo, { isExpanded: undefined });
  // a bare participant / lane / annotation is judged by its own row
  return judge(spec, placementOf(parent?.businessObject ?? undefined)).allowed;
}

/**
 * Creation, attach and connection rules derived from the support matrix; they run before bpmn-js' own rules and can
 * only say no, so everything the base rules forbid stays forbidden.
 */
export class ActivitiRules extends RuleProvider {
  static override $inject = ['eventBus'];

  constructor(eventBus: EventBusLike) {
    super(eventBus as never);
  }

  override init(): void {
    this.addRule('shape.create', HIGH_PRIORITY, (context: { shape: DiagramElement; target: DiagramElement }) => (isCreatableIn(context.shape, context.target) ? undefined : false));

    this.addRule('elements.create', HIGH_PRIORITY, (context: { elements: DiagramElement[]; target: DiagramElement }) => {
      for (const element of context.elements ?? []) {
        if (element.waypoints || element.labelTarget) continue;
        // children of a pasted container are judged in their own container
        const parent = element.parent ?? context.target;
        if (!isCreatableIn(element, parent)) return false;
      }
      return undefined;
    });

    this.addRule('elements.move', HIGH_PRIORITY, (context: { shapes: DiagramElement[]; target?: DiagramElement }) => {
      const target = context.target;
      if (!target) return undefined;
      for (const shape of context.shapes ?? []) {
        if (shape.waypoints || shape.labelTarget || shape.host) continue;
        // moving into another container must keep every element creatable there (typed start in an embedded sub process, ...)
        if (shape.parent !== target && !isCreatableIn(shape, target)) return false;
      }
      return undefined;
    });

    this.addRule('shape.attach', HIGH_PRIORITY, (context: { shape: DiagramElement; target: DiagramElement }) => {
      const spec = specOfBusinessObject(context.shape.businessObject);
      if (!judge(spec, placementOf(context.shape.parent?.businessObject ?? undefined, context.target?.businessObject)).allowed) return false;
      // at most one compensation boundary per activity and one cancel boundary per transaction (COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY, BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION)
      for (const kind of ['bpmn:CompensateEventDefinition', 'bpmn:CancelEventDefinition']) {
        if (spec.eventDefinitionType !== kind) continue;
        const clash = (context.target?.attachers ?? []).some((a) => a !== context.shape && (a.businessObject.get('eventDefinitions') as Array<{ $type: string }> | undefined)?.[0]?.$type === kind);
        if (clash) return false;
      }
      return undefined;
    });

    const connection = (context: { source?: DiagramElement; target?: DiagramElement; connection?: DiagramElement }): boolean | undefined => {
      const source = context.source ?? context.connection?.source;
      const target = context.target ?? context.connection?.target;
      const type = context.connection?.businessObject?.$type;
      if (!source?.businessObject || !target?.businessObject) return undefined;
      if (type && type !== 'bpmn:SequenceFlow') return undefined;
      // connection.create has no business object yet: only sequence flows leave the gateway
      return isAllowedSequenceFlow(source.businessObject, target.businessObject) ? undefined : false;
    };
    this.addRule('connection.create', HIGH_PRIORITY, (context: { source: DiagramElement; target: DiagramElement; connection?: DiagramElement; hints?: Record<string, unknown> }) => {
      const flowType = (context.connection as { type?: string } | undefined)?.type;
      if (flowType && flowType !== 'bpmn:SequenceFlow') return undefined;
      return connection(context);
    });
    this.addRule('connection.reconnect', HIGH_PRIORITY, (context: { source: DiagramElement; target: DiagramElement; connection: DiagramElement }) => connection(context));
  }
}

export const RulesModule = {
  __init__: ['activitiRules'],
  activitiRules: ['type', ActivitiRules],
};
