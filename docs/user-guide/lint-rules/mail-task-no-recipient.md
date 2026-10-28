# mail-task-no-recipient

**A mail task has no "to" field**

| | |
|---|---|
| Rule | `activiti/mail-task-no-recipient` |
| Severity | error |
| Engine problem key | `MAIL_TASK_NO_RECIPIENT` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Mail tasks need a recipient.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Add the field `to` in the **Mail** group.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="text"><activiti:string>x</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field><activiti:field name="text"><activiti:string>x</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
