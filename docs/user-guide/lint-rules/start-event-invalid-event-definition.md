# start-event-invalid-event-definition

**A process start event has an event definition other than message, timer or signal**

| | |
|---|---|
| Rule | `activiti/start-event-invalid-event-definition` |
| Severity | error |
| Engine problem key | `START_EVENT_INVALID_EVENT_DEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Only message, timer and signal starts can start a process. An error start event only exists inside an event sub process.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Replace the start event by a none, message, timer or signal start event.

## Example

Reported:

```xml
<!-- process -->
<startEvent id="s"><errorEventDefinition/></startEvent>
```

Accepted:

```xml
<!-- process -->
<startEvent id="s"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent>
```

[All lint rules](index.md)
