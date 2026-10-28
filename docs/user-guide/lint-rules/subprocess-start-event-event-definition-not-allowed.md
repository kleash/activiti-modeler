# subprocess-start-event-event-definition-not-allowed

**The start event of an embedded sub process has an event definition**

| | |
|---|---|
| Rule | `activiti/subprocess-start-event-event-definition-not-allowed` |
| Severity | error |
| Engine problem key | `SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Only a none start event may start an embedded sub process or transaction.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Use a none start event inside the sub process.

## Example

Reported:

```xml
<!-- process -->
<subProcess id="sp"><startEvent id="a"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></startEvent></subProcess>
```

Accepted:

```xml
<!-- process -->
<subProcess id="sp"><startEvent id="a"/></subProcess>
```

[All lint rules](index.md)
