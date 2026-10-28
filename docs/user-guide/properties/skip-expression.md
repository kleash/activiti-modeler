# Skip expression

Skips an activity when the expression is true.

**Shown for:** tasks and sub processes.

| Field | Entry id | Written to the model |
|---|---|---|
| Skip expression | `skip.expression` | `activiti:skipExpression` |

## Engine notes

- It is evaluated only when the process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is true. Declare it as a process property with the default `true`; it cannot be a start variable because `ProcessRuntime` rejects names that start with an underscore ([finding 6](../../engine-findings.md)).
- A skipped user task is created and then deleted; its `create` and `delete` listeners run ([finding 9](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
