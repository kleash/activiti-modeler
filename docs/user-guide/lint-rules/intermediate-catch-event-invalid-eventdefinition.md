# intermediate-catch-event-invalid-eventdefinition

**An intermediate catch event has an error, cancel or compensate definition**

| | |
|---|---|
| Rule | `activiti/intermediate-catch-event-invalid-eventdefinition` |
| Severity | error |
| Engine problem key | `INTERMEDIATE_CATCH_EVENT_INVALID_EVENTDEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti accepts timer, signal, message and link catch events.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Change the definition.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><errorEventDefinition/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent>
```

[All lint rules](index.md)
