# C21 coverage-extras

Hand-written seed for the matrix variants that no other project asserts ([verification index](../../docs/verification-index.md)): **E2** a timer start event
with `timeDuration`, **P1** `activiti:potentialStarter`, **T15** `activiti:extensionId`, the mapping types `MAP_ALL_INPUTS` and
`MAP_ALL_OUTPUTS` on a connector and on a user task (**T1**, **T5**), and **T16** multi-instance on service, script, manual and receive tasks and in the standard `loopDataInputRef` / `inputDataItem` form. The
beans behind the names are the corpus support library ([docs/corpus-support.md](../../docs/corpus-support.md)); the expectations were
derived from the Activiti 9.0.0 sources and the BPMN specification, and every surprise is an engine finding
([engine findings](../../docs/engine-findings.md) C21.1 to C21.8).

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `timerStartDuration` | A timer start with a plain ISO `timeDuration` (`PT1H`): `start.timer` fires its job; starting the process by key enters the timer start event without the timer | `timer-start-duration` (2) |
| `potentialStarters` | `<activiti:potentialStarter>` with `user(carl), user( dora ), group(auditors), reviewers`: users, groups and a bare name become candidate starters (identity links); because the element does not mark the starters as defined, the Spring Boot deployment also adds the group `*` and **everybody can start** | `potential-starters` (4) |
| `starterSources` | The `candidateStarterUsers` / `candidateStarterGroups` attributes together with a `potentialStarter` element: the engine adds both up and now the starters are restricted | `starter-sources` (5) |
| `extensionIds` | `activiti:extensionId` on a user task and a connector service task (the only activities the engine and the modeler know it on); it has no run-time effect, the extensions are found by element id. That the engine drops it on every other activity is proved by `EngineTrapsTest` | `extension-ids` |
| `mapAllVariants` | `MAP_ALL_INPUTS` and `MAP_ALL_OUTPUTS` on a connector (`echo.EXECUTE`, `crm.LOOKUP`) and on a user task: what the connector or task receives (exact `expectConnectorCall.inbound`, `expectTask.localVariables`), what reaches the process, constants against process variables, the ignored explicit mappings of the other direction | `map-all-variants` (2) |
| `expressionValues` | A value with `${...}` text passes untouched through `MAP_ALL_INPUTS`; any output mapping then refuses to copy it, so the completion fails and the task stays open (step-level `completeTask.expectFailure`) | `expression-values` (2) |
| `miExpressionTasks` | A parallel and a sequential multi-instance **service task** (expressions with `setVariableLocal`): collection, `elementVariable`, `elementIndexVariable`, `loopDataOutputRef` / `outputDataItem`, the aggregate as a list of maps without `outputDataItem`, a `completionCondition`, empty and invalid collections | `mi-expression-tasks` (5) |
| `miConnectorTasks` | Multi-instance on **connector** service tasks: the outbound variables stay local to the instance and the output mapping is skipped; `MAP_ALL_INPUTS` also sends the loop variables of the instance and of the root (`nrOfInstances`, `nrOfCompletedInstances`, `nrOfActiveInstances`) | `mi-connector-tasks` (2) |
| `miScriptTasks` | Multi-instance **script tasks**: parallel JUEL over a collection, sequential JavaScript with a `resultVariable` shared by the rounds, parallel JavaScript with a `loopCardinality`; empty and negative counts | `mi-script-tasks` (3) |
| `miWaitTasks` | A parallel multi-instance **manual task** (passes through once per parcel) and a parallel multi-instance **receive task**: every instance waits for its own trigger, picked by its element variable (`triggerReceiveTask` with `match`); `outputDataItem` names the element variable, so `packed` and `pickedUp` list the parcels in the order the instances completed | `mi-wait-tasks` |
| `miStandardForm` | A parallel multi-instance service task in the **standard form**, `loopDataInputRef` / `inputDataItem` instead of `activiti:collection` / `activiti:elementVariable` (the engine reads both into the same fields, engine finding 3). The build does not model it: it opens the hand-written file the way the editor opens a file and exports it, which proves that the modeler keeps that form | `mi-standard-form` |

`model-expect.json` asserts what a run cannot show: the timer definition, the candidate starters of the process model and of the process
definition's identity links (including the `*` group), the `extensionId` property of the user task and the service task, the loop characteristics
of every multi-instance task, and (the `extensions` section of the checker) the mapping types, inputs, outputs and constants as the
runtime's own reader parsed them. Every flow node and sequence flow is visited (81 of 81, no exemptions).

Not covered here, on purpose: a `timeDate` in the past. The timer start job of such a start event is already due at deployment, so an
engine with the async executor on (the modeler server) would start an instance of it at once; the future `timeDate`, the cycle and the
cron starts are in [C05](../C05-timers/README.md). The claim, release and assign steps and `setVariables` are used in
`../C01-user-tasks/scenarios/task-claim-release-assign.scenario.json`.

Support used: `crm.LOOKUP`, `echo.EXECUTE` ([corpus support](../../docs/corpus-support.md#connectors)); the connector descriptors
`crm.json` and `echo.json` in `seed/connectors/` are copies of the ones of C02. Nashorn runs the JavaScript scripts.
Engine notes: [engine findings](../../docs/engine-findings.md) C21.1 to C21.8, 1, 15, 19, 36.

Run: `scripts/verify-models.sh corpus --project C21`
