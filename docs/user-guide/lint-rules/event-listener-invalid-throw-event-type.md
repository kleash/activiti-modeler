# event-listener-invalid-throw-event-type

**A process event listener throws something other than a signal, global signal, message or error**

| | |
|---|---|
| Rule | `activiti/event-listener-invalid-throw-event-type` |
| Severity | error |
| Engine problem key | `EVENT_LISTENER_INVALID_THROW_EVENT_TYPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

`throwEvent` accepts signal, globalSignal, message and error.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §4.8](../../research/activiti-9-bpmn-support.md).

## How to fix

Choose one of the four.

## Example

Reported:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_CREATED" throwEvent="escalation"/></extensionElements>
```

Accepted:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_CREATED" throwEvent="signal" signalName="s"/></extensionElements>
```

[All lint rules](index.md)
