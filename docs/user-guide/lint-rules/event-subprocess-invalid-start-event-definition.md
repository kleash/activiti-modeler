# event-subprocess-invalid-start-event-definition

**The start event of an event sub process is not an error, message or signal start**

| | |
|---|---|
| Rule | `activiti/event-subprocess-invalid-start-event-definition` |
| Severity | error |
| Engine problem key | `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The validator accepts error, message and signal; a timer start is rejected, and a signal start is accepted but never works (see the next rule).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.1-6](../../research/activiti-9-bpmn-support.md).

## How to fix

Use an error or message start event.

## Example

Reported:

```xml
<!-- process -->
<subProcess id="esp" triggeredByEvent="true"><startEvent id="a"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent></subProcess>
```

Accepted:

```xml
<!-- process -->
<subProcess id="esp" triggeredByEvent="true"><startEvent id="a"><errorEventDefinition/></startEvent></subProcess>
```

[All lint rules](index.md)
