# service-task-result-var-name-with-delegate

**A service task with a Java class or delegate expression has a result variable name**

| | |
|---|---|
| Rule | `activiti/service-task-result-var-name-with-delegate` |
| Severity | error |
| Engine problem key | `SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Only an expression can return a value to store; a delegate sets its own variables.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Remove the **Result variable name**, or implement the task as an expression.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:class="a.B" activiti:resultVariableName="r"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:expression="${x}" activiti:resultVariableName="r"/>
```

[All lint rules](index.md)
