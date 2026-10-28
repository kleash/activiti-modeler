# invalid-timer-value

**A timer value that is not ISO 8601 or cron**

| | |
|---|---|
| Rule | `activiti/invalid-timer-value` |
| Severity | error |
| Kind | Extra rule L28 (FEATURE_MATRIX §D) |

## Why it matters

`timeDate` is an ISO 8601 date-time, `timeDuration` an ISO 8601 duration, `timeCycle` a repeating interval (`R3/PT10M`) or a Quartz cron expression (six or seven fields, exactly one of day-of-month and day-of-week is `?`). Anything else makes the timer job creation fail when the process is deployed (start timers) or when the token reaches the event.

Evidence: [R1 §8.3](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L28](../../research/activiti-9-bpmn-support.md).

## How to fix

Correct the value in the **Timer** group; its preview shows the next fire time.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="t"><timerEventDefinition><timeDuration>10 minutes</timeDuration></timerEventDefinition></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2031-01-01T00:00:00">R3/PT10M</timeCycle></timerEventDefinition></startEvent>
```

[All lint rules](index.md)
