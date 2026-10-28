/**
 * Camunda 7 -> Activiti 9 translation (R1 §5). Pure data, shared by the L1 rule (which offers a fix only where an
 * equivalent exists) and the quick fix (which applies it).
 */

export const CAMUNDA_NAMESPACE_PREFIX = 'http://camunda.org/schema/';
export const ZEEBE_NAMESPACE_PREFIX = 'http://camunda.org/schema/zeebe/';

/** Attribute names that become `activiti:<same>` on the given element types (`*` = any). */
const SAME_NAME: Record<string, readonly string[]> = {
  'bpmn:UserTask': ['assignee', 'candidateUsers', 'candidateGroups', 'dueDate', 'priority', 'formKey'],
  'bpmn:ServiceTask': ['class', 'delegateExpression', 'expression'],
  'bpmn:Process': ['candidateStarterUsers', 'candidateStarterGroups'],
  'bpmn:StartEvent': ['initiator', 'formKey'],
  'bpmn:MultiInstanceLoopCharacteristics': ['collection', 'elementVariable'],
  'bpmn:FlowNode': ['exclusive'],
  'bpmn:CallActivity': ['businessKey'],
};

export type AttributeTranslation = { kind: 'rename'; to: string } | { kind: 'async' } | { kind: 'remove'; reason: string };

/**
 * What to do with `camunda:<local>` on an element of `type` (a moddle type name). `instanceOf` answers type questions so
 * that `bpmn:FlowNode` matches a user task.
 */
export function translateAttribute(local: string, instanceOf: (type: string) => boolean, isServiceTask: boolean, hasExpression = false): AttributeTranslation {
  for (const [type, names] of Object.entries(SAME_NAME)) {
    if (names.includes(local) && instanceOf(type)) return { kind: 'rename', to: `activiti:${local}` };
  }
  if (local === 'asyncBefore' && instanceOf('bpmn:FlowNode')) return { kind: 'async' };
  if (local === 'resultVariable') {
    // the engine rejects a result variable name on a class or delegate expression task (SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE)
    if (isServiceTask && hasExpression) return { kind: 'rename', to: 'activiti:resultVariableName' };
    if (isServiceTask) return { kind: 'remove', reason: 'a Java delegate has no result variable; activiti:resultVariableName needs an expression' };
    if (instanceOf('bpmn:ScriptTask')) return { kind: 'rename', to: 'activiti:resultVariable' };
  }
  const reasons: Record<string, string> = {
    asyncAfter: 'Activiti has only an async continuation before the activity (activiti:async)',
    jobPriority: 'Activiti has no job priority',
    historyTimeToLive: 'Activiti has no history time to live',
    versionTag: 'Activiti has no version tag',
    taskPriority: 'Activiti has no task priority default',
    followUpDate: 'Activiti has no follow-up date',
    formRef: 'Activiti has no form engine; use activiti:formKey',
    formRefBinding: 'Activiti has no form engine',
    formRefVersion: 'Activiti has no form engine',
    type: 'external tasks do not exist in Activiti; use a connector',
    topic: 'external tasks do not exist in Activiti; use a connector',
    decisionRef: 'use a Decision task',
    decisionRefBinding: 'use a Decision task',
    decisionRefVersion: 'use a Decision task',
    mapDecisionResult: 'use a Decision task',
    resultVariable: 'Activiti has no result variable here',
    calledElementBinding: 'Activiti always calls the latest version',
    calledElementVersion: 'Activiti always calls the latest version',
    calledElementVersionTag: 'Activiti always calls the latest version',
    calledElementTenantId: 'Activiti has no tenants',
    variableMappingClass: 'use activiti:in / activiti:out or the extensions mapping',
    variableMappingDelegateExpression: 'use activiti:in / activiti:out or the extensions mapping',
    isStartableInTasklist: 'Activiti has no tasklist flag',
    candidateStarterUsers: 'only on a process',
    candidateStarterGroups: 'only on a process',
  };
  return { kind: 'remove', reason: reasons[local] ?? 'Activiti has no equivalent' };
}

/** Element names (local) that translate to the same `activiti:` element. */
export const SAME_NAME_ELEMENTS: Record<string, string> = {
  executionListener: 'activiti:ExecutionListener',
  taskListener: 'activiti:TaskListener',
  field: 'activiti:Field',
  failedJobRetryTimeCycle: 'activiti:FailedJobRetryTimeCycle',
};

/** Why an element has no equivalent, by local name. */
export const ELEMENT_REMOVAL_REASONS: Record<string, string> = {
  properties: 'Camunda extension properties have no meaning in Activiti',
  property: 'Camunda extension properties have no meaning in Activiti',
  formData: 'Activiti has no form data; use activiti:formKey',
  formField: 'Activiti has no form data; use activiti:formKey',
  connector: 'Camunda connectors do not exist in Activiti; use a connector service task',
  inputOutput: 'Camunda input/output parameters become the extensions mapping',
  inputParameter: 'Camunda input/output parameters become the extensions mapping',
  outputParameter: 'Camunda input/output parameters become the extensions mapping',
  script: 'script listeners are not supported by Activiti',
  in: 'Camunda call activity parameters become activiti:in',
  out: 'Camunda call activity parameters become activiti:out',
  taskListener: 'Camunda timeout and script task listeners have no equivalent',
  executionListener: 'script execution listeners have no equivalent',
  errorEventDefinition: 'Camunda error event definition attributes are not read',
  escalationEventDefinition: 'not read by Activiti',
  potentialStarter: 'not read',
};
