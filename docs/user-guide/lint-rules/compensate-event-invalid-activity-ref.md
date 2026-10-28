# compensate-event-invalid-activity-ref

**A compensation event refers to an activity that does not exist**

| | |
|---|---|
| Rule | `activiti/compensate-event-invalid-activity-ref` |
| Severity | error |
| Engine problem key | `COMPENSATE_EVENT_INVALID_ACTIVITY_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

`activityRef` of a throwing compensation event must name an element of the process. (Engine detail: the reference is to the compensation **handler**, see engine-findings C08.2.)

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings C08.2](../../engine-findings.md).

## How to fix

Choose the activity again in **Compensation > Activity**.

## Example

Reported:

```xml
<!-- process -->
<intermediateThrowEvent id="c"><compensateEventDefinition id="cd" activityRef="ghost"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><intermediateThrowEvent id="c"><compensateEventDefinition activityRef="t"/></intermediateThrowEvent>
```

[All lint rules](index.md)
