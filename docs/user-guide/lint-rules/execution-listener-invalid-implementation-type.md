# execution-listener-invalid-implementation-type

**A transaction dependent execution listener uses an expression**

| | |
|---|---|
| Rule | `activiti/execution-listener-invalid-implementation-type` |
| Severity | error |
| Engine problem key | `EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

`onTransaction` (before-commit, committed, rolled-back) needs a delegate expression whose bean implements the transaction dependent listener interface; an expression is rejected, a class only works if it implements that interface (engine-findings C13.4).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings C13.4](../../engine-findings.md).

## How to fix

Use a delegate expression, or remove `onTransaction`.

## Example

Reported:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="end" expression="${x.y()}" onTransaction="committed"/></extensionElements></task>
```

Accepted:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="end" delegateExpression="${bean}" onTransaction="committed"/></extensionElements></task>
```

[All lint rules](index.md)
