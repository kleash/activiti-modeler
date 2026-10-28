# signal-event-missing-signal-ref

**A signal event names no signal**

| | |
|---|---|
| Rule | `activiti/signal-event-missing-signal-ref` |
| Severity | error |
| Engine problem key | `SIGNAL_EVENT_MISSING_SIGNAL_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A signal event needs `signalRef` or an `activiti:signalExpression`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Pick or create the signal in the event's **Signal** group.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="s"><signalEventDefinition/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- definitions -->
<signal id="sig" name="go"/>

<!-- process -->
<intermediateCatchEvent id="s"><signalEventDefinition signalRef="sig"/></intermediateCatchEvent>
```

[All lint rules](index.md)
