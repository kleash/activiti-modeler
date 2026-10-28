# user-task-listener-implementation-missing

**A task listener has no class, expression or delegate expression**

| | |
|---|---|
| Rule | `activiti/user-task-listener-implementation-missing` |
| Severity | error |
| Engine problem key | `USER_TASK_LISTENER_IMPLEMENTATION_MISSING` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The listener would be called but has nothing to call.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Java class**, **Expression** or **Delegate expression** on the task listener.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"><extensionElements><activiti:taskListener event="create"/></extensionElements></userTask>
```

Accepted:

```xml
<!-- process -->
<userTask id="u"><extensionElements><activiti:taskListener event="create" delegateExpression="${l}"/></extensionElements></userTask>
```

[All lint rules](index.md)
