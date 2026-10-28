# C08 errors-compensation

Hand-written seed for BPMN errors and compensation: error end (E8), error boundary (E22), error start of event sub processes
(E5), intermediate throw compensate (E18), compensation boundary and handler (E26), `activiti:mapException` (T15b), a BPMN error
thrown by a script, a connector and a delegate, and the errors that cross a call activity.

| Process (`seed/processes/`) | What it shows |
|---|---|
| `scriptError` | A JavaScript script task throws a `BpmnError`; the boundary event's `errorRef` points at a definitions-level `<error>` whose `errorCode` is the code that is matched, not the error's id |
| `connectorError` | A connector (`bpmnerror.EXECUTE`) throws a `BpmnError`; the boundary event with `errorRef` wins over the catch-all boundary event (no `errorRef`) on the same task. Connectors have no `mapException` |
| `delegateError` | The same precedence for an `activiti:class` delegate (`FailureDelegate`), plus the normal path |
| `uncaughtError` | A code that no boundary event catches: the engine rethrows a `BpmnError` ("No catching boundary event found") and the call is rolled back (`expectFailure`) |
| `subProcessError` | An error end event inside an embedded sub process, caught by the error boundary event of the sub process |
| `errorEventSubProcess` | Two event sub processes with an error start event, one with `errorRef` and one without (catch-all); the process ends through the event sub process |
| `mapExceptionClass` | `mapException` on an `activiti:class` task: exact class, `includeChildExceptions`, and the default entry without a class; first match in document order wins |
| `mapExceptionUnmatched` | Without a default entry an unmapped exception propagates and rolls the start back |
| `mapExceptionDelegateExpression` | **Negative case**: the `mapException` entry sits on a `delegateExpression` task, where the engine does not wire it; a Java exception is not mapped, a `BpmnError` from the same bean is caught |
| `mapExceptionCallActivity` + `riskyChild` | `mapException` on a call activity maps an exception of an `activiti:class` task in the child; a `BpmnError` of the child and an error end event of the child reach the call activity's error boundary events |
| `compensationFlow` | Two user tasks with compensation boundary events and handlers (`isForCompensation`, association); a throw compensate event broadcasts and the handlers run in reverse order of completion (distinct completion times under a fixed clock) |
| `compensationTargets` | Broadcast with `waitForCompletion="false"`, `activityRef` naming the handler and `activityRef` naming the compensated task (see below) |
| `compensationScopes` | Compensating a completed embedded sub process with `activityRef` = the sub process id |

Support code: `FailureDelegate` (class and `${failureDelegate}` bean), `recordingDelegate`, connector `bpmnerror.EXECUTE`;
documented in `docs/corpus-support.md`.

## Engine behaviour asserted here

See `docs/engine-findings.md`, section "C08 errors and compensation". In short: the error `errorCode` is matched, error boundary
events are `cancelActivity=false` in the parsed model although they interrupt, `mapException` works for class delegates and call
activities only, throw compensate `activityRef` must name the handler (a task id compensates nothing), `waitForCompletion` is
ignored, and compensation boundary events and event sub process containers leave no history activity.

`model-expect.json` asserts the parsed `mapExceptions`, the error and compensate event definitions (`errorRef`, `activityRef`,
`waitForCompletion`), `forCompensation`, and the call activity's `inParameters`. The coverage exemptions list only elements the
engine never records in history (compensation boundary events, event sub process containers), each with that reason.

Run: `scripts/verify-models.sh corpus --project C08`
