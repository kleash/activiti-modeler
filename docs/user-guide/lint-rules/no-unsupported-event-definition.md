# no-unsupported-event-definition

**An escalation or conditional event definition**

| | |
|---|---|
| Rule | `activiti/no-unsupported-event-definition` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

The Activiti converter does not read these definitions. An escalation throw event becomes a plain throw event, a conditional start becomes a none start, an escalation end event becomes a none end, and a boundary event with one fails validation. The model says one thing and the engine does another. (Several supported definitions on one event are not reported here: the engine uses the first, engine-findings N01.4, and bpmnlint's `single-event-definition` reports the multiplicity.)

Evidence: [R1 §0.1-8](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L6 L7](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

Replace the event by one Activiti executes: a signal, message, error or timer event, or a plain event.

## Example

Reported:

```xml
<!-- process -->
<intermediateThrowEvent id="e"><escalationEventDefinition/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateThrowEvent id="e"><compensateEventDefinition/></intermediateThrowEvent>
```

[All lint rules](index.md)
