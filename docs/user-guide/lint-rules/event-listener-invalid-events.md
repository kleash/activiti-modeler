# event-listener-invalid-events

**A process event listener with an unknown event type or entity type**

| | |
|---|---|
| Rule | `activiti/event-listener-invalid-events` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

`events` is a comma separated list of `ActivitiEventType` names and `entityType` one of attachment, comment, execution, identity-link, job, process-definition, process-instance, task; anything else is rejected when the process is deployed.

Evidence: [R1 §4.8](../../research/activiti-9-bpmn-support.md), ActivitiEventType (activiti-engine 9.0.0).

## How to fix

Choose the events from the list in the **Event listeners** group.

## Example

Reported:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_MADE_UP" class="a.B"/></extensionElements>
```

Accepted:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_CREATED,PROCESS_COMPLETED" entityType="task" class="a.B"/></extensionElements>
```

[All lint rules](index.md)
