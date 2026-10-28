# event-timer-async-not-available

**A timer event needs the async executor, which is off**

| | |
|---|---|
| Rule | `activiti/event-timer-async-not-available` |
| Severity | warning |
| Engine problem key | `EVENT_TIMER_ASYNC_NOT_AVAILABLE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Reads | the engine (server validation) |

## Why it matters

The Spring Boot starter adds this warning when `spring.activiti.async-executor-activate=false`: async continuations, timers and asynchronous signals never run then. The rule only fires when the connected engine reports that its executor is off (the context says `asyncExecutorActive: false`); the server validation also reports it (labelled).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.4-24](../../research/activiti-9-bpmn-support.md), [engine-findings 5](../../engine-findings.md).

## How to fix

Switch the async executor on (`spring.activiti.async-executor-activate=true`, the default) or remove the async flag.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="t"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<task id="t"/>
```

[All lint rules](index.md)
