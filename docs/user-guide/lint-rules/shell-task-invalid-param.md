# shell-task-invalid-param

**A shell task has a wait, redirectError or cleanEnv field that is not true or false**

| | |
|---|---|
| Rule | `activiti/shell-task-invalid-param` |
| Severity | error |
| Engine problem key | `SHELL_TASK_INVALID_PARAM` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

These three fields are booleans; a literal other than `true` / `false` is rejected (an expression is not checked).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Set the field to `true` or `false`.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field><activiti:field name="wait"><activiti:string>yes</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field><activiti:field name="wait"><activiti:string>false</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
