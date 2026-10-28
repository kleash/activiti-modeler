# no-signal-end-event

**A signal end event**

| | |
|---|---|
| Rule | `activiti/no-signal-end-event` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |
| Quick fix | Throw the signal, then end with a none end event |

## Why it matters

Activiti treats a signal end event as a none end event: the signal is never thrown (engine run t68).

Evidence: [R1 §0.1-7](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L6](../../research/activiti-9-bpmn-support.md), [engine run t68](../../engine-findings.md).

## How to fix

Throw the signal with an intermediate throw signal event, then end with a none end event. The quick fix does that.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="sig" name="go"/>

<!-- process -->
<endEvent id="e"><signalEventDefinition signalRef="sig"/></endEvent>
```

Accepted:

```xml
<!-- definitions -->
<signal id="sig" name="go"/>

<!-- process -->
<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sig"/></intermediateThrowEvent><endEvent id="e"/>
```

[All lint rules](index.md)
