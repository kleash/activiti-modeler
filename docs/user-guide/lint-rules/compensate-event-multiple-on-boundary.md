# compensate-event-multiple-on-boundary

**An activity has more than one compensation boundary event**

| | |
|---|---|
| Rule | `activiti/compensate-event-multiple-on-boundary` |
| Severity | error |
| Engine problem key | `COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

An activity has one compensation handler.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Delete the extra compensation boundary event.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><compensateEventDefinition/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><compensateEventDefinition/></boundaryEvent>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><compensateEventDefinition/></boundaryEvent>
```

[All lint rules](index.md)
