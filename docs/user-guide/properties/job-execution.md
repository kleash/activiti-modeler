# Job execution

How a failing job is retried.

**Shown for:** service tasks only.

| Field | Entry id | Written to the model |
|---|---|---|
| Retry time cycle | `job.failedJobRetryTimeCycle` | `<activiti:failedJobRetryTimeCycle>R5/PT10S</...>` in the extension elements |

## Engine notes

- The number of attempts is the `R<n>` of the cycle, or 3 without one; a job whose retries are used up becomes a dead-letter job ([C19.1](../../engine-findings.md)).
- On any other element the cycle is parsed and ignored (3 attempts); that is why the group is shown for service tasks only ([C19.2](../../engine-findings.md)).
- A synchronous failure creates no job: the call is rolled back ([C19.3](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
