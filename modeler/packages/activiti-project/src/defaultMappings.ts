/**
 * The one place that decides which element gets a default mapping and of which type (ADR 0006, "Default mappings"). The editor
 * (bpmn-js-activiti, from a moddle element) and the Camunda importer (from a DOM element) both read their element into
 * `MappingHostFacts` and ask here, so the rule exists once.
 */

/** The mapping type a user task, call activity or message catch event has by default. */
export const DEFAULT_MAPPING = 'MAP_ALL';
/** The mapping type a multi-instance user task has by default (see `defaultMappingType`). */
export const MULTI_INSTANCE_USER_TASK_MAPPING = 'MAP_ALL_OUTPUTS';

/** What the decision needs to know of an element. Names are BPMN local names without prefix: `userTask`, `messageEventDefinition`. */
export interface MappingHostFacts {
  /** Local name of the element type: `userTask`, `callActivity`, `intermediateCatchEvent`, `boundaryEvent`, `startEvent`, ... */
  readonly type: string;
  /** Local names of its event definitions: `messageEventDefinition`, `signalEventDefinition`, ... */
  readonly eventDefinitions: readonly string[];
  /** The element has multi-instance loop characteristics. */
  readonly multiInstance: boolean;
  /** The element is a start event whose parent is an event sub process (`triggeredByEvent`). */
  readonly inEventSubProcess: boolean;
}

/**
 * Whether a new element gets a mapping by default: user tasks, call activities, and message catch events (intermediate, boundary and
 * the start event of an event sub process). Without a mapping Activiti 9 drops the completion variables of a user task, the return
 * variables of a call activity and the payload of a message; the people who model expect those to flow.
 *
 * Signal catch events are NOT on the list: the payload of a signal reaches the process without any mapping (engine finding 37,
 * C20-order), and Activiti applies no mapping to a signal catch event (lint `signal-catch-has-mapping`).
 *
 * Connector service tasks are deliberately not on the list: their template creates explicit mappings.
 */
export function wantsDefaultMapping(host: MappingHostFacts): boolean {
  if (host.type === 'userTask' || host.type === 'callActivity') return true;
  if (!host.eventDefinitions.includes('messageEventDefinition')) return false;
  if (host.type === 'intermediateCatchEvent' || host.type === 'boundaryEvent') return true;
  return host.type === 'startEvent' && host.inEventSubProcess;
}

/**
 * The mapping type of the default mapping of an element: `MAP_ALL`, except on a multi-instance user task, which gets
 * `MAP_ALL_OUTPUTS`. `MAP_ALL` hands a task every variable of its execution, and on a PARALLEL multi-instance user task those include
 * the loop variables (`nrOfInstances`, `nrOfCompletedInstances`, `loopCounter`, the output collection); completing the task writes them
 * back as local variables of the instance and the instance never finishes (engine finding C20.1, corpus C20-claims). The completion
 * variables of a multi-instance task stay local to the instance and are collected by its `outputDataItem`, whatever the mapping, so
 * `MAP_ALL_OUTPUTS` (no inputs, outputs as they are) loses nothing and behaves like no mapping on the parallel and the sequential kind.
 */
export function defaultMappingType(host: MappingHostFacts): string {
  return host.type === 'userTask' && host.multiInstance ? MULTI_INSTANCE_USER_TASK_MAPPING : DEFAULT_MAPPING;
}
