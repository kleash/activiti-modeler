# Error mapping

Turns Java exceptions of a task into BPMN errors.

**Shown for:** service tasks that use a Java class, and call activities.

| Field | Entry id | Written to the model |
|---|---|---|
| Exception mappings | `errors.mapExceptions` | `<activiti:mapException errorCode includeChildExceptions>ExceptionClass</...>`, in document order |

## Engine notes

- The first matching entry wins; an entry without a class is the default. `includeChildExceptions=false` needs the exact class ([C08.7](../../engine-findings.md)).
- Only `activiti:class` tasks are wired. The entries of a `delegateExpression` task are parsed and never used ([C08.6](../../engine-findings.md)).
- A call activity maps exceptions of the `activiti:class` tasks of the called process.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
