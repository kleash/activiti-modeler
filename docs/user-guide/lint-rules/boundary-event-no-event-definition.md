# boundary-event-no-event-definition

**A boundary event has no event definition Activiti understands**

| | |
|---|---|
| Rule | `activiti/boundary-event-no-event-definition` |
| Severity | error |
| Engine problem key | `BOUNDARY_EVENT_NO_EVENT_DEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A boundary event without a definition is rejected. Escalation and conditional boundary events are not parsed at all, so for Activiti they have none (R1 §0.1-8); neither is a terminate definition, which the converter reads in an end event only (engine-findings V.3).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.1-8](../../research/activiti-9-bpmn-support.md), [engine-findings V.3](../../engine-findings.md).

## How to fix

Give the boundary event a timer, error, message, signal, cancel or compensation definition.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></boundaryEvent>
```

[All lint rules](index.md)
