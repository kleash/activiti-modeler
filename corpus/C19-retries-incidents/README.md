# C19 retries-incidents

Hand-written seed for failed jobs: `activiti:failedJobRetryTimeCycle` (T15a), the default of 3 retries, dead-letter jobs and
the difference between an asynchronous failure (a failed job) and a synchronous one (a rollback). The state the scenarios
assert is `DEADLETTER`, `deadLetterJobs` and `expectFailure`.

| Process (`seed/processes/`) | What it shows |
|---|---|
| `serviceRetries` | Four asynchronous service tasks, `R2/PT10S`, `R5/PT1S`, `R1/PT5S` and no cycle. `failJobUntilDeadLetter` drives each to the dead-letter table; the delegate numbers its attempts in the exception message, so `deadLetterJobs.exceptionMessageContains` proves the count: 2, 5, 1 and 3 (the default). Each task also completes when it does not fail |
| `asyncUserTask` | **A cycle on a non-service element is ignored.** An asynchronous user task declares `R1/PT5S` but its failed job still gets the default 3 retries (attempt 3 in the dead-letter job) |
| `syncFailure` | Synchronous failures create no job: a failing first task rejects the start, a failing second task rolls the completion of the user task before it back (task still open, no dead-letter job) |

Support code: `${countingFailure}` (delegate expression) and `${countingFailureTaskListener}` with the `attemptCounter` bean
count the attempts across the rolled-back transactions; `FailureDelegate` from C08 does the synchronous failures
(`docs/corpus-support.md`, sections C08 and C19).

Limits of the scenario format worth knowing: a failing job cannot be executed once and then left alone (`executeJobs`,
`fireTimer` and `failJobUntilDeadLetter` either succeed or loop to the dead-letter table), so a job that fails once and then
succeeds is not expressible, and the intermediate timer job with its retry due date is not observable; the attempt count
in the message stands in for both. Reviving a dead-letter job is not a step either.

`model-expect.json` asserts `async`, `exclusive` and the parsed `failedJobRetryTimeCycleValue` on all four service tasks and
on the user task (the model accepts the cycle there, the engine ignores it). Every flow node and sequence flow is visited
(no exemptions).

Run: `scripts/verify-models.sh corpus --project C19`
