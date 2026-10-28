# event-timer-missing-configuration

**A timer event has no date, duration or cycle**

| | |
|---|---|
| Rule | `activiti/event-timer-missing-configuration` |
| Severity | error |
| Engine problem key | `EVENT_TIMER_MISSING_CONFIGURATION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A timer needs one of `timeDate`, `timeDuration` or `timeCycle`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Fill the **Timer** group.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="t"><timerEventDefinition/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateCatchEvent id="t"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent>
```

[All lint rules](index.md)
