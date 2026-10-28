# mail-task-no-content

**A mail task has no text, html, textVar or htmlVar field**

| | |
|---|---|
| Rule | `activiti/mail-task-no-content` |
| Severity | error |
| Engine problem key | `MAIL_TASK_NO_CONTENT` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A mail needs a body: the validator rejects a mail task that sets neither `text`, `html`, `textVar` nor `htmlVar`, because the mail behavior has nothing to send.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Add one of the fields `text`, `html`, `textVar` or `htmlVar`.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field><activiti:field name="html"><activiti:string><b>x</b></activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
