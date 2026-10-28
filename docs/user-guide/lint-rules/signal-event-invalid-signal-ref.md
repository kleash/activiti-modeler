# signal-event-invalid-signal-ref

**A signal event refers to a signal that is not defined**

| | |
|---|---|
| Rule | `activiti/signal-event-invalid-signal-ref` |
| Severity | error |
| Engine problem key | `SIGNAL_EVENT_INVALID_SIGNAL_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The signal must be a `<signal>` of the file.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Pick the signal again, or define it.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="s"><signalEventDefinition signalRef="ghost"/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- definitions -->
<signal id="sig" name="go"/>

<!-- process -->
<intermediateCatchEvent id="s"><signalEventDefinition signalRef="sig"/></intermediateCatchEvent>
```

[All lint rules](index.md)
