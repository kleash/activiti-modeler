# event-listener-implementation-missing

**A process event listener has no implementation**

| | |
|---|---|
| Rule | `activiti/event-listener-implementation-missing` |
| Severity | error |
| Engine problem key | `EVENT_LISTENER_IMPLEMENTATION_MISSING` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

An event listener needs `class`, `delegateExpression` or `throwEvent`. An `expression` attribute is not read (the parser only knows those three), so a listener with only an expression has no implementation for the engine. EVENT_LISTENER_INVALID_IMPLEMENTATION, the other key one might expect for it, cannot be reached from XML.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §4.8](../../research/activiti-9-bpmn-support.md), [engine-findings C13.6, V.4](../../engine-findings.md).

## How to fix

Choose what the listener does in the **Event listeners** group of the process.

## Example

Reported:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_CREATED"/></extensionElements>
```

Accepted:

```xml
<!-- process -->
<extensionElements><activiti:eventListener events="TASK_CREATED" class="a.B"/></extensionElements>
```

[All lint rules](index.md)
