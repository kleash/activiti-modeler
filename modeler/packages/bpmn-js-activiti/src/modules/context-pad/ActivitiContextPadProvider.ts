import { judge, placementOf, type ElementSpec } from '../../support-matrix';
import type { DiagramElement } from '../../types';

interface ContextPadLike {
  registerProvider(priority: number, provider: unknown): void;
}
type Entries = Record<string, unknown>;

const LOW_PRIORITY = 500;

/**
 * What each stock `append.*` entry creates, as a spec. Entries that would create something hidden by the support
 * matrix are removed; everything else, including entries added by other modules, is kept.
 */
const APPEND_SPECS: Record<string, ElementSpec> = {
  'append.end-event': { type: 'bpmn:EndEvent' },
  'append.gateway': { type: 'bpmn:ExclusiveGateway' },
  'append.append-task': { type: 'bpmn:Task' },
  'append.intermediate-event': { type: 'bpmn:IntermediateThrowEvent' },
  'append.text-annotation': { type: 'bpmn:TextAnnotation' },
  // behind an event-based gateway
  'append.receive-task': { type: 'bpmn:ReceiveTask' },
  'append.message-intermediate-event': { type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: 'bpmn:MessageEventDefinition' },
  'append.timer-intermediate-event': { type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: 'bpmn:TimerEventDefinition' },
  'append.condition-intermediate-event': { type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: 'bpmn:ConditionalEventDefinition' },
  'append.signal-intermediate-event': { type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: 'bpmn:SignalEventDefinition' },
};

/** Context pad: hides every append entry whose result is not creatable, and anything after an event-based gateway that is not an intermediate catch event. */
export class ActivitiContextPadProvider {
  static $inject = ['contextPad'];

  constructor(contextPad: ContextPadLike) {
    contextPad.registerProvider(LOW_PRIORITY, this);
  }

  getContextPadEntries(element: DiagramElement): (entries: Entries) => Entries {
    return (entries) => {
      const out: Entries = {};
      const placement = placementOf(element.parent?.businessObject ?? undefined);
      const fromEventGateway = element.businessObject?.$instanceOf('bpmn:EventBasedGateway') === true;
      for (const [id, entry] of Object.entries(entries)) {
        const spec = APPEND_SPECS[id];
        if (spec) {
          if (fromEventGateway && spec.type !== 'bpmn:IntermediateCatchEvent' && spec.type !== 'bpmn:TextAnnotation') continue;
          // events created behind a gateway live in the gateway's container
          if (spec.type !== 'bpmn:TextAnnotation' && !judge(spec, placement).allowed) continue;
        }
        out[id] = entry;
      }
      return out;
    };
  }
}

export const ContextPadModule = {
  __init__: ['activitiContextPadProvider'],
  activitiContextPadProvider: ['type', ActivitiContextPadProvider],
};
