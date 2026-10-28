# subprocess-multiple-start-events

**An embedded sub process or transaction has more than one start event**

| | |
|---|---|
| Rule | `activiti/subprocess-multiple-start-events` |
| Severity | error |
| Engine problem key | `SUBPROCESS_MULTIPLE_START_EVENTS` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

An embedded sub process starts at its single none start event.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Keep one start event.

## Example

Reported:

```xml
<!-- process -->
<subProcess id="sp"><startEvent id="a"/><startEvent id="b"/></subProcess>
```

Accepted:

```xml
<!-- process -->
<subProcess id="sp"><startEvent id="a"/></subProcess>
```

[All lint rules](index.md)
