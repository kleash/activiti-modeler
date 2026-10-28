# connector-task-missing-name

**A connector service task without a name**

| | |
|---|---|
| Rule | `activiti/connector-task-missing-name` |
| Severity | warning |
| Kind | Extra rule L15 (FEATURE_MATRIX §D) |

## Why it matters

The name of a connector task becomes `IntegrationContext.clientName` (JUEL-evaluated). A connector that logs or routes by client name sees an empty one.

Evidence: [R1 §6.1](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L15](../../research/activiti-9-bpmn-support.md).

## How to fix

Name the task.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" name="Look up" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
