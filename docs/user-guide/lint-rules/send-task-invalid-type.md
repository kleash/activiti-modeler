# send-task-invalid-type

**A send task has a type other than mail, mule or camel**

| | |
|---|---|
| Rule | `activiti/send-task-invalid-type` |
| Severity | error |
| Engine problem key | `SEND_TASK_INVALID_TYPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The validator knows three send task types (and mule / camel fail at deployment, see the unsupported service task type rule).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Set the type to mail.

## Example

Reported:

```xml
<!-- process -->
<sendTask id="s" activiti:type="sms"/>
```

Accepted:

```xml
<!-- process -->
<sendTask id="s" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field><activiti:field name="text"><activiti:string>x</activiti:string></activiti:field></extensionElements></sendTask>
```

[All lint rules](index.md)
