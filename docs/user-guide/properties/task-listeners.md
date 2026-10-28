# Task listeners

`<activiti:taskListener>` on user tasks.

**Shown for:** user tasks.

| Field | Entry id | Written to the model |
|---|---|---|
| Event type | `listeners.task[i].event` | `create`, `assignment`, `complete`, `delete` or `all` |
| Listener type and implementation | `listeners.task[i].type`, `.class`, `.expression`, `.delegateExpression` | as for execution listeners |
| Run in the transaction, resolver, fields | `listeners.task[i].onTransaction`, `.resolverType`, `.fields` | as for execution listeners |

## Engine notes

- A task with a static assignee fires `assignment` listeners before `create`; a task claimed later fires `create` first ([finding 8](../../engine-findings.md)).
- Completing a task fires `complete` and then `delete`, so a `delete` or `all` listener runs on every completion; `delete` also runs when the task is cancelled, for example by a boundary timer ([C13.5](../../engine-findings.md)).
- A skipped user task is created and deleted: its `create` and `delete` listeners run ([finding 9](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
