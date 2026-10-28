# listener-expression-calls-notify

**A listener expression that calls a method named notify**

| | |
|---|---|
| Rule | `activiti/listener-expression-calls-notify` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The expression resolver blocks the methods of `Object`, including `notify`, so `${bean.notify(execution)}` fails with "Error while evaluating expression".

Evidence: [engine-findings C13.3](../../engine-findings.md).

## How to fix

Give the method another name, or use a delegate expression.

## Example

Reported:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="start" expression="${rec.notify(execution)}"/></extensionElements></task>
```

Accepted:

```xml
<!-- process -->
<task id="t"><extensionElements><activiti:executionListener event="start" expression="${rec.recordExecution(execution)}"/></extensionElements></task>
```

[All lint rules](index.md)
