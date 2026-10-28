# initiator-needs-authenticated-user

**A start event stores the process initiator**

| | |
|---|---|
| Rule | `activiti/initiator-needs-authenticated-user` |
| Severity | info |
| Kind | Extra rule L26 (FEATURE_MATRIX §D) |

## Why it matters

`activiti:initiator` receives the authenticated user id, but nothing in Activiti 9 sets it: the host application must call `Authentication.setAuthenticatedUserId(...)` before starting the process (the modeler server does). Without it the variable is null.

Evidence: [R1 §0.3-20](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L26](../../research/activiti-9-bpmn-support.md), [engine-findings C15.7](../../engine-findings.md).

## How to fix

Set the authenticated user in the host application, or ignore this note.

## Example

Reported:

```xml
<!-- process -->
<startEvent id="s" activiti:initiator="starter"/>
```

Accepted:

```xml
<!-- process -->
<startEvent id="s"/>
```

[All lint rules](index.md)
