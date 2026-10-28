# Asynchronous continuation

Runs the activity in a job of its own transaction.

**Shown for:** tasks, call activities, sub processes and gateways where the engine allows it.

| Field | Entry id | Written to the model |
|---|---|---|
| Asynchronous | `async.async` | `activiti:async` |
| Exclusive | `async.exclusive` | `activiti:exclusive` |

## Engine notes

- Needs the async executor. With it off the job waits until something runs it, and lint reports `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE` ([finding 5](../../engine-findings.md)).
- A failed async job leaves no trace in the path; the failing activity is rolled back with its job ([finding 21](../../engine-findings.md)).
- A signal throw event with `async` creates an event job without a process instance and drops the payload ([finding 35](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
