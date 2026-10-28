# execution-listener-implementation-missing

**An execution listener has no class, expression or delegate expression**

| | |
|---|---|
| Rule | `activiti/execution-listener-implementation-missing` |
| Severity | error |
| Engine problem key | `EXECUTION_LISTENER_IMPLEMENTATION_MISSING` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The listener would be called but has nothing to call.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Java class**, **Expression** or **Delegate expression** on the listener.

## Example

Reported:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="start"/></extensionElements></task>
```

Accepted:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="start" class="a.B"/></extensionElements></task>
```

[All lint rules](index.md)
