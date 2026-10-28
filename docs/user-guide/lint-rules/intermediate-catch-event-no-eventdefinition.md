# intermediate-catch-event-no-eventdefinition

**An intermediate catch event has no event definition**

| | |
|---|---|
| Rule | `activiti/intermediate-catch-event-no-eventdefinition` |
| Severity | error |
| Engine problem key | `INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A catch event waits for something: a timer, a message, a signal or a link.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Choose what the event waits for (replace menu), or use an intermediate throw event for a plain milestone.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="c"/>
```

Accepted:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent>
```

[All lint rules](index.md)
