# send-task-webservice-invalid-operation-ref

**A web service send task refers to an operation that does not exist**

| | |
|---|---|
| Rule | `activiti/send-task-webservice-invalid-operation-ref` |
| Severity | error |
| Engine problem key | `SEND_TASK_WEBSERVICE_INVALID_OPERATION_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Web service tasks do not run in Activiti 9; the validator still checks the operation reference.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Replace the send task by a mail send task.

## Example

Reported:

```xml
<!-- process -->
<sendTask id="w" implementation="##WebService" operationRef="ghost"/>
```

Accepted:

```xml
<!-- process -->
<sendTask id="s" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field><activiti:field name="text"><activiti:string>x</activiti:string></activiti:field></extensionElements></sendTask>
```

[All lint rules](index.md)
