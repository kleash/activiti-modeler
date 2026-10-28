# no-unsupported-end-event

**A link or compensation end event**

| | |
|---|---|
| Rule | `activiti/no-unsupported-end-event` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

Activiti turns these end events into none end events. A compensation end event does not compensate and a link end event does not jump. (An escalation end event is reported as an unsupported event definition.)

Evidence: [R1 §3.2](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

Use an intermediate throw compensation or link event followed by a none end event.

## Example

Reported:

```xml
<!-- process -->
<endEvent id="e"><compensateEventDefinition/></endEvent>
```

Accepted:

```xml
<!-- process -->
<endEvent id="e"/>
```

[All lint rules](index.md)
