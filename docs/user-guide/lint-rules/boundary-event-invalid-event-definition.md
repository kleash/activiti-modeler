# boundary-event-invalid-event-definition

**A boundary event has a link definition**

| | |
|---|---|
| Rule | `activiti/boundary-event-invalid-event-definition` |
| Severity | error |
| Engine problem key | `BOUNDARY_EVENT_INVALID_EVENT_DEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti accepts timer, error, signal, cancel, message and compensate boundary events only. Of the definitions the converter reads in a boundary event, only a link definition is left that the validator refuses. A terminate definition is not read at all there, so that boundary event has none: see boundary-event-no-event-definition (engine-findings V.3).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings V.3](../../engine-findings.md).

## How to fix

Change the definition of the boundary event.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"><linkEventDefinition name="x"/></boundaryEvent>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"><errorEventDefinition/></boundaryEvent>
```

[All lint rules](index.md)
