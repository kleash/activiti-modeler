# throw-event-invalid-eventdefinition

**An intermediate throw event has a definition other than signal, compensate, message or link**

| | |
|---|---|
| Rule | `activiti/throw-event-invalid-eventdefinition` |
| Severity | error |
| Engine problem key | `THROW_EVENT_INVALID_EVENTDEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti throws signals, compensation, messages and links from an intermediate event. (Escalation is not parsed and silently becomes a plain throw event: see the unsupported event definition rule.)

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Change the definition.

## Example

Reported:

```xml
<!-- process -->
<intermediateThrowEvent id="t"><errorEventDefinition/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateThrowEvent id="t"><compensateEventDefinition/></intermediateThrowEvent>
```

[All lint rules](index.md)
