# Engine findings (Activiti 9.0.0)

Behaviour of Activiti 9.0.0 that the corpus and the scenario runner established, read from the engine sources
(`activiti-engine`, `activiti-api-*-impl`, `activiti-spring-process-extensions`, `activiti-bpmn-converter`) and confirmed by a
named scenario or test. The seed corpus oracles were written from the sources and the BPMN specification, never copied from
engine output; where the engine does something the ADRs or the feature matrix did not anticipate, the oracle states what the
engine does and this page says why. Items marked **docs** matter to a person who models: the user guide, a lint rule or the
properties panel says what they need to know.

Evidence is given as `file` (a corpus scenario or a test) so that a finding can be re-checked by running that file.

**Both engine lines.** The whole corpus also runs on Activiti 8.8.1 / JDK 21 in CI (ADR 0002, revision 2026-10-27), with the same
oracles and no difference in any result. The findings below were written from the 9.0.0 sources; every one that has a scenario therefore holds on
8.8.1 as well, so they describe the Activiti 8.x code line and not 9.0.0 alone (the engine bugs they pin, such as findings 28, 29, 26 and 27,
exist on both). The few real differences between the two lines are in the section [Activiti 8.8.1 next to 9.0.0](#activiti-881-next-to-900).

## Activiti 8.8.1 next to 9.0.0

The jars of both releases were compared class
by class (34 `org.activiti` jars, the same classes in both, the same declared members; the bytecode normalised for compiler noise) and then every
resource file, and each difference was probed with a throwaway test on both stacks (JDK 21 + 8.8.1 and JDK 25 + 9.0.0, H2). The corpus itself shows
**no** difference. This is a heuristic comparison plus 2326 passing tests, strong evidence and not a proof. No test in the repository pins L1 or L2:
the probes were throwaway, and nothing in our code reaches either of them. Re-check them with the recipes below before relying on them.

L1. **9.0.0 returns wrong results for a `TaskQuery` that filters by a variable value and by anything else; 8.8.1 is correct.**
    `Task.xml` joins the variable filter with `and a_${varIndex}.ID_ is not null` in 8.8.1 and with `or a_${varIndex}.ID_ is not null` in 9.0.0, so the
    SQL becomes `(all other filters) OR (the variable matches)`. Probe: two processes, `pa` (task "Task A", variables x=1, y=2) and `pb` (task "Task B",
    x=1, y=3).

    | Query | Correct | 8.8.1 | 9.0.0 |
    |---|---|---|---|
    | `taskName("Task A").processVariableValueEquals("x", 1)` | 1 task | 1 | **2** |
    | `taskName("Task A").processVariableValueEquals("y", 3)` | 0 tasks | 0 | **2** |
    | `processVariableValueEquals("x", 1).processVariableValueEquals("y", 2)` | 1 task | 1 | **2** |
    | `processVariableValueEquals("x", 1)` alone | 2 tasks | 2 | 2 |

    The filter alone is right on both; the bug is the combination with any other filter (a second variable filter included). **Consequence for
    users:** on Activiti 9.0.0 do not query tasks by a variable value together with another criterion (name, assignee, process definition, ...);
    fetch by the other criterion and filter by the variable in your own code, or use 8.8.1. Not affected: the modeler, the runner and the REST core
    (`TaskViews`, `InstanceService` never filter by variable value), so neither the corpus nor any endpoint of ours shows it. **docs**, and a
    constraint on any future "find tasks by variable" feature: it needs a test on both lines.
L2. **The database schema version differs, and a database written by 8.8.1 cannot be opened by 9.0.0.** 8.8.1 stamps schema version `8.1.5` (it ships
    the upgrade step `upgradestep.814.to.815`, which only updates `schema.version`; `ProcessEngine.VERSION` reads 8.1.5); 9.0.0 does not have that step
    and stamps `8.1.4`. Probe with an H2 file database:
    - created by 8.8.1, opened by 9.0.0: **fails** at start with `ActivitiException: Could not update Activiti database schema: unknown version from database: '8.1.5'`;
    - created by 9.0.0 (`schema.version=8.1.4`), opened by 8.8.1: works and upgrades the database in place (`schema.history = create(8.1.4) upgrade(8.1.4->8.1.5)`),
      after which 9.0.0 cannot open it any more.

    **Consequence for users, plainly:** a database that Activiti 8.8.1 has created or opened cannot be used by Activiti 9.0.0, and there is no way back.
    This covers a file database (`spring.datasource.url=jdbc:h2:file:...`, the modeler server's workspace H2 file if you point it there) as much as a production
    database. Moving an application from 8.8.1 to 9.0.0 therefore needs a fresh database (or a migration you write); do not start the 9.0.0 build on a
    database the 8.8.1 build has touched, and do not start the 8.8.1 build on a database you still need for 9.0.0, because opening it upgrades it irreversibly.
    Keep one database per engine line, and take a backup before the first start with another line. The default (an in-memory database) is not affected.
    `EngineInfoService` reads the engine's `pom.properties` and not `ProcessEngine.VERSION`, so the engine report is right on both lines.
L3. **9.0.0's engine calls `java.lang.IO` (`IO.println`, `IO.print`), a JDK 25 class.** It does so in `DbSchemaExport`, `test.profiler.ConsoleLogger`, and debug
    prints of `JuelScriptEngine` and juel's `tree.impl.Builder`; 8.8.1 uses `System.out`. Together with class file version 69 this is why 9.0.0 cannot run below
    JDK 25 (it only touches debug and tooling paths). Our own code uses no JDK 22 to 25 API: the build compiles with `--release 21`.
L4. **Smaller differences, none affecting us.** (a) The Oracle upgrade script `800.to.810` reads `alter table ACT_RU_IDENTITYLINK add DETAILS_ BLOB;` in 8.8.1
    and `... add column DETAILS_ BLOB;` in 9.0.0; as far as we know Oracle does not accept `ADD COLUMN`, so this looks like a 9.0.0 regression (not tested; the project
    uses H2 only). (b) The 8.8.1 starter jars carry `META-INF/spring-configuration-metadata.json` for `spring.activiti.*` and the 9.0.0 jars do not, so IDE completion of
    those properties exists on 8.8.1 only. (c) `JuelScriptEngine` asks `System.getSecurityManager()` in 8.8.1 and uses `null` in 9.0.0: no behaviour change, a security
    manager cannot be installed on JDK 24+.

The scenario format has no version guards; ADR 0002 (revision 2026-10-27) describes them for the first difference that a scenario can see.

## Differs from what the ADRs or the feature matrix assume

1. **Task completion always offers `sys_task_assignee` to the output mapping.** `CompleteTaskCmd` builds the variables the
   `VariablesPropagator` sees from the task-local variables (the input-mapped ones and the completion variables, which
   `TaskRuntime.complete` sets with local scope) **plus `sys_task_assignee`** (the assignee). Consequences: (a) the output
   mapping runs even when the task is completed without variables, so a `VALUE` output is always applied and a task completed
   without variables still produces `completedBy`; (b) an output mapping can read an input-mapped task-local variable and the
   assignee (`{"type":"VARIABLE","value":"sys_task_assignee"}`); (c) `MAP_ALL` / `MAP_ALL_OUTPUTS` copy `sys_task_assignee`
   and every input-mapped variable into the process. Without a mapping for the element nothing is propagated at all.
   Evidence: `corpus/C01-user-tasks/scenarios/task-mappings.scenario.json`. **docs** (ADR 0005 says only that completion variables
   reach the process through mappings; the lint rule `user-task-map-all-copies-assignee` warns about `MAP_ALL` on user tasks).
2. **The default task priority is 0, not 50.** `Task.DEFAULT_PRIORITY = 0`. Evidence: `task-attributes.scenario.json`, task `plain`.
3. **`activiti:collection` is parsed into `MultiInstanceLoopCharacteristics.inputDataItem`.** The `MultiInstanceAttributesParser`
   reads the attribute `collection` and stores it as `inputDataItem` (the `loopDataInputRef`/`inputDataItem` elements have their own
   parsers); `activiti:elementVariable` becomes `elementVariable` and `activiti:elementIndexVariable` `elementIndexVariable`.
   The moddle model and `model-expect.json` must use these property names. Evidence: `C01-user-tasks/model-expect.json`
   (`reviewParallel`, `reviewSequential`).
4. **A `json` property (or one of an unrecognised type) without a default creates a process variable holding JSON null at
   start.** The extension reader converts the missing default with `convertValue(null, JsonNode.class)`, which evidently yields a
   `NullNode`, so the initiator sees a non-null default and creates the variable (observed; the source alone does not show it). It is therefore part of `MAP_ALL` inputs and
   of `execution.getVariables()`. Evidence: `C02-service-tasks/scenarios/connector-mappings.scenario.json` (`profile` is `null`
   in the inbound variables of `echoAll`). **docs**: the lint rule `json-property-without-default` reports a `json` property without a default.
5. **The standard process validators do not run when the async executor is off.** The Spring Boot starter then builds a
   `ProcessValidatorImpl` that holds only the async-property validator, so rules such as "service task without implementation" or
   gateway checks never run and invalid models deploy. The scenario runner adds the standard sets back
   (`activiti.scenario.full-validation`, default true) and the harness re-validates every parsed BPMN file; the only warnings it
   accepts are `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE`, `EVENT_TIMER_ASYNC_NOT_AVAILABLE`, `SIGNAL_ASYNC_NOT_AVAILABLE` and
   `PROCESS_DEFINITION_NOT_EXECUTABLE`. Evidence: `FullValidationTest` (runner), `DeploymentChecks` (harness). **docs**.
6. **`ProcessRuntime` rejects start variables whose name starts with an underscore.** `_ACTIVITI_SKIP_EXPRESSION_ENABLED`, which
   enables `skipExpression`, therefore cannot be a start variable; declare it as a process property with the default `true`
   instead (extensions file). Evidence: `C04-gateways/seed/processes/exclusive-skip-extensions.json`,
   `C01-user-tasks/seed/processes/skip-enabled-extensions.json`. **docs**: the lint rule `skip-expression-needs-enable-variable` says so.
7. **`executeJobs` is bounded, not stepwise.** `maxRounds` is a safety limit; the step fails when jobs are still executable after
   that many rounds. Intermediate states between two async jobs cannot be observed with a scenario. This is a runner decision,
   see `docs/user-guide/scenarios.md`.

## Task listeners, assignment and identity

8. **Listener order.** A user task with a static assignee fires the `assignment` listeners **before** `create` (assignment is
   handled while the task is being filled in); a task that is claimed later fires `create` first and `assignment` at the claim.
   Completing fires `complete` and then `delete` (the task is deleted after completion), so a `delete` or `all` listener runs on
   every normal completion. Evidence: `C01-user-tasks/scenarios/task-listeners.scenario.json`.
9. **A skipped user task is created and deleted.** With `_ACTIVITI_SKIP_EXPRESSION_ENABLED = true` and a true `skipExpression` the
   engine creates the task, runs its `create` listeners and fires `TASK_CREATED`, then deletes it (`delete` listeners run) and leaves; no
   assignment and no `complete`. The activity is in the history path. Without the variable the expression is ignored. Evidence:
   `C01-user-tasks/scenarios/skip-expression.scenario.json`.
10. **Assignee and owner are not task identity links.** They create `participant` links on the **process instance**;
   `TaskService.getIdentityLinksForTask` adds synthetic `assignee` and `owner` links to its answer. Custom
   `activiti:customResource` links are real task links of the given type and do **not** make the task visible through
   `TaskRuntime`, which shows a task to its assignee, owner, candidate users and members of candidate groups only. Evidence:
   `C01-user-tasks/scenarios/assignment-forms.scenario.json` (`byCustomResource`: `dave` has a `supervisor` link and cannot see the task).
11. **`activiti:customResource` is read inside `extensionElements`** (and as a direct child) by the child-parser map, by local name;
    `humanPerformer` becomes the assignee and `potentialOwner` candidate users and groups (a bare name is a group).
12. **Candidate expressions accept a string or a collection.** A comma separated string is split; a collection is used as is.
    Evidence: second scenario of `assignment-forms.scenario.json`.
13. **A user who cannot see a task gets "not found".** Claiming or completing it as a user outside the candidates fails with
    `NotFoundException: Unable to find task for the given id`, not with an authorization error. Evidence: the runner's
    `loan.scenario.json`.
14. **Business calendars.** `dueDate` accepts an ISO duration (relative to the engine clock) or an ISO date-time with the
    `dueDate` calendar (default); `duration` accepts ISO durations and repeat expressions; `cycle` needs a cron or repeat expression and depends on the JVM
    time zone, so the corpus does not use it. Evidence: `task-attributes.scenario.json`.

## Mappings and connectors

15. **Input mappings define the task-local and connector variables.** Without a mapping for the element a user task has no
    task-local variables and a connector gets only the constants; `MAP_ALL`/`MAP_ALL_INPUTS` pass every process variable plus the
    constants. A `VARIABLE` input is applied only when the source is a declared property or an existing variable. A `VALUE` that
    is exactly `${...}` keeps the type of the expression; embedded in text it is resolved to a string; an unresolvable expression
    gives `null` (whole) or an empty text (embedded) and only logs a warning. Evidence: `connector-mappings.scenario.json`,
    `task-mappings.scenario.json`.
16. **Output targets must be declared.** A `VARIABLE`/`JSONPATCH` output is applied only when its target is a declared property or
    an existing variable; otherwise it is silently dropped. `JSONPATCH` ignores the connector's values: it patches the current
    value of the target with static operations, creates intermediate objects and substitutes `/${name}` path segments (string or
    integer properties only). Evidence: `connector-mappings.scenario.json` (`patch`).
17. **`ephemeral` is only a flag of the integration context** that a connector can read (`hasEphemeralVariables()`); the engine
    does nothing else with it. Evidence: `flags.EXECUTE` in `connector-mappings.scenario.json`.
18. **An output mapping inside a sub process writes process variables, never sub process variables**, so a local aggregate needs a
    script task. Evidence: `C10-sub-processes/seed/processes/mi-sub-process.bpmn20.xml`.
19. **Multi-instance user tasks.** Completion variables of an instance are set local to the instance execution (no output mapping
    is applied) and `outputDataItem` / `loopDataOutputRef` collect them, in completion order for parallel instances. A parallel
    completion condition cancels the open instances. Evidence: `C01-user-tasks/scenarios/multi-instance-parallel.scenario.json`.

## Flow and jobs

20. **Event-based gateway.** History shows both catch events entered and both sequence flows taken; the loser's subscription or
    timer is removed when the winner fires. Evidence: `C04-gateways/scenarios/event-based.scenario.json`.
21. **A failed async job leaves no trace in the path.** The failing activity is rolled back with its job transaction, so it is
    not in the history until it succeeds; `expectActive` lists it while it waits. Evidence: runner `jobs.scenario.json`.
22. **`expectActive` includes boundary events** of an active activity (they are executions of their own).
23. **A synchronous failure rolls the call back**, including the task completion that caused it: an exclusive gateway without a
    default flow and no matching condition leaves the task open. Evidence: `C04-gateways/scenarios/exclusive-strict.scenario.json`.
24. **Spring auto-deployment stores absolute resource names** (the file URL), the programmatic builder keeps the names given;
    the harness asserts base names and definition keys in both. `.dmn` files land in the same deployment only with the `**.dmn`
    suffix. Without `db-history-used=true` the history tables do not exist. Evidence: `HistoryAndDeploymentSettingsTest`.

## Scripts, timers, messages and signals (C03, C05, C06, C07)

The oracles of `C03`, `C05`, `C06` and `C07` were derived from the sources first; each finding below is where the engine did something other
than R1 or the feature matrix say, or where R1 had no run-time evidence.

25. **`activiti:autoStoreVariables` does nothing with the bundled script languages.** The flag only switches `ScriptBindings.put` from
    "keep in the engine bindings" to "write a process variable". Nashorn never calls `put` for a global assignment (`x = 1;`) or a
    `var` declaration, and the JUEL script engine of this release cannot assign at all (`${x = 5}` is a parse error, EL 2.2). A script
    writes variables with `execution.setVariable(...)`. The lint rule `auto-store-variables-no-effect` warns about the flag.
    Evidence: `C03-script-tasks/scenarios/auto-store.scenario.json`.
26. **A start timer whose `activiti:endDate` lies before its due date is silently dropped when it fires.** `DefaultJobManager.executeTimerJob`
    deletes the job without running it (debug log only), so no instance starts and no error is reported; the end date is evaluated
    at fire time, not at deployment. Evidence: `C05-timers/scenarios/timer-starts.scenario.json`, fourth scenario.
27. **A repeating timer that fires late computes the next occurrence from the clock, not from the schedule.** `R/PT1H` with end date
    11:30, due at 10:00 and executed at 12:00, plans 13:00 (past the end date) and stops: the 11:00 occurrence is skipped, one reminder
    instead of two. With a finite `R3` the occurrences are `start + k * period` as long as the clock is on schedule (`maxIterations` is
    restored from the model on every execution), so `R3/PT1H` fires three times at hourly due dates. Evidence:
    `C05-timers/scenarios/end-date-timer.scenario.json` (second scenario), `repeating-timer.scenario.json`.
28. **A `signalEventDefinition` named by `activiti:signalExpression` fails to parse if the file declares any `<signal>`.**
    `BpmnModel.getSignal(null)` calls `id.equals(...)` on the declared signals, so the parse of an expression-named definition ends in
    `NullPointerException: Cannot invoke "String.equals(Object)" because "id" is null` ("Error parsing XML"), for catch, throw and
    boundary events alike; the same file deploys when it declares no signal. Consequently an expression-named signal can neither be
    declared nor given `activiti:scope` (it is global), and the modeler/lint must refuse the combination (R1 reported the expression form
    as working because the lab file had no `signal` element). Evidence: `verification-harness` `EngineTrapsTest`, and the
    signal-free `C07-signals/seed/processes/signal-expressions.bpmn20.xml`.
29. **The subscription of a catch event named by `signalExpression` survives the event.** `IntermediateCatchSignalEventActivityBehavior`
    removes it by comparing the event name with `signalRef`, which is null for an expression, so the execution keeps a stale subscription
    while it moves on. A second broadcast of the same name signals whatever the execution waits at: a receive task is left, a user task
    fails with `UserTask should not be signalled before complete`. Pinned (as a bug, not a feature) by
    `C07-signals/scenarios/signal-expression-leak.scenario.json`, second scenario; when it starts failing, the engine was fixed.
30. **A message start event's mapping is an output mapping of the message variables and drops the rest.** With
    `mappings.<startEventId>.outputs` only the mapped variables reach the process (`ref` became `orderRef`, `amount` vanished); a start event
    without a mapping entry passes the variables as they are. This matches R1 6.2.4, which does not say that the unmapped variables are
    lost. Evidence: `C06-messages/scenarios/message-start.scenario.json`.
31. **`ProcessRuntime.receive` finds its subscription with name and correlation key as filters and `singleResult()`.** A missing key is no
    filter: with two subscriptions of the name, with or without keys, `receive(name)` fails with `ActivitiException: Query return 2 results instead
    of max 1` and delivers nothing; with exactly one subscription whose key is set, `receive(name)` fails with `ActivitiObjectNotFoundException ...
    correlation key 'null' not found`; with a key it selects the one subscription. Two subscriptions with the same name **and** the same key
    cannot coexist: creating the second fails with `ActivitiIllegalArgumentException: Duplicate message subscription 'n' with correlation key 'k'`,
    which rolls back the whole call (a process start, for example). This is what lint L30 guards. Evidence:
    `C06-messages/scenarios/message-same-name.scenario.json`, `message-clash.scenario.json`.
32. **A message event sub process fires once per scope, interrupting or not.** `EventSubProcessMessageStartEventActivityBehavior.trigger` deletes the
    subscription in both cases and nothing recreates it, so a second `note` message finds no subscription. (A non-interrupting
    boundary message, in contrast, stays subscribed and can be received repeatedly.) Evidence:
    `C06-messages/scenarios/message-event-subprocess.scenario.json`, `message-boundary.scenario.json`.
33. **`<activiti:field>` on a `messageEventDefinition` is parsed but never injected.** The throw delegates are created with an empty field
    declaration list (`createThrowMessageJavaDelegate`, `createThrowMessageDelegateExpression`), so a field of the delegate stays `null`;
    only the input mapping of the throw event reaches the delegate (as `ThrowMessage.payload`). The XSD requires the field element inside
    `extensionElements`. Evidence: `C06-messages/scenarios/message-throw.scenario.json` (`fieldThrows` is `"[unset]:tagged"`).
34. **Event sub processes and their start events have no historic activity instance.** The path of an instance lists the elements inside
    (`markEscalated`, `recordNote`) but neither the sub process nor its message start event, so path coverage cannot see them; the corpus
    exempts them with this reason. Sequence flows inside are recorded. Evidence: `C06-messages/scenarios/coverage-exemptions.json`.
35. **An asynchronous signal throw creates an event job without process instance or execution, and drops the payload.**
    `EventSubscriptionEntityManagerImpl.scheduleEventAsync` stores only the subscription id in the job handler configuration (the
    "TODO: support payload" comment is in the source). The scenario runner therefore attributes such jobs to an instance through the
    subscription (`JobSupport.executableJobs`) and deletes orphaned ones after a scenario. With a running async executor the job is
    raced by the engine's after-commit hint (the job is not yet visible: `JobNotFoundException` in the log) and its acquisition thread;
    in about one run in forty both attempts failed with `ActivitiOptimisticLockingException` and the job moved to the retry table or, because
    event jobs are created with zero retries, straight to the dead-letter table. The runner's `EXECUTOR` mode therefore makes retry timers
    of the instance tree executable at once and moves a dead-letter job that failed with an optimistic locking exception back to the
    executable table (at most 5 times), then waits again; with that, 200 consecutive runs pass (`AsyncSignalStressTest`). `MANUAL` mode never had the race. Evidence:
    `C07-signals/scenarios/signal-async.scenario.json`, runner `AsyncEventJobsTest`.
36. **The expression language has no `+` for strings and no assignment.** `${'go-' + region}` fails with `Cannot coerce 'go-' of class
    java.lang.String to class java.lang.Double`; build names with `${'go-'.concat(region)}`. Lint L27 should flag `+` on string literals. Evidence: `EngineTrapsTest`,
    `C07-signals/seed/processes/signal-expressions.bpmn20.xml`.
37. **Signal payloads are not mapped.** `SignalEventHandler` sets the signal's variables on the catching execution as process variables; unlike
    messages there is no output mapping on the catch event (R1 6.2.4 lists signals with messages). A throw event hands over **all** variables of
    the throwing execution. Evidence: `C07-signals/scenarios/signal-catch.scenario.json`, `signal-parent.scenario.json` (the call activity has no
    mapping, yet `childResult` reaches the parent through the signal).
38. **Script tasks see the Spring beans** (`greeter.greet(...)` in JUEL and in JavaScript), `execution`, the process variables and the engine
    services (`runtimeService`, ...). A `BpmnError` raised by a script, from JavaScript (`throw new BpmnError(code, msg)` via `Java.type`) or from a bean
    called in a JUEL script, reaches error boundary events with that code (or without error reference); an unmatched code fails the
    call with `BpmnError: No catching boundary event found for error with errorCode '...'`; any other exception fails it with
    `problem evaluating script: ...`. The error boundary event is parsed with `cancelActivity=false` whatever the XML says. Evidence:
    `C03-script-tasks/scenarios/script-errors.scenario.json`, `juel-scripts.scenario.json`, `model-expect.json`.

## C08 errors and compensation

Numbered `C08.n` so that findings added by other corpus projects do not clash.

C08.1. **Compensation boundary events and event sub process containers are never in the history.** A compensation boundary
    event is created inside `AbstractBpmnActivityBehavior.leave` (outside `ContinueProcessOperation`), and `ErrorPropagation`
    starts the execution at the error start event inside an event sub process, so neither the boundary event nor the event sub
    process itself becomes a `HistoricActivityInstance` (the start event inside it does). Path coverage therefore cannot see
    them; `corpus/C08-errors-compensation/scenarios/coverage-exemptions.json` exempts exactly these elements, and the handler
    running is the proof that the boundary event worked. Should the runner count an event sub process as visited when its start
    event is, the two event sub process exemptions become redundant, and a redundant exemption fails the coverage check. Evidence:
    `compensation-flow.scenario.json`, `error-event-sub-process.scenario.json`.
C08.2. **Throw compensate: `activityRef` must name the compensation handler, not the compensated task.** The subscription a
    compensation boundary event creates is keyed by the id of the **handler** (`BoundaryCompensateEventActivityBehavior` inserts
    `compensationActivity.getId()`), and `IntermediateThrowCompensationEventActivityBehavior` looks subscriptions up by
    `activityRef`. `activityRef="cancelFlight"` (the handler) compensates that one activity; `activityRef="bookFlight"` (the
    task the BPMN specification means) finds nothing and the event passes silently. For a completed sub process the
    subscription is keyed by the sub process id, so `activityRef="<sub process id>"` is right there. Without `activityRef` the
    event broadcasts to the activities of its own container. **docs**: the modeler's `activityRef` picker offers handlers
    and sub processes, and the lint rule `compensate-activity-ref-not-handler` reports an `activityRef` that names a compensated activity.
    Evidence: `compensation-targets.scenario.json`, `compensation-scopes.scenario.json`.
C08.3. **`waitForCompletion` is parsed and ignored.** The source marks async compensation as a TODO
    (`ScopeUtil.throwCompensationEvent(..., false)`): the handlers of a throw event with `waitForCompletion="false"` still run
    to completion before the process moves on. Evidence: `compensation-targets.scenario.json` (broadcast case, `order`).
C08.4. **Handlers run in reverse order of the subscription's creation time.** The sort uses the engine clock, so two activities
    completed in the same millisecond (or under a fixed clock without `advanceClock`) compensate in an undefined order; the
    corpus separates them with `advanceClock`. Evidence: `compensation-flow.scenario.json`.
C08.5. **Error boundary events are `cancelActivity=false` in the parsed model** (the converter forces it) although they interrupt
    their activity at run time. `model-expect.json` asserts `false`; a UI must not offer the flag for error events. Evidence:
    `C08-errors-compensation/model-expect.json` (`scriptError.onInvalidAmount`).
C08.6. **`mapException` reaches a call activity through the child's `activiti:class` tasks.** An exception of an `activiti:class`
    task in the called process that the task does not map itself is looked up in the `mapException` list of the calling call
    activity (`ErrorPropagation.mapException`) and thrown as a BPMN error at the call activity; the child instance is deleted.
    A `BpmnError` of the child and the error end event of the child need no mapping and travel up to the call activity's error
    boundary events. The entries of a `delegateExpression` task are parsed into the model but never wired: the Java exception is
    wrapped in an `ActivitiException` and rolls the call back (T15b negative case). Connectors can only raise `BpmnError`.
    Evidence: `map-exception-call-activity.scenario.json`, `map-exception-limits.scenario.json`.
C08.7. **`mapException` matching is first-match in document order; the entry without a class is the default.**
    `includeChildExceptions` false needs the exact class (a subclass falls through to the default entry or propagates), true
    accepts subclasses. Evidence: `map-exception-class.scenario.json`.

## C09 transactions

Numbered `C09.n`.

C09.1. **A cancel end event needs completed compensable work in its transaction.** `CancelEndEventActivityBehavior` moves the
    compensation subscriptions of the transaction into an event scope execution (`createCopyOfSubProcessExecutionForCompensation`);
    `BoundaryCancelEventActivityBehavior` then looks that execution up. Without a completed compensable activity there is no
    event scope, the lookup fails with `No execution found for sub process of boundary cancel event <id>` and the whole
    completion rolls back (the task before the cancel end stays open). With compensable work the handlers run first (reverse
    order of completion), then the process leaves through the cancel boundary event. A cancel end event whose transaction never
    did compensable work is therefore a model error (lint L12). Evidence:
    `C09-transactions/scenarios/booking-transaction.scenario.json`.
C09.2. **While a transaction runs, the transaction and its cancel boundary event are active executions** (`expectActive` returns
    `booking`, `onCancel` and the inner task). After a cancellation both the cancel end event and the cancel boundary event are
    in the history, so `endEvents` of the root holds the cancel end and the end after the boundary flow. Evidence: the same
    scenario file.

## C11 call activities

Numbered `C11.n`.

C11.1. **A multi-instance call activity gets nothing back from its children.** `MultiInstanceActivityBehavior.completing` is
    empty ("required for supporting external subprocesses"), so the completion of the called instance never reaches
    `CallActivityBehavior.completing`: `activiti:out`, the extensions output mapping and the local variables
    `VariablesPropagator` would set for `outputDataItem` are all skipped. `loopDataOutputRef` still gets one entry per instance,
    but each entry is `null`; the multi-instance variables of the call activity (`item`, `loopCounter`) stay local to the
    instance executions. This holds for parallel and sequential loops (debugged with variable events: the child's `result`
    never reaches the instance execution). **docs**: the lint rule `multi-instance-call-activity-output` reports `activiti:out`, an output
    mapping or `outputDataItem` on a multi-instance call activity, and the multi-instance group of the panel offers no output
    collection for a call activity. Evidence: `C11-call-activities/scenarios/call-multi-instance.scenario.json`.
C11.2. **Mapped inputs reach a child only when the child has an extensions entry.** `MappingAwareCallActivityBehavior` hands the
    mapped inputs (VARIABLE, VALUE, constants, MAP_ALL) to `ProcessVariablesInitiator.calculateVariablesFromExtensionFile`,
    which returns an empty map when the called definition has no `-extensions.json` entry. A child without one therefore starts
    without the mapped inputs, silently; the outputs (MAP_ALL or mapped) still come back, because they use the mapping of the
    calling call activity only. `activiti:in` is unaffected. **docs**: the lint rule `call-activity-called-process-without-extensions` reports it;
    a call activity mapping needs a properties entry (possibly empty) for the called process. Evidence: `call-mappings.scenario.json` (`passBare`, `passAll`).
C11.3. **Called-process properties are applied at call time.** With an extensions entry, the child's property defaults fill
    missing inputs (`retries` = 3), a missing required property fails the call (`Can't start process 'riskCheck' without
    required variables - customerId`, rolling the whole start back) and values are type validated. A `VALUE` input of a call
    activity overrides the child default (`channel` = `web`); a constant is added after the mapped inputs. Evidence:
    `call-mappings.scenario.json`.
C11.4. **`activiti:in`/`activiti:out` need no extensions file and are applied after the mapping.** `sourceExpression` of an `out`
    parameter is evaluated on the child instance (`${total * 2}`), `in` expressions on the calling execution; without
    `inheritVariables` and without mapping the child sees only the `in` parameters. Evidence: `call-in-out.scenario.json`,
    `call-inherit.scenario.json`.

## C13 listeners

Numbered `C13.n`.

C13.1. **A process-level `end` execution listener cannot write process variables.** `EndExecutionOperation` deletes the process
    instance execution first and runs the process `end` listeners afterwards, so a `setVariable` there inserts a variable for a
    deleted execution (`PersistenceException`, foreign key `ACT_FK_VAR_EXE`) and the whole completion rolls back: the last task
    cannot be completed, or the start fails. Reading and side effects outside the process are fine. The corpus listeners
    therefore only throw (business key `fail-<type>`), which proves they were called. **docs**: the listener group of the panel says so for a
    process `end` listener, and the lint rule `process-end-listener-sets-variable` reports an expression that sets a variable. Evidence:
    `C13-listeners/scenarios/execution-listeners.scenario.json` (the three `process end listener` scenarios).
C13.2. **An exclusive gateway never fires its `end` execution listeners.** `ExclusiveGatewayActivityBehavior.leave` moves the
    execution onto the chosen sequence flow itself, so the usual end-of-node processing (`end` listeners, the node's
    `take`-independent bookkeeping) is skipped; `start` listeners and the `take` listeners of the flows run. Other gateways and
    all activities run their `end` listeners. Evidence: `execution-listeners.scenario.json` (`decide` declares an `end`
    listener that never appears in `executionListenerCalls`).
C13.3. **Expressions cannot call a method named `notify`.** The expression resolver blocks the methods of `Object`, including
    `notify`, so `${recordingExecutionListener.notify(execution)}` fails with "Error while evaluating expression". The corpus
    uses `${listenerRecorder.recordExecution(execution)}` / `recordTask(task)` (`ListenerRecorder`). Evidence:
    `execution-listeners.scenario.json`, and C22.1 for a task listener.
C13.4. **Transaction-dependent listeners.** Only `delegateExpression` works with `onTransaction`: in
    `ListenerNotificationHelper` a class listener is cast to the transaction-dependent interface (a `ClassCastException` unless
    the class implements it) and the validator rejects `expression`; the corpus does not exercise those two. The bean
    must implement `TransactionDependentExecutionListener` / `TransactionDependentTaskListener`; its `notify` receives the
    process instance id, the execution id, the **BPMN model element** (for a task listener the model `Task`, not the engine
    task), a copy of the execution variables taken when the listener was planned and the map built by the
    `customPropertiesResolver*` (class, expression returning a `Map`, or delegate expression). The listener is not told which
    phase it runs in, so there is one bean per phase. It runs in a transaction of its own (`REQUIRES_NEW`): on commit
    `before-commit` listeners run before and `committed` listeners after the commit, in registration order; on rollback only
    the `rolled-back` listeners run, including the ones planned by elements entered in the failed transaction. Writing the
    process from `before-commit` would contend with the transaction that is ending, hence the in-memory `transactionLog`.
    Evidence: `transaction-listeners.scenario.json`.
C13.5. **Task `delete` listeners also run when a task is cancelled** (here by an interrupting timer boundary event); `complete`
    does not run then. After a normal completion `complete` is followed by `delete`; `all` is called for every event. Evidence:
    `task-listeners.scenario.json`.
C13.6. **Event listeners: `events` and `entityType` filter, and the throwing forms work.**
    `throwEvent="signal"` signals the subscriptions of the process instance of the event, `globalSignal` all subscriptions of
    that name, `message` the message subscriptions of the instance (no correlation key), and `error` propagates the BPMN error
    from the event's execution: an error thrown on `TASK_CREATED` is caught by the boundary event of the very task being
    created. `PROCESS_COMPLETED` is still recordable into a process variable (the instance exists then). `expression` is not a
    valid event listener implementation (the parser only knows `class`, `delegateExpression` and `throwEvent`). Evidence:
    `event-listeners.scenario.json`.

## C14 mail and shell

Numbered `C14.n`.

C14.1. **Mail needs a default from address, or an explicit `from`.** `MailActivityBehavior.setFrom` uses the `from` field and
    otherwise `mailServerDefaultFrom` of the engine; with neither, `Email.setFrom(null)` fails (R1 lab: NPE). The corpus context sets
    `mailServerHost`, `mailServerPort` and `mailServerDefaultFrom` for the GreenMail server. Evidence:
    `C14-mail-shell/scenarios/mail-tasks.scenario.json` (the mails without a `from` field arrive from `noreply@corpus.test`).
C14.2. **`textVar` / `htmlVar` name a variable whose content is evaluated as an expression at send time.** The field value is the
    variable *name*, so it is an `activiti:string`; the content may contain `${...}` and is resolved against the execution. A
    start payload cannot carry such a template (the runtime rejects expressions in start variables, finding C15.1); the corpus
    stores it with a service task. A mail with `html` and `text` is `multipart/alternative`, with attachments `multipart/mixed`
    (plain text with attachments), and a `bcc` address receives its copy without a `Bcc` header. Evidence: `mail-tasks.scenario.json`.
C14.3. **`ignoreException` swallows every failure of the task** (an invalid address, a missing `to`/content, a refused connection)
    and stores the message under `exceptionVariableName`; without it the `ActivitiException` fails the call and rolls the
    transaction back. The message for a bad address is `Could not add <address> as recipient`. Evidence: `mail-errors.scenario.json`.
C14.4. **A shell task never fails on a non-zero exit code.** The code is stored as text (`"3"`) in `errorCodeVariable`, the output as
    text including the final newline in `outputVariable`; both variables are only written when `wait` is not `false` (with
    `wait=false` neither exists). `redirectError=true` merges standard error into the output, otherwise standard error is
    discarded; `cleanEnv=true` clears the environment of the process (`/usr/bin/env` then prints nothing); `directory` sets the working directory. The output is read after the process ended,
    so a command with large output can block. Evidence: `shell-tasks.scenario.json`.
C14.5. **Harness: mail projects need `harness.properties`.** The harness reads an optional `harness.properties` of a project and
    passes it to the project's Spring context; `harness.greenmail=true` switches on `MailSupportConfiguration` (docs/corpus-support.md).

## C15 data and properties

Numbered `C15.n`.

C15.1. **Property type checks are strict Java type checks on the start payload.** `integer` accepts a `java.lang.Integer` only (a JSON
    number such as `3000000000` becomes a `Long` and is rejected, text is never converted), `boolean` and `string` likewise,
    `bigdecimal` any `Number`, `date`/`datetime` a `Date` or text the `DateFormatterProvider` can parse (it converts the payload
    value first), and `json`, `file`, `folder`, `content` and `array` anything Jackson can serialize, so an `array` property accepts an
    object and a `json` property accepts plain text. A rejected start fails with `Variables fail type validation: <names>`, a
    missing required property with `Can't start process '<key>' without required variables - <names>`, and an expression in a
    payload value with `Expressions in variable values are only allowed as default value when modeling the process: <name>`.
    Evidence: `C15-data-properties/scenarios/property-types.scenario.json`.
C15.2. **An undeclared string start variable that parses as a date becomes a `Date`.** `ProcessVariablesPayloadValidator` tries
    `toDate` on every string whose name is not a declared property (`"2031-02-03"` is stored as a date; `"hello"` stays text).
    Declare the property as `string` to keep the text. Evidence: `property-types.scenario.json` (`note`, `remark`).
C15.3. **Defaults are applied in two passes.** Plain defaults of all properties are added to the payload first; defaults that contain
    an expression (or a JSON object) are then resolved against that combined map, so `"${orderId}-${count}"` sees overridden values
    and other defaults (`SO-2-9`). A property without a default creates no variable, except `json`, which creates a JSON null
    (finding 4). Defaults are typed by the property type: `bigdecimal` from text or from a number, `date` and `datetime` from text.
    Evidence: `property-types.scenario.json`.
C15.4. **Property metadata is read and kept, nothing in the 9.0.0 jars acts on it.** `description`, `displayName`, `display`,
    `analytics` and `ephemeral` reach the runtime's `VariableDefinition` (asserted through `extensionInspector`), but no runtime
    code reads `display`, `analytics` or the property-level `ephemeral`. The feature matrix also lists `category` for a
    property: `VariableDefinition` of 9.0.0 has no such field, so the exporter must not write it (ADR 0003: only fields the model
    classes know). Evidence: `property-types.scenario.json` (`meta`).
C15.5. **The start event mapping replaces the start payload.** `ProcessVariablesInitiator.calculateOutputVariables` applies the
    `outputs` of the mapping keyed by the start event id to the payload and, when that yields at least one variable, uses the
    result instead of the payload: unmapped payload variables are dropped (`name`, `junk`), a `VALUE` output is always added,
    and a `VARIABLE` output whose source is missing is skipped. (When the mapping yields nothing the payload goes through
    unchanged; read from the source, not exercised.) Defaults and validation run afterwards on the result, and the target of
    each output has to be a declared property. Evidence: `start-event-properties.scenario.json`.
C15.6. **Data objects are created before the start variables and are typed.** `xsd:int` gives an `Integer`, `xsd:long` a `Long`,
    `xsd:double` a `Double`, `xsd:boolean` a `Boolean`, `xsd:datetime` a `Date` (parsed with `yyyy-MM-dd'T'HH:mm:ss` in the
    JVM's time zone), no type a string; a data object without a value is a variable holding null; a start variable of the same
    name replaces the value; a data object of an embedded sub process is local to it (the variable `dLocal` is gone afterwards).
    Evidence: `data-objects.scenario.json`, `model-expect.json` (typed values and `type`).
C15.7. **Form key and form properties are model data only.** `activiti:initiator` is set from the authenticated user (the runner
    sets both the `SecurityContext` and `Authentication.setAuthenticatedUserId`), `activiti:formKey` and the legacy
    `activiti:formProperty` list (id, name, type, required, enum values, default) are parsed into the model and never enforced:
    a start without the "required" `customer` form property succeeds. Evidence: `start-event-properties.scenario.json`.
C15.8. **A `null` argument for a `String` parameter in an expression becomes the empty text** (`greeter.greet(execution.getVariable('missing'))`
    gives `Hello, `, not `Hello, null`): JUEL coerces `null` to `""` for String parameters.

## C19 retries and incidents

Numbered `C19.n`.

C19.1. **The number of attempts is the `R<n>` of the cycle, or 3 without one.** `JobRetryCmd` takes `times` from
    `failedJobRetryTimeCycle` at the first failure (`R2/PT10S` allows 2 attempts, `R5/PT1S` 5, `R1/PT5S` exactly 1: no retry
    at all) and the job's own retries (default 3) otherwise; a job whose retries are used up becomes a dead-letter job
    carrying the exception message of the **last** attempt, a job with retries left becomes a timer job due after the cycle's
    interval (or the default failed-job wait time). Evidence: `C19-retries-incidents/scenarios/service-retries.scenario.json`
    (the attempt number is part of the exception message, counted by `attemptCounter`).
C19.2. **A cycle on any other element is parsed and ignored.** `JobRetryCmd` reads the cycle only when the current flow element is a
    `ServiceTask`; the model keeps `failedJobRetryTimeCycleValue` for every activity (user task here), but its failed job
    gets 3 attempts. Evidence: `async-user-task.scenario.json`; `model-expect.json` shows the parsed value on the user task.
    **docs**: lint L31.
C19.3. **A synchronous failure creates no job.** It rolls back the whole API call: the start is rejected (no instance), or the
    completion of the previous user task fails and the task stays open; the state is `ACTIVE` with no dead-letter job.
    Evidence: `sync-failure.scenario.json`.
C19.4. **Scenario format limit.** `executeJobs`, `fireTimer` and `failJobUntilDeadLetter` either succeed or drive the job to the
    dead-letter table, and a failing job fails the step: "fails once, then succeeds", the intermediate retry timer and its due
    date, and reviving a dead-letter job cannot be expressed. A step that executes one job and expects its failure would close
    the gap.

## C18 collaboration

Numbered `C18.n`.

C18.1. **Artifacts must follow every flow element inside a `process`.** The BPMN XSD the engine validates against orders a process as
    `laneSet`, flow elements (including data object and data store references), then `textAnnotation` / `association`. A text
    annotation or association written before a later `sequenceFlow` fails the deployment with `XMLException:
    cvc-complex-type.2.4.a: Invalid content was found starting with element 'sequenceFlow'. One of 'artifact, resourceRole,
    correlationSubscription, supports' is expected`. The modeler's serializer emits artifacts last (bpmn-js does).
    Evidence: N01 `artifact-before-flow` (`N01EngineTest`), ValidateApiTest#anXsdViolationIsReportedWithItsLine. (On JDK 25 the message names the element as `'{"http://www.omg.org/spec/BPMN/20100524/MODEL":sequenceFlow}'`, see N01.5.)
C18.2. **Data object references, data store references and data associations leave no usable model element, so their diagram
    shapes and edges draw validator warnings.** `dataObjectReference` has no converter (nothing in the parsed process),
    `dataStoreReference` becomes a `FlowElement` that is not a `FlowNode` (log: `Could not find matching parse handler for +
    orderStore this is likely a bug`), data associations are not kept by id. `validateProcess` therefore reports
    `DI_INVALID_REFERENCE` (`could not find <id>`) for the shapes and edges of the references and associations and
    `DI_DOES_NOT_REFERENCE_FLOWNODE` for the data store reference. They are harmless (the process deploys and runs) but any diagram
    with data references hits them. `DeploymentChecks` lists exactly these two keys as expected notes, only when the named id
    is a data object reference, data store reference or data association of the same file; any other DI warning still fails
    (`ProjectVerifierTest`). Evidence: `C18-collaboration/seed/processes/collaboration.bpmn20.xml`; the notes of the validation check.
C18.3. **`dataStoreRef` and `itemSubjectRef` of a `dataStoreReference` are never read.** `DataStoreReferenceXMLConverter.convertXMLToElement`
    creates the element and parses its children but does not read the attributes; they are only written on export. The parsed
    `DataStoreReference` has `dataStoreRef == null` (name and id are kept). The modeler must keep the attribute in its own XML and
    cannot use the engine's parse to verify it. Evidence: `model-expect.json` (`orderStore.dataStoreRef: null`); bytecode of the converter.
C18.4. **Pools: one process per participant with a `processRef`; a black-box pool deploys nothing.** The three executable processes of
    the two seed files are deployed as three definitions (`customerOrder`, `supplierFulfilment`, `colouredReview`), the `Carrier`
    participant without `processRef` creates none, and a message flow to or from a pool or between pools is accepted and moves
    nothing: starting the customer pool does not start the supplier, a confirmation for another order does not reach the
    waiting catch event. Lanes (`laneSet`) are kept with their `flowReferences` and have no effect on assignment. Evidence:
    `collaboration.scenario.json`, `model-expect.json` (`lanes`, `artifacts`).
C18.5. **The colour attributes (`bioc:*`, `color:*`) on pool, lane, shape and edge elements are ignored.** The coloured model deploys without
    warnings and behaves exactly like an uncoloured one. Evidence: `coloured.scenario.json`.
C18.6. **`activiti:delegateExpression` on a `messageEventDefinition` has no property on the parsed model but is honoured at runtime.**
    `MessageEventDefinition` has only `messageRef`, `messageExpression`, `correlationKey` and `fieldExtensions`; the throw event
    nevertheless calls the delegate (`thrownMessages` is `["orderPlaced"]`), so the model-expect cannot assert the attribute and the
    scenario does. Evidence: `collaboration.scenario.json`.
C18.7. **A text annotation or association of a `collaboration` is in no process, and its diagram is an invalid reference.** `BpmnXMLConverter`
    puts the artifacts it reads outside a process into `BpmnModel.globalArtifacts`, but `BpmnModel.getArtifact`, which the diagram check of the
    validator uses, searches the processes only: the annotation's shape and the association's edge are `DI_INVALID_REFERENCE` warnings
    (`could not find <id>`). In the process of the pool they are found and nothing is reported. bpmn-js keeps every text annotation of a
    collaboration, also one drawn in a pool, and the associations to it in the collaboration, so the modeler's export writes an annotation that
    lies inside a pool with a process, and its associations, into that process (an annotation outside every pool stays where it is and draws the
    warning). Evidence: `EngineTrapsTest#anAnnotationOfACollaborationIsInNoProcessAndItsDiagramIsAnInvalidReference`; the generated
    `C18-collaboration` (its annotations are left where bpmn-js puts them) validates with no unexpected warning; `export.test.ts` in
    `bpmn-js-activiti`.

## C21 coverage extras

Numbered `C21.n`: findings of `corpus/C21-coverage-extras` and of the C01 scenarios, each derived from the sources first; each item
names the scenario or model-expect file that pins it.

C21.1. **`activiti:potentialStarter` alone does not restrict who may start: everybody can.** `PotentialStarterParser` adds `user(x)` to the
    candidate starter users, `group(y)` and a bare name to the candidate groups (spaces trimmed: `user( dora )` is `dora`), but unlike the
    `activiti:candidateStarterUsers` / `candidateStarterGroups` attributes (`ProcessParser`) it does not set `candidateStarterUsersDefined`
    / `candidateStarterGroupsDefined`. The Spring Boot `CandidateStartersDeploymentHelper` adds the group `*` (everyone) to every process
    whose starters are not "defined", and `ProcessRuntime` always includes `*` in the groups of the caller. So `potentialStarters` gets
    the identity links users `carl`, `dora`, groups `*`, `auditors`, `reviewers`, and a user in none of them starts it. With an attribute
    next to the element (`starterSources`) the starters are defined, no `*` is added, the starters are the union of both sources, and
    everybody else gets `ActivitiObjectNotFoundException: Unable to find process definition for the given id or key` (not the
    `NotFoundException` of tasks). No lint rule reports a potential starter without the attributes; the user guide page
    [Candidate starters](user-guide/properties/candidate-starters.md) says that it restricts nothing on its own. Evidence: `C21-coverage-extras/scenarios/potential-starters.scenario.json`,
    `starter-sources.scenario.json`, `model-expect.json` (`candidateStarters.groups` contains `*`).
C21.2. **`activiti:extensionId` is kept only on user tasks and service tasks, has no run-time effect, and is dropped everywhere else.**
    `UserTaskXMLConverter` and `ServiceTaskXMLConverter` read it into `extensionId`; no other converter calls
    `BpmnXMLUtil.addCustomAttributes` (only the user task does, and the attribute is on its blacklist), so on a script task, a manual task,
    a receive task, a call activity and a sub process (and by the sources every other activity) the attribute is not in the parsed model at all (`attributes` is empty) and is not written
    back by the engine's exporter (the modeler's moddle agrees: it warns `unknown attribute <activiti:extensionId>` on a script or manual task,
    so the seed carries the attribute on the two tasks only). Nothing reads `extensionId`: the extensions file (mappings, constants) is looked
    up by the element id. The feature matrix row T15 ("common to all activities, round-trip") holds for the modeler's own XML on user and
    service tasks only. Evidence: `EngineTrapsTest#extensionIdIsKeptOnUserTasksAndServiceTasksOnly` (parse and export of seven activity
    kinds), `extension-ids.scenario.json` (a mapping keyed by element id is applied), `model-expect.json` (`extensionIds`).
C21.3. **`MAP_ALL_INPUTS` and `MAP_ALL_OUTPUTS` each switch off only their own direction.** From `ExtensionsVariablesMappingProvider`:
    `MAP_ALL_INPUTS` (and `MAP_ALL`) gives the connector or the task the constants **and then `execution.getVariables()`**, so a process variable
    **overrides a constant of the same name** (with explicit inputs the constants override), it ignores the explicit `inputs`, resolves no
    expressions and its outputs are the explicit `outputs` (a completed user task without `outputs` drops its completion variables).
    `MAP_ALL_OUTPUTS` uses the explicit `inputs` (without any, only the constants arrive), ignores the explicit `outputs` and copies every outbound or completion variable, plus `sys_task_assignee` and the input-mapped variables of a user task.
    Evidence: `map-all-variants.scenario.json` (exact `expectConnectorCall.inbound`, `expectTask.localVariables`, `variables` and
    `absentVariables`), `model-expect.json` (`mapAllVariants.extensions`).
C21.4. **Any output mapping refuses a value that contains `${...}` text, and the check also hits input-mapped task variables.**
    `calculateOutPutVariables` tests the whole map of available variables with `ExpressionResolver.containsExpression` before it looks at
    the mapping type, so completing a user task (or returning from a connector) of an element that has any mapping fails with
    `ActivitiIllegalArgumentException: Expressions are not allowed as variable values in the output mapping` when a completion variable
    or an input-mapped task-local variable holds such text; the completion is rolled back and the task stays open. `TaskRuntime` itself
    accepts the text (a `comment` of `costs ${price}`), `ProcessRuntime.start` does not (`IllegalStateException: Expressions in variable
    values are only allowed as default value when modeling the process`), and `MAP_ALL_INPUTS` passes it through unresolved, so a process
    variable that came from a script with expression text makes the next `MAP_ALL_INPUTS` user task impossible to complete. Evidence:
    `expression-values.scenario.json`.
C21.5. **Multi-instance service and script tasks: only local variables are aggregated, `setVariable` and `resultVariable` are shared.**
    `MultiInstanceActivityBehavior.updateResultCollection` reads the **local** variables of the instance execution: `outputDataItem` names one
    of them, without it the item is a map of all local variables except `loopDataOutputRef`, the index variable and `nrOf*` (the
    `elementVariable` is in it). An expression or script that wants a per-instance value must use `execution.setVariableLocal`;
    `execution.setVariable(...)` and `activiti:resultVariable` write the process variable shared by all instances (sequential rounds see the
    previous round's value: `running` 2, 5, 9). The `loopDataOutputRef` variable is set to an empty list before any instance starts, so it
    exists (as `[]`) when the collection is empty. An activity with no instance has no historic activity instance (`path.contains` fails,
    `sequenceFlows` still lists the flows). `nrOfCompletedInstances` seen by instance i of a parallel loop of automatic instances is i; the
    `completionCondition` of a sequential loop stops it after the instance that satisfies it. Invalid input throws at the start:
    `Variable prices is not found`, `Variable prices' is not a Collection` (sic, a stray quote), `Invalid number of instances: must be
    non-negative integer value, but was -1`, all `ActivitiIllegalArgumentException`. Evidence: `mi-expression-tasks.scenario.json`,
    `mi-script-tasks.scenario.json`.
C21.6. **A connector inside a multi-instance keeps its outbound variables local and skips the output mapping.** `VariablesPropagator.propagate`
    sets the variables local to the instance when the parent execution is a multi-instance root; the element's `outputs` (here
    `lastTier`) are never applied, and the aggregation (`outputDataItem` `customerName`) reads the local values. `MAP_ALL_INPUTS` on such a
    task sends the process variables plus the loop variables of the instance (element, index) and the root's `nrOfInstances`,
    `nrOfCompletedInstances`, `nrOfActiveInstances`, and the already-empty `loopDataOutputRef` list. Evidence: `mi-connector-tasks.scenario.json`.
C21.7. **Moving a task: `assign` needs a candidate user, `release` runs the assignment listeners, a claimed task is private.**
    `TaskRuntime.assign` accepts only a user with a candidate-user identity link (`You cannot assign a task to ann due it is not a candidate
    for it`, though ann is in the candidate group); `release` assigns `null` and the `assignment` task listeners run with the assignee
    `null` (`assignment:claimed:null`); once claimed the task is visible to its assignee alone, not to the other candidates. Evidence:
    `C01-user-tasks/scenarios/task-claim-release-assign.scenario.json`.
C21.8. **A process whose only start event is a timer start can be started by key.** `ProcessRuntime.start` enters the timer start event like a
    none start event and does not wait for (or consume) the timer job. Evidence: `timer-start-duration.scenario.json`.
C21.9. **Without its `-extensions.json` file a process gets nothing back from its user tasks: the BPMN file alone is not enough.**
    `ProcessExtensionService.getExtensionsForId` returns an empty extension when the deployment has no extensions file for the process, and
    `ExtensionsVariablesMappingProvider.calculateOutPutVariables` returns an empty map for an element the extension has no mapping for, so
    the variables `TaskRuntime.complete` sets on the task never reach the process. An exclusive gateway after the task that reads one fails
    with `ActivitiException: Unknown property used in expression: ${approved}`, and the completion is rolled back (the task stays open).
    Variables passed to `ProcessRuntime.start` reach the process as they are. **docs**: the dialog after File > Export project as zip and the
    user guide ([Using the files in a Spring Boot application](user-guide/modeler-basics.md#using-the-files-in-a-spring-boot-application))
    say to deploy the `-extensions.json` files with the BPMN files. Evidence: `C01-user-tasks/scenarios/no-extensions-file.scenario.json`.

## C20 business projects

Numbered `C20.n`: findings of the loan, order and claims projects, which are built with the modeler's default mappings (`corpus/C20-loan`, `C20-order`, `C20-claims`).

C20.1. **`MAP_ALL` (and `MAP_ALL_INPUTS`) on a parallel multi-instance user task wedges the instance.** The task receives every variable of its execution as an
    input, and on a multi-instance instance those include the loop variables `nrOfInstances`, `nrOfActiveInstances`, `nrOfCompletedInstances`, `loopCounter` and the
    output collection (`expectTask.localVariables` of `reviewEach` lists exactly these). `VariablesPropagator.propagate` then sets the completion variables **and those
    inputs** local on the instance execution (the parent is the multi-instance root), the root's counters are shadowed and the instances never count as completed: both
    tasks can be completed, but the process instance stays active with no active activity, the flow never leaves the task and the output collection stays empty.
    A sequential multi-instance user task with `MAP_ALL` completes (cardinality 5 with a completion condition tested), a parallel and a sequential one with `MAP_ALL_OUTPUTS`
    or with no mapping complete and give the same results (the aggregate of a task without `outputDataItem` holds `sys_task_assignee` in both cases), and a multi-instance call
    activity with `MAP_ALL` completes. The completion variables of a multi-instance task are local to the instance whatever the mapping, so `MAP_ALL_OUTPUTS` loses nothing:
    it is the modeler's default for a user task that is multi-instance (ADR 0006); the lint rule `parallel-multi-instance-user-task-map-all` warns about `MAP_ALL` / `MAP_ALL_INPUTS`
    on a parallel one. Evidence: `C20-claims/scenarios/map-all-multi-instance.scenario.json` (`MAP_ALL`, set explicitly), `insurance-claim.scenario.json` (`assessClaim` with the default).
C20.2. **A signal catch event needs no mapping and a mapping on it is never applied.** The payload of a signal arrives as process variables under the names it was thrown with, with no
    mapping (`orderFulfilment`: `carrier`, `pickedUpAt`, `deliveredTo`, `deliveredAt`), and an output mapping that would rename a payload variable renames nothing (`signalMappingIgnored`:
    `carrier` arrives, `renamed` is never set). This is engine finding 37 seen from the modeler's side: the default `MAP_ALL` that ADR 0006 gave signal catch events did nothing, and was removed.
    Message catch events are different: removing their `MAP_ALL` makes the payload (and the boundary / event sub process payloads) disappear (control runs of C20-loan and C20-claims).
    Evidence: `C20-order/scenarios/order-fulfilment.scenario.json`, `signal-mapping-ignored.scenario.json`.
C20.3. **An interrupting message event sub process cannot interrupt an active multi-instance activity.** Delivering its message fails with `PersistenceException: ... Referential
    integrity constraint violation: "ACT_FK_EXE_PARENT"` (deleting an execution that still has children, while cancelling the multi-instance executions) and the delivery is rolled
    back: the message is not consumed and the review goes on. It holds for a parallel or sequential multi-instance user task, call activity and sub process, and for a
    multi-instance task inside an embedded sub process whose scope the event sub process interrupts. The same event sub process works next to a plain user task (C06), a message
    boundary event on the multi-instance task works, and so does a **non**-interrupting event sub process while the multi-instance activity is open. Related, seen while isolating it:
    `ProcessInstanceHelper.startProcessInstance` subscribes only the message event sub processes **directly under the process**, so a message start in an event sub process nested in an
    embedded sub process is never subscribed (`Message subscription ... not found`, also without any multi-instance activity); a signal or timer start in an event sub process does nothing
    or is refused (lint `no-signal-start-in-event-subprocess`); an error event sub process did not catch an error thrown inside a multi-instance service task
    (`No catching boundary event found`). Also: the engine's parser needs the XML pretty-printed around `multiInstanceLoopCharacteristics` (ADR 0003, N01 `minified-multi-instance`):
    with a minified file the event sub process executions are not even created, which looks like a different bug. Evidence: `C20-claims/scenarios/interrupt-multi-instance.scenario.json`
    (`expectFailure`), `insurance-claim.scenario.json` (`onWithdrawal`, `documentsHandler`).
C20.4. **A message boundary event on a multi-instance activity subscribes once for the whole multi-instance scope; a message catch inside a multi-instance sub process subscribes once per
    instance.** With two open instances, `ProcessRuntime.receive` finds the boundary subscription (with or without a correlation key) and cancels the activity; a message catch event inside
    a parallel multi-instance sub process fails with `Query return 2 results instead of max 1`. Lint `message-subscription-clash` reports the second case only. Evidence:
    `C20-claims/scenarios/insurance-claim.scenario.json` (the withdrawal with two open reviews).
C20.5. **A non-interrupting message event sub process starts once per instance, whatever the process does meanwhile** (the second `claimDocuments` message finds no subscription), as in
    finding 32. Evidence: `insurance-claim.scenario.json` ("a document arrives while the claim is being assessed").

## C22 imported Camunda model

Numbered `C22.n`: findings of the converted Camunda 7 model of `corpus/C22-camunda-import` (the hand-reviewed seed and what the importer generates).

C22.1. **A bean method named `notify` cannot be called from a JUEL expression.** `${recordingTaskListener.notify(task)}` as an `activiti:taskListener
    expression` fails at the first assignment with `IllegalArgumentException: Illegal use of Native Method in a JUEL Expression`: the expression
    resolver finds `Object.notify()` first. A listener that is called by an expression needs a method of another name, for example the
    harness's `${listenerRecorder.recordTask(task)}`. A Camunda model that calls `notify` converts without a change and fails when it runs.
    Evidence: `C22-camunda-import/scenarios/fulfil-order.scenario.json` ("a large order is reviewed by a manager and granted").
C22.2. **A `VALUE` input mapping with plain text is a string.** An input parameter `20` (Camunda: the text `20`) becomes `{ type: VALUE, value: "20" }`
    and the task receives the string `"20"`, not the number. Evidence: the `localVariables` of `reviewOrder` in `fulfil-order.scenario.json`.
C22.3. **A declared variable of the type `json` takes the boolean of an output mapping.** The importer cannot know the type of a variable that an
    output parameter writes and declares it `json`; the decision `true` / `false` of the review task arrives as the boolean and the gateway
    condition `${approved == true}` works. Evidence: `fulfil-order.scenario.json` (granted and refused).

## N01 negative corpus

Numbered `N01.n`: findings of the engine oracle of the negative corpus, `corpus/N01-negative/expected-engine.json`, which
`N01EngineTest` (java/verification-harness) asserts. Each outcome was derived from the sources first and then run; where a source
reading and the run disagreed, the run is what the oracle records.

N01.1. **A `##WebService` service task without `operationRef` does not fail on a missing importer; it fails on a null bean name.** The
    validator and `ServiceTaskParseHandler` look at `##WebService` only together with an `operationRef`; without one the task gets the
    default service task behaviour, which looks up a connector bean by `ServiceTask.getImplementation()`, and the converter keeps no
    implementation for `##WebService`: the start fails with `IllegalArgumentException: 'name' must not be null` (wrapped in an
    `ActivitiException`). The `CxfWSDLImporter` failure of R1 §0.1-9 needs the complete wiring (import, message, interface, operation,
    `operationRef`); such a file deploys, and the start fails with `Could not find importer for type http://schemas.xmlsoap.org/wsdl/`,
    because `WebServiceActivityBehavior.fillImporterInfo` loads the importer class when the task runs, not at deployment. R1's wording
    ("REJECTED") is right only for the run time. Evidence: `N01EngineTest` `web-service-task.bpmn20.xml` and its variant
    `[wsdl-import-and-operation]`.
N01.2. **`<camunda:taskListener>` is a working task listener.** R1 §0.2-15 says child elements are matched by local name and listener
    attributes are read without namespace; the N01 README claimed the listener of the Camunda Modeler file is silently ignored, which is
    wrong. With a bean as implementation the listener fires; with the original's class `com.example.ReviewCreated` the start fails with a
    class-not-found error. Everything else `camunda:` (assignee, candidate groups, due date, form key, initiator, input/output parameters,
    `asyncBefore`/`asyncAfter`, `resultVariable`, `historyTimeToLive`) is lost silently. Evidence: variants
    `[deployable]`, `[task-listener-is-honoured]`, `[task-listener-fires]` of `camunda-modeler.bpmn20.xml`.
N01.3. **A plain `<task>` passes the token on, so models that use one as "the wait" never wait.** The N01 files `cancel-end-without-compensation`
    and `process-end-listener-sets-variable` fail when the instance is *started* (the README said: when the task is completed),
    `message-clash` and `signal-start-in-event-sub-process` end at their start, so the two subscriptions of `docs` never coexist and the
    signal subscription cannot be looked for in a waiting instance. The engine behaviours of findings 31/32, C09.1, C13.1 and R1 §0.1-6 are
    unchanged; the oracle shows them with variants that have a user task as `work` (`message-clash [user-task-work]`,
    `signal-start-in-event-sub-process [user-task-work]`).
N01.4. **Only the first event definition of a catch event is used, and `parallelMultiple` is not read.** `IntermediateCatchEventParseHandler`
    takes `getFirst()` of the definitions; the others stay in the parsed model and do nothing. An event with a timer and a signal waits for
    the timer alone (no signal subscription), and a broadcast of the signal does not release it. A link definition on an end event is parsed
    and ignored: `EndEventParseHandler` gives a none end behaviour (no jump to the catch link event). Evidence:
    `multiple-event-definitions.bpmn20.xml`, `link-end-event.bpmn20.xml` in `N01EngineTest`.
N01.5. **The XSD message names elements with their namespace on JDK 25.** C18.1 quotes `starting with element 'sequenceFlow'`; the message of the
    `XMLException` is `starting with element '{"http://www.omg.org/spec/BPMN/20100524/MODEL":sequenceFlow}'`. Same finding, other wording;
    the oracle matches on `cvc-complex-type.2.4.a` and `sequenceFlow`.

### Validator mirror (the lint rules that claim "the engine's severity")

`ValidatorMirrorTest` takes the hand-written `bad` and `good` fixtures of the 78 lint rules that mirror a `ProcessValidator` problem key
(`modeler/packages/bpmnlint-plugin-activiti/src/rules/validator-*.ts`, exported to
`java/verification-harness/src/test/resources/validator-mirror/fixtures.json` by `scripts/export-lint-fixtures.mjs`) through the real
`RepositoryService.validateProcess` (and a trial deployment where the validator does not see it), with the engine configured as in the
harness (async executor off; for the fixtures that say the executor is on, the engine's default validator). **All 78 agree on key and
severity for every fixture; `known-mismatches.json` is empty.** Four engine behaviours decide how a mirror rule reads the model (V.1 to V.4):

V.1. **`activiti/operation-invalid-in-message-reference` (OPERATION_INVALID_IN_MESSAGE_REFERENCE, error): the fixture was not a valid document.**
    It wrote `inMessageRef` as an attribute of `<operation>`; the XSD has it as a child element, so the engine refused the file with
    `cvc-complex-type.3.2.2` before the validator ran. With `<inMessageRef>` as a child element the engine reports the key, as an error,
    but only for an operation that has an `implementationRef`: `InterfaceParser` drops the others, which are never validated. The rule
    reads the child element and skips operations without `implementationRef` (good fixture for that case).
V.2. **`activiti/message-invalid-item-ref` (MESSAGE_INVALID_ITEM_REF, error): the good fixture was refused.** `<itemDefinition id="item"/>` without
    `structureRef` is not registered by `ItemDefinitionParser`, so `<message itemRef="item">` gets MESSAGE_INVALID_ITEM_REF. The rule
    also reports an item definition without `structureRef` (new bad fixture); the good fixture has `structureRef="xsd:string"`.
V.3. **`activiti/boundary-event-invalid-event-definition` (BOUNDARY_EVENT_INVALID_EVENT_DEFINITION, error): the bad fixture drew another key.** A
    `terminateEventDefinition` is read by `TerminateEventDefinitionParser` in an end event only; inside a boundary event (or any other
    event) it is dropped, so the engine reports BOUNDARY_EVENT_NO_EVENT_DEFINITION. `engineDefinitions()` of the lint plugin drops a
    terminate definition outside an end event; `boundary-event-no-event-definition` has a fixture for the terminate case, and
    `boundary-event-invalid-event-definition` uses a `linkEventDefinition`, which is read but not allowed.
V.4. **`activiti/event-listener-invalid-implementation` (EVENT_LISTENER_INVALID_IMPLEMENTATION, error): the engine's key is EVENT_LISTENER_IMPLEMENTATION_MISSING.**
    `ActivitiEventListenerParser` sets an implementation type only for `class`, `delegateExpression` and `throwEvent`; a listener with an
    `expression` has none, so the validator takes its first branch. INVALID_IMPLEMENTATION is the validator's last branch and cannot be
    reached from XML at all (dead code). The rule was removed (a rule that can never fire misleads); `engine-keys.ts` lists the key as
    `UNREACHABLE_PROBLEM_KEYS`, and `event-listener-implementation-missing` treats an `expression` as no implementation and has a fixture
    for it.

Not mismatches, but worth knowing for the three `*-async-not-available` rules: their `good` fixture "async executor on" is only meaningful against
the engine's default validator (the starter adds the async set only when the executor is off), and the fixture without a context (state unknown)
makes no claim the engine could confirm; the test skips it.
