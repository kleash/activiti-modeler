import { DEFAULT_MAPPING, MULTI_INSTANCE_USER_TASK_MAPPING, defaultMappingType as typeOf, wantsDefaultMapping as wants, type MappingHostFacts } from '@activiti-modeler/activiti-project';

import type { ModdleElement } from '../../types';

// The rule (which element gets a default mapping, and of which type) lives in activiti-project, where the Camunda importer reads it too;
// this file only reads a moddle element into the facts that rule needs.
export { DEFAULT_MAPPING, MULTI_INSTANCE_USER_TASK_MAPPING };

/** Whether the loop characteristics value (a moddle element or nothing) is a multi-instance loop. */
export const isMultiInstanceLoop = (loop: ModdleElement | undefined): boolean => !!loop && loop.$instanceOf('bpmn:MultiInstanceLoopCharacteristics');

/** The event definitions the rule looks at: BPMN type name and the local name the rule knows it by. */
const EVENT_DEFINITIONS: ReadonlyArray<readonly [string, string]> = [['bpmn:MessageEventDefinition', 'messageEventDefinition'], ['bpmn:SignalEventDefinition', 'signalEventDefinition']];

const factsOf = (bo: ModdleElement): MappingHostFacts => {
  const definitions = (bo.get('eventDefinitions') as ModdleElement[] | undefined) ?? [];
  const parent = bo.$parent as ModdleElement | undefined;
  const type = bo.$type.replace(/^bpmn:/, '');
  return {
    // the kinds the rule names; a subtype (bpmn:AdHocSubProcess...) is matched by $instanceOf
    type: bo.$instanceOf('bpmn:UserTask') ? 'userTask' : bo.$instanceOf('bpmn:CallActivity') ? 'callActivity' : type.charAt(0).toLowerCase() + type.slice(1),
    eventDefinitions: EVENT_DEFINITIONS.filter(([bpmnType]) => definitions.some((d) => d.$instanceOf(bpmnType))).map(([, local]) => local),
    multiInstance: isMultiInstanceLoop(bo.get('loopCharacteristics') as ModdleElement | undefined),
    inEventSubProcess: !!parent && parent.$instanceOf('bpmn:SubProcess') && parent.get('triggeredByEvent') === true,
  };
};

/** Whether a new element gets a mapping by default (ADR 0006); the rule is `wantsDefaultMapping` of activiti-project. */
export const wantsDefaultMapping = (bo: ModdleElement): boolean => wants(factsOf(bo));

/** The mapping type of the default mapping of an element (`MAP_ALL`, `MAP_ALL_OUTPUTS` on a multi-instance user task); see activiti-project. */
export const defaultMappingType = (bo: ModdleElement): string => typeOf(factsOf(bo));
