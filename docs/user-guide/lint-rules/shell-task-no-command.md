# shell-task-no-command

**A shell task has no command field**

| | |
|---|---|
| Rule | `activiti/shell-task-no-command` |
| Severity | error |
| Engine problem key | `SHELL_TASK_NO_COMMAND` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A shell task runs the command in the field `command`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Add the field `command`.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="arg1"><activiti:string>x</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
