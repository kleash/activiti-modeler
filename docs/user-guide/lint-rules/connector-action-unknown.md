# connector-action-unknown

**A service task calls an action the connector does not define**

| | |
|---|---|
| Rule | `activiti/connector-action-unknown` |
| Severity | error |
| Kind | Extra rule L24 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

The connector exists in the project but has no action of that name.

Evidence: [R1 §6.1](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §D L24](../../FEATURE_MATRIX.md).

## How to fix

Pick one of the connector's actions, or add the action to its definition.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.DELETE"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
