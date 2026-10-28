# process-end-listener-sets-variable

**A process end listener that sets a variable**

| | |
|---|---|
| Rule | `activiti/process-end-listener-sets-variable` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The process `end` execution listeners run after the process instance execution was deleted, so a `setVariable` inserts a variable for a deleted execution (`PersistenceException`, foreign key violation) and the whole completion rolls back: the last task cannot be completed.

Evidence: [engine-findings C13.1](../../engine-findings.md).

## How to fix

Set the variable before the end event, or listen on the last activity instead.

## Example

Reported:

```xml
<!-- process -->
<extensionElements><activiti:executionListener event="end" expression="${execution.setVariable('done', true)}"/></extensionElements>
```

Accepted:

```xml
<!-- process -->
<extensionElements><activiti:executionListener event="end" expression="${audit.log(execution)}"/></extensionElements>
```

[All lint rules](index.md)
