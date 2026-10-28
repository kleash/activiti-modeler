# C13 listeners

Hand-written seed for the three kinds of listeners the engine knows: execution listeners (process, flow nodes, sequence
flows), task listeners and process-level engine event listeners, in every implementation type (class, expression,
delegate expression, throw event), with fields, `onTransaction` and `customPropertiesResolver*`.

| Process (`seed/processes/`) | What it shows |
|---|---|
| `executionListeners` | `start`/`end` on the process, on a start event, service tasks, a gateway, a user task and an end event, `take` on sequence flows, all three implementation types and `<activiti:field>`s (string and expression, on classes and on a delegate expression bean). The recording list `executionListenerCalls` is the exact call order. The process `end` listeners run after the instance is gone, so they can only be observed by throwing (business key `fail-<type>`); the end listener of the exclusive gateway is never called |
| `transactionListeners` | Execution and task listeners with `onTransaction` (`before-commit`, `committed`, `rolled-back`; `delegateExpression` only) and the three `customPropertiesResolver` forms. When the transaction commits only the first two phases run, when it rolls back only `rolled-back` runs; the results are read back from the `transactionLog` bean |
| `taskListeners` | Task listeners for `create`, `assignment`, `complete`, `delete` and `all`; `delete` also runs when an interrupting timer boundary event cancels the task |
| `eventListeners` | `<activiti:eventListener>` with `class`, `delegateExpression` and `throwEvent` = `signal`, `globalSignal`, `message`; `events` and `entityType` filter what a listener sees |
| `errorEventListener` | `throwEvent="error"`: the listener raises a BPMN error from the execution of the event, which the boundary event of the task being created catches |

Support code (`docs/corpus-support.md`, section C13): `FieldExecutionListener` / `${fieldExecutionListener}`,
`${listenerRecorder}` (record from an expression listener: the name `notify` is blocked in expressions), `${endGuard}` /
`EndGuardListener`, `${transactionLog}` with the six `...ExecutionListener` / `...TaskListener` phase beans,
`CorpusPropertiesResolver`, `${delegatePropertiesResolver}`, `${propertiesFactory}`; plus the existing recording listeners.

Engine behaviour asserted here is in `docs/engine-findings.md`, section "C13 listeners".

`model-expect.json` asserts the parsed listeners (event, implementation type and value, fields, `onTransaction`, resolver
type) of the process, the nodes and the flows, and the process event listeners (`events`, `entityType`, implementation type
for the throw variants). Every flow node and sequence flow is visited (no exemptions).

Run: `scripts/verify-models.sh corpus --project C13`
