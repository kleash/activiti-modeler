# timer-end-date-before-start

**A start timer whose end date is before its first due date**

| | |
|---|---|
| Rule | `activiti/timer-end-date-before-start` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The end date of a start timer is evaluated when the timer fires. When it lies before the due date, the engine deletes the job without starting an instance and without an error (debug log only).

Evidence: [engine-findings 26](../../engine-findings.md), [engine-findings 27](../../engine-findings.md).

## How to fix

Move the end date after the first due date, or remove it.

## Example

Reported:

```xml
<!-- process -->
<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2030-01-01T00:00:00">R3/2031-01-01T00:00:00/PT1H</timeCycle></timerEventDefinition></startEvent>
```

Accepted:

```xml
<!-- process -->
<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2032-01-01T00:00:00">R3/2031-01-01T00:00:00/PT1H</timeCycle></timerEventDefinition></startEvent>
```

[All lint rules](index.md)
