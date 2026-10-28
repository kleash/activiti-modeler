# send-task-invalid-implementation

**A send task is not a mail task**

| | |
|---|---|
| Rule | `activiti/send-task-invalid-implementation` |
| Severity | error |
| Engine problem key | `SEND_TASK_INVALID_IMPLEMENTATION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Only the mail send task works in Activiti 9 (`activiti:type="mail"` with its fields); a send task without a type is rejected (L13).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §3.3](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L13](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Implementation** to Mail, or use a service task.

## Example

Reported:

```xml
<!-- process -->
<sendTask id="s"/>
```

Accepted:

```xml
<!-- process -->
<sendTask id="s" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field><activiti:field name="text"><activiti:string>x</activiti:string></activiti:field></extensionElements></sendTask>
```

[All lint rules](index.md)
