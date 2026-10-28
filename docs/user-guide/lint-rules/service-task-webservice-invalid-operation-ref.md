# service-task-webservice-invalid-operation-ref

**A web service task refers to an operation that does not exist**

| | |
|---|---|
| Rule | `activiti/service-task-webservice-invalid-operation-ref` |
| Severity | error |
| Engine problem key | `SERVICE_TASK_WEBSERVICE_INVALID_OPERATION_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Web service tasks do not run in Activiti 9 (no CXF importer); the validator still checks the operation reference.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.1-9](../../research/activiti-9-bpmn-support.md).

## How to fix

Replace the web service task by a connector or a Java class.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="w" implementation="##WebService" operationRef="ghost"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
