# service-task-invalid-type

**A service task has an unknown activiti:type**

| | |
|---|---|
| Rule | `activiti/service-task-invalid-type` |
| Severity | error |
| Engine problem key | `SERVICE_TASK_INVALID_TYPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti knows mail, mule, camel, shell and dmn; any other type is rejected. (Of those only mail and shell work: see the unsupported service task type rule.)

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Use mail or shell, or choose another implementation.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="external"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
