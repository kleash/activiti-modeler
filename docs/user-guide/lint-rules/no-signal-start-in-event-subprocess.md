# no-signal-start-in-event-subprocess

**A signal start event in an event sub process**

| | |
|---|---|
| Rule | `activiti/no-signal-start-in-event-subprocess` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

The validator accepts it, but the engine has no behaviour for it: no subscription is created and the sub process never starts. (A timer start in an event sub process is rejected by the validator and reported by `event-subprocess-invalid-start-event-definition`.)

Evidence: [R1 §0.1-6](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L5](../../research/activiti-9-bpmn-support.md), [engine run t09](../../engine-findings.md).

## How to fix

Use a message start event, or catch the signal with a boundary event or an event-based gateway.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="sig" name="go"/>

<!-- process -->
<subProcess id="esp" triggeredByEvent="true"><startEvent id="s"><signalEventDefinition signalRef="sig"/></startEvent></subProcess>
```

Accepted:

```xml
<!-- process -->
<subProcess id="esp" triggeredByEvent="true"><startEvent id="s"><errorEventDefinition/></startEvent></subProcess>
```

[All lint rules](index.md)
