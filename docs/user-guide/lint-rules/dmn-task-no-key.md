# dmn-task-no-key

**A service task of type dmn has no decisionTableReferenceKey**

| | |
|---|---|
| Rule | `activiti/dmn-task-no-key` |
| Severity | error |
| Engine problem key | `DMN_TASK_NO_KEY` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The validator wants the field, but a service task with `activiti:type="dmn"` has no behaviour in Activiti 9 and is skipped at run time (R1 §0.1-3): use a Decision task instead.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §0.1-3](../../research/activiti-9-bpmn-support.md).

## How to fix

Replace the task by a Decision task.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="dm" activiti:type="dmn"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="dm" activiti:type="dmn"><extensionElements><activiti:field name="decisionTableReferenceKey"><activiti:string>rules</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
