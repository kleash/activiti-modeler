# service-task-missing-implementation

**A service task has no implementation**

| | |
|---|---|
| Rule | `activiti/service-task-missing-implementation` |
| Severity | error |
| Engine problem key | `SERVICE_TASK_MISSING_IMPLEMENTATION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A service task runs a Java class, an expression, a delegate expression, a built-in type (mail, shell) or a connector bean (`implementation`). Without one Activiti rejects the file. `camunda:class` and `camunda:delegateExpression` are not read, which is how an imported task ends up here.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.1-1](../../research/activiti-9-bpmn-support.md).

## How to fix

Choose an **Implementation** type in the properties panel.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:class="a.B"/><serviceTask id="e" activiti:expression="${x}"/><serviceTask id="c" implementation="crm.LOOKUP"/><serviceTask id="m" activiti:type="mail"/>
```

[All lint rules](index.md)
