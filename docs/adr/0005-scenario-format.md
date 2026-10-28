# ADR 0005: Executable test scenarios as data

- Status: Accepted (revised 2026-10-26: isolation, history, job driving, richer oracles)
- Date: 2026-10-26

## Context

Every model the modeler generates must be deployed **and run**. The runs must cover every path, with inputs and outputs asserted:
- final variables;
- the path taken;
- task assignment and form;
- connector and call-activity mappings;
- every matched DMN rule and each aggregation result.

New models must be able to add tests without writing Java, and the modeler's "Run scenario" uses the same format.

Engine facts that shape the design were checked in the 9.0.0 sources:

- **Message correlation:** `ProcessRuntime.receive` finds the message subscription with `.singleResult()` filtered by name and correlation key (`RuntimeReceiveMessagePayloadEventListener`). Two matching subscriptions throw. A different correlation key gives "not found".
- **Signals:** `ProcessRuntime.signal` broadcasts to every waiting instance (`signalEventReceived`).
- **Call activities:** they resolve the **latest** definition by key across all deployments.
- **Message start:** names must be unique across deployed definitions.
- **History:** `spring.activiti.history-level` defaults to `NONE` and `spring.activiti.db-history-used` to `false`. With `db-history-used=false` the history tables are not even created (`ActivitiProperties`, `DbSqlSession`).
- **Timers:** there is no due-date setter. Fire a timer with `ManagementService.moveTimerToExecutableJob(id)` and then `executeJob(id)`.
- **Failed jobs:** a failed job with retries left becomes a timer job, delayed by the retry cycle. With no retries left it becomes a dead-letter job (`moveDeadLetterJobToExecutableJob` revives it).
- **Retry cycle scope:** `failedJobRetryTimeCycle` is honoured for service tasks only (`JobRetryCmd`).
- **Async warnings:** with the async executor off, `AsyncPropertyValidator` adds the warnings `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE`, `EVENT_TIMER_ASYNC_NOT_AVAILABLE` and `SIGNAL_ASYNC_NOT_AVAILABLE`. They don't stop deployment.
- **Task completion:** `TaskRuntime.complete` requires the task to be assigned to the caller. Completion variables are local-scope and reach the process only through mappings.
- **Rollback:** a synchronous exception rolls back the whole API call, so no incident is created. An exception in an async job creates a failed job.

## Decision

Scenarios are JSON files (`scenarios/<name>.scenario.json`) validated by `schemas/scenario.schema.json`. They are executed by the Java library `activiti-scenario-runner`, which is used by:
- the verification harness (JUnit 5 dynamic tests);
- the modeler server (`POST /api/dev/scenarios/run`).

### Isolation

- **Corpus projects:** each one runs in its **own Spring application context with its own in-memory H2 database**. Contexts are cached by project, never shared across projects.
- **Within a project:** scenarios run sequentially. Every query the runner makes (tasks, jobs, timers, executions, history) is **scoped to the scenario's process-instance tree**: the root instance plus every child linked via `superProcessInstanceId`, recursively.
- **Cleanup:** after each scenario the runner deletes any instance it left active, together with its jobs.
- **Lint:** process keys and message-start names must be unique within a project (L34).
- **Same-name subscriptions:** where a model can hold two message subscriptions with the same name at the same time, lint warns (L30). The corpus asserts the engine's actual behaviour in that situation (C06).

### Required engine configuration for the runner

```properties
spring.activiti.history-level=full
spring.activiti.db-history-used=true
spring.activiti.deployment-mode=default
spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn,**.dmn
```

With `deployment-mode=default` the whole project goes into one deployment, all or nothing. `never-fail` must not be used: it silently drops invalid models, which gives a false green. The runner fails at startup if history is not `full` with DB history on.

### Job driving (`JobDriver`)

| Mode | Used by | `fireTimer` | `executeJobs` |
|---|---|---|---|
| `MANUAL` (async executor off) | verification harness | `moveTimerToExecutableJob` + `executeJob` | execute every executable job in the instance tree until none are left (bounded loop) |
| `EXECUTOR` (async executor on) | modeler server | `moveTimerToExecutableJob`, then wait for the job to disappear (timeout) | wait until the tree has no executable jobs (timeout); timers of the tree that are due on the engine clock (after `advanceClock`) are made executable at once, because the executor's timer acquisition thread sleeps for its wait time (10 s) and ignores a clock that jumped meanwhile (`ExecutorModeSlowAcquisitionTest`); retry timers of the tree are made executable at once, a dead letter that is an optimistic locking failure (the async-signal race, engine findings 35) is moved back to executable (max 5 times), any other dead letter fails the step |

Scenarios that assert a state between an async step and its job (for example a job waiting in front of an async service task) hold only in `MANUAL` mode. The corpus-over-REST run (`CorpusOverRestTest`, `EXECUTOR` mode) skips them by name, with a reason and a stale-entry check: C02 `async-service-tasks`, C07 `signal-async`, C10 `async-sub-process`, and C19 `service-retries` "a task that does not fail…" (its job succeeds, so the executor may finish it before the step looks).

The async-executor warnings above are expected in `MANUAL` mode. The harness filters them by key, and `/validate` labels them "only because the executor is off".

### Identity

- **Users:** scenario `users` are added to an `ExtendedInMemoryUserDetailsManager` as `ROLE_ACTIVITI_USER` plus `GROUP_<g>` authorities.
- **Authentication:** for every step the runner authenticates the acting user in the `SecurityContext`, **and** sets `Authentication.setAuthenticatedUserId`. It clears both afterwards.
- **Claiming:** `completeTask` claims first, unless the task is already assigned to that user. `claim`, `release`, `assign` and `delegate`-style moves are also available as explicit steps.

### Format

```jsonc
{
  "$schema": "../../schemas/scenario.schema.json",
  "name": "loan approval",
  "users": { "alice": ["reviewers"], "bob": ["managers"] },
  "clock": "2030-01-01T09:00:00Z",                 // optional fixed engine clock (ProcessEngineConfiguration clock)
  "scenarios": [
    {
      "name": "high amount is reviewed and approved",
      "start": { "process": "loanApproval", "businessKey": "L-1", "user": "alice",
                 "variables": { "amount": 5000 } },
      // alternatives: "start": { "message": "newLoan", ... } | { "signal": "go" } | { "timer": "timerStart" }
      //   (a timer start fires the start timer job of that start event)
      "steps": [
        { "expectTask": { "activity": "review", "name": "Review L-1", "description": "...",
                          "assignee": null, "owner": null, "candidateUsers": [], "candidateGroups": ["reviewers"],
                          "priority": 80, "category": "credit", "formKey": "reviewForm",
                          "dueDate": "2030-01-02T09:00:00Z", "localVariables": { "amount": 5000 } } },
        { "claim": { "activity": "review", "user": "alice" } },
        { "completeTask": { "activity": "review", "user": "alice", "variables": { "approved": true } } },
        { "completeTask": { "activity": "approveEach", "match": { "localVariables": { "person": "bob" } }, "user": "bob" } },
        { "expectConnectorCall": { "activity": "callCrm", "inbound": { "customerId": "C-7", "_activiti_dmn_table_": { "$ignore": true } } } },
        { "expectChildInstance": { "callActivity": "doKyc", "process": "kyc", "startVariables": { "cid": "C-7" },
                                   "path": { "contains": ["kycDone"] } } },
        { "message": { "name": "docsReceived", "correlationKey": "L-1", "variables": { "docs": 3 } } },
        { "signal": { "name": "audit", "variables": {} } },
        { "triggerReceiveTask": { "activity": "waitForPayment" } },
        { "fireTimer": { "activity": "reminder" } },
        { "advanceClock": "PT25H" },
        { "executeJobs": {} },
        { "failJobUntilDeadLetter": { "activity": "flakyCall" } },
        { "completeTask": { "activity": "bad", "user": "alice",
                            "expectFailure": { "exception": "ActivitiException", "messageContains": "No outgoing" } } },
        { "expectActive": ["notify"] },
        { "setVariables": { "x": 1 } }
      ],
      "expect": {
        "state": "COMPLETED",                       // COMPLETED | ACTIVE | DEADLETTER
        "endEvents": ["approvedEnd"],
        "path": {
          "contains": ["riskCheck", "review"],      // order-free set
          "notContains": ["rejectedEnd"],
          "order": [["start", "riskCheck"], ["riskCheck", "review"]],   // happens-before pairs (only along one branch)
          "sequenceFlows": ["toReview"]             // sequence flows taken (history of activity transitions)
        },
        "variables": { "riskLevel": "low", "score": { "$gt": 10 }, "ref": { "$regex": "^L-" } },
        "absentVariables": ["tmp"],
        "deadLetterJobs": [ { "activity": "flakyCall", "exceptionMessageContains": "boom" } ]
      }
    }
  ],
  "decisions": [
    { "decision": "riskLevel", "inputs": { "amount": 5000 },
      "expect": { "result": [ { "riskLevel": "medium" } ], "matchedRules": ["Rule_medium"] } }
  ]
}
```

- **Matchers:** a literal value means equals. The operators are `$exists`, `$type`, `$regex`, `$gt`, `$gte`, `$lt`, `$lte`, `$contains`, `$size`, `$any` and `$ignore`.
- **`expectConnectorCall`:** asserts on a recording `Connector` wrapper that the harness and modeler server register around every connector bean, including `dmn-connector.EXECUTE_TABLE`. It captures the inbound variables of each call.
- **Paths:**
  - Paths are read from `HistoricActivityInstance`.
  - Sequence flows taken are recorded by a global `ActivitiEventListener` for `SEQUENCEFLOW_TAKEN`, registered through a `ProcessEngineConfigurationConfigurer`. The event is fired in `ContinueProcessOperation`.
  - `order` asserts happens-before only, never total order, so parallel branches do not make it flaky.

### Static model expectations (`model-expect.json`)

Some attributes have no observable runtime effect in a single run, such as `candidateStarterUsers`, `category`, `exclusive=false` and `businessCalendarName`. These are asserted statically.

A hand-written `model-expect.json` per project lists element-attribute expectations. The harness checks them against:
- the `BpmnModel` parsed by the engine;
- `RepositoryService` identity links for candidate starters;
- (added 2026-10-27) the `Extension` the runtime's reader parsed from `-extensions.json` (`ProcessExtensionService`): properties by name, mappings and constants by element id, for example the `_activiti_dmn_table_` constant and the mapping type of a decision task.

### Path coverage

For each model, across all its scenarios, **every sequence flow and every flow node** must be visited, including boundary events, event sub processes, error ends and links. Exceptions are listed with reasons in `scenarios/coverage-exemptions.json`. Missing coverage fails the suite.

### Oracle independence

Scenarios, `model-expect.json` and coverage exemptions are **written by hand**. The modeler never generates them for the verification corpus, so the system under test does not write its own expected results.

## Consequences

- The harness can run any folder that contains `scenarios/`, using the `verify <dir>` CLI and `-Dcorpus.dir`. New models need no Java.
