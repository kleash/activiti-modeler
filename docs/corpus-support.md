# Corpus support library

The verification harness (`java/verification-harness`) deploys and runs every corpus project. Most models need Java things
the engine cannot provide by itself: connector beans, delegates, listeners, a throw-message delegate. They live in the harness
under `io.github.kleash.activiti.harness.support` and are part of **every** project context, so a model can name them without any
setup. This page is their contract: the names a model uses, what they do and what they record. Scenarios assert the recorded
values with `expect.variables` and `expectConnectorCall`.

The seeds in `corpus/<id>/seed/processes/` and the projects the modeler generates reference the same names; keep them stable.

## Connectors

Connector beans are named `<connector>.<ACTION>` and referenced by a service task as `implementation="<connector>.<ACTION>"`.
The descriptors under a project's `connectors/` folder (`crm.json`, ...) carry the name before the dot; the modeler offers them as
templates. The runner wraps every connector bean in a recorder, which is what `expectConnectorCall` reads.

| Bean | Inbound variables | Outbound variables |
|---|---|---|
| `crm.LOOKUP` | `customerId` | `customerName` = `"Customer <id>"`, `tier` = `"gold"` when the id starts with `G-` else `"standard"`, `found` = `true`. A missing `customerId` gives only `found = false`. |
| `echo.EXECUTE` | any | Every inbound variable unchanged, plus `echoCount` = the number of inbound variables. |
| `flags.EXECUTE` | any | `ephemeral` = whether the element's mapping has `"ephemeral": true` (`IntegrationContext.hasEphemeralVariables()`), `connectorType` = the `implementation` of the service task, `clientId` = the id of the service task. |
| `failing.EXECUTE` | `reason` (default `boom`) | Never returns: throws `IllegalStateException("failing connector: <reason>")`. |
| `bpmnerror.EXECUTE` | `errorCode` (default `CONNECTOR_ERROR`) | Never returns: throws `BpmnError(errorCode, "bpmn error from connector")`. |
| `inventory.RESERVE` (C20) | `sku`, `quantity` | `reservationId` = `"RES-<sku>"`, `reservedQuantity` = the quantity, `reserved` = `true`. |
| `payment.CHARGE` (C20) | `orderId`, `amount`, `cardToken` | `paymentId` = `"PAY-<orderId>"`, `chargedAmount` = the amount. A `cardToken` of `DECLINED` never returns: it throws `BpmnError("PAYMENT_DECLINED", "the card was declined")`. |
| `shipping.CREATE` (C20) | `orderId`, `address` | `trackingNumber` = `"TRK-<orderId>"`, `labelCreated` = `true`. |

A connector's outbound variables reach the process only through the element's output mapping (`outputs`, or `"mappingType":
"MAP_ALL"`); see [engine findings](engine-findings.md).

## Delegates

| Name | Use | Behaviour |
|---|---|---|
| `io.github.kleash.activiti.harness.support.SetVariableDelegate` | `activiti:class` | Fields `variable` (name) and `value` (an expression): sets the process variable to the evaluated value. |
| `io.github.kleash.activiti.harness.support.IncrementDelegate` | `activiti:class` | Field `variable` (name): adds 1 to that process variable (missing counts as 0). |
| `io.github.kleash.activiti.harness.support.ThrowingDelegate` | `activiti:class` | Field `message` (default `boom`): throws `IllegalStateException(message)`. |
| `io.github.kleash.activiti.harness.support.BpmnErrorDelegate` | `activiti:class` | Field `errorCode` (default `DELEGATE_ERROR`): throws `BpmnError(errorCode)`. |
| `${recordingDelegate}` | `activiti:delegateExpression` | Appends the id of the service task to the list variable `delegateCalls` and sets `lastDelegate`. |
| `${setVariableDelegate}` | `activiti:delegateExpression` | A `SetVariableDelegate` bean: the same two fields, injected before every call, so one bean can be configured differently by two tasks. |
| `${greeter}` | in expressions | `greeter.greet(name)` gives `"Hello, <name>"`, `greeter.add(a, b)` gives the sum as a long. |

## Listeners

All of them record into process variables that hold a list of strings, so that a scenario can assert the order of calls with
`expect.variables`.

| Name | Kind | Records |
|---|---|---|
| `io.github.kleash.activiti.harness.support.RecordingExecutionListener` (class) or `${recordingExecutionListener}` | execution listener (activity or sequence flow) | `executionListenerCalls`: `"<event>:<element id>"` (`start:inc1`, `take:f_inc1_inc2`; for the process itself the process key). |
| `io.github.kleash.activiti.harness.support.RecordingTaskListener` (class) or `${recordingTaskListener}` | task listener | `taskListenerCalls`: `"<event>:<task definition key>"`, for `assignment` `"assignment:<key>:<assignee>"`. |
| `io.github.kleash.activiti.harness.support.FieldTaskListener` | task listener (class) | `fieldListenerCalls`: `"<tag>:<event>:<task definition key>"`; field `tag` (an expression, required), to show that `<activiti:field>` values reach task listeners. |
| `io.github.kleash.activiti.harness.support.RecordingEventListener` (class) or `${recordingEventListener}` | engine event listener (`<activiti:eventListener>`) | `eventListenerCalls`: `"<EVENT_TYPE>[:<id>]"`, the activity id for activity events, the task definition key for task events. Variable events are not recorded (they would recurse). |
| `${recordingThrowMessageDelegate}` | throw-message delegate of a `messageEventDefinition activiti:delegateExpression` (the engine's default sends nothing) | `thrownMessages` (message names); `thrownMessagePayload`, `thrownMessageCorrelationKey` and `thrownMessageBusinessKey` of the last throw when present. Returns `true`. |

## Scripts

| Name | Use | Behaviour |
|---|---|---|
| `${scriptHelper}` | beans are visible in JUEL and JavaScript script tasks | `scriptHelper.upper(text)` gives the text in upper case; `scriptHelper.fail(code)` always throws `BpmnError(code, "raised by scriptHelper")`, which is how a JUEL script raises an error event. |
| `${greeter}` | as above | see Delegates. |

Registered by `ScriptSupportConfiguration` (a separate `@Configuration` in the support package).

## Messages

| Name | Use | Behaviour |
|---|---|---|
| `io.github.kleash.activiti.harness.support.RecordingThrowMessageDelegate` (class) | `activiti:class` on a `messageEventDefinition` | The same delegate as the bean `${recordingThrowMessageDelegate}` (Listeners), instantiated by the engine. |
| `io.github.kleash.activiti.harness.support.FieldThrowMessageDelegate` | `activiti:class` on a `messageEventDefinition` | Field `tag` (an expression): appends `"<tag value, or [unset]>:<message name>"` to `fieldThrows`. The engine builds throw delegates without field declarations, so with `<activiti:field name="tag">` present the value is still `[unset]` ([engine findings](engine-findings.md) 33). Returns `true`. |

## Decisions and DMN

Every project context contains the DMN connector (`dmn-connector.EXECUTE_TABLE`, `DmnEvaluationService`, the runner's `decisions[]`
adapter `ScenarioDecisionEvaluator`) and, on the class path, the KIE module. The bean `DmnEvaluationLog` records every call of the
project's `DmnEvaluator` (decision tasks and direct `decisions[]` cases alike, with their inputs); the **DMN cross-check** replays each
distinct call on the other engine and requires the same result rows and matched rules for every decision, required decisions of a DRD
included. It runs as the check `DMN cross-check: ...` of every project that has `.dmn` files (and fails when the scenarios evaluated no
decision at all). A project that selects KIE in its `harness.properties` is replayed on Operaton, which must refuse the KIE-only
constructs with the pointer `activiti.dmn.engine=kie`; anything Operaton does accept must match.

## Per-project properties: `harness.properties`

An optional, hand-written `corpus/<id>/harness.properties` (for a folder given to `verify <dir>`: `<dir>/harness.properties` at the
project root, next to `processes/` and `scenarios/`) holds Spring properties that are merged into that project's application context and
override the harness defaults. The one in use selects the DMN engine of the KIE-only project:

```properties
# corpus/C17-dmn-drd-kie/harness.properties
activiti.dmn.engine=kie
```

Generated projects (`harness.generated.dir`) take the file from `corpus/<id>/` like the other oracles. The properties the harness
owns are rejected with a message that names them: `spring.datasource.*`, `spring.jmx.enabled`, `spring.application.name`,
`spring.activiti.history-level`, `db-history-used`, `deployment-mode`, `process-definition-location-prefix`,
`process-definition-location-suffixes`, `check-process-definitions`, `async-executor-activate` and `activiti.connectors.dir`.

## Adding support

The support is pluggable: `CorpusSupportConfiguration` scans its own package, so a `@Configuration` or `@Component` added to
`io.github.kleash.activiti.harness.support` is part of every project context without any wiring. A configuration in another
package is added with `-Dharness.extra-config=<fully.qualified.Class>[,...]`. A support configuration that only some projects
need is made conditional on a property and switched on by the project's own `harness.properties` (the GreenMail mail server of C14
does this; see "Per-project properties").

Rules for new support:

- name beans so that a model can use them verbatim, and document them in this table (the table is the contract of the seeds);
- record what happened in a process variable of type list-of-string rather than in static state, so contexts stay independent;
- keep behaviour deterministic; a support bean must not read the clock or the network.

## C08 errors-compensation and C19 retries-incidents

| Name | Use | Behaviour |
|---|---|---|
| `io.github.kleash.activiti.harness.support.FailureDelegate` | `activiti:class` | Fields (expressions, blank or null means "not requested"): `errorCode` throws a `BpmnError` with that code; otherwise `exceptionClass` throws a new instance of that `RuntimeException` (must have a `String` constructor, built from `message`); `message` (default `failure requested`). When nothing is requested the call succeeds and appends `"<task id>:passed"` to the list variable `failureDelegateCalls`. |
| `${failureDelegate}` | `activiti:delegateExpression` | A `FailureDelegate` bean (`FailureSupportConfiguration`), configured per task through `<activiti:field>`. |
| `bpmnerror.EXECUTE` | connector | See the connector table: throws `BpmnError(errorCode)`; the task using it has no normal outgoing flow. |
| `${countingFailure}` | `activiti:delegateExpression` (C19) | Fields (expressions): `failing` (boolean, default true) and `message` (default `service unavailable`). A failing call throws `IllegalStateException("<message> (attempt <n>)")`; otherwise it appends `"<task id>:passed"` to the list variable `countingFailureCalls`. `n` comes from the `attemptCounter` bean (per process instance and activity), because a failed job's transaction rolls back and no variable survives; the dead-letter job keeps the last message, so a scenario can assert the number of attempts. |
| `${countingFailureTaskListener}` | task listener, `delegateExpression` (C19) | The same for a user task (a non-service element): fields `failing`, `message`; the engine wraps the exception as `Exception while invoking TaskListener: ...`. |
| `${attemptCounter}` | bean | `next(key)` counts and returns the attempt number. |

The C08 seeds take the failure from process variables (`errorCode`, `exceptionClass`) with
`<activiti:expression>${execution.getVariable('errorCode')}</activiti:expression>` fields, so a scenario selects the failure at
start. The compensation handlers use `${recordingDelegate}` (list variable `delegateCalls`).

## C13 listeners

Configured by `ListenerSupportConfiguration`; used together with the recording listeners above.

| Name | Use | Behaviour |
|---|---|---|
| `io.github.kleash.activiti.harness.support.FieldExecutionListener` (class) or `${fieldExecutionListener}` | execution listener with `<activiti:field name="tag">` | Appends `"<tag>:<event>:<element id>"` to the list variable `fieldExecutionListenerCalls` (the process key for the process itself). |
| `${listenerRecorder}` | in `activiti:expression` listeners | `recordExecution(execution)` records like `RecordingExecutionListener`, `recordTask(task)` like `RecordingTaskListener`. An expression cannot call a method named `notify`. |
| `io.github.kleash.activiti.harness.support.EndGuardListener` (class), `${endGuard}` or `${endGuard.check(execution, '<type>')}` | **process-level** `end` execution listener | A process `end` listener runs after the instance was deleted and cannot write variables. The guard writes nothing: it throws `IllegalStateException("process end listener ran: <type>")` when the process business key is `fail-<type>` (field `type` for the class and bean forms). |
| `${transactionLog}` | transaction-dependent listeners | `entries(processInstanceId)` returns the recorded entries (`"<phase>:<element id>:<resolvedBy>"`, in order) as a list; `activiti:expression="${transactionLog.entries(execution.processInstanceId)}"` with a result variable captures them. |
| `${beforeCommitExecutionListener}`, `${committedExecutionListener}`, `${rolledBackExecutionListener}` | `onTransaction` execution listeners (`delegateExpression`) | Record their phase into `transactionLog`. |
| `${beforeCommitTaskListener}`, `${committedTaskListener}`, `${rolledBackTaskListener}` | `onTransaction` task listeners (`delegateExpression`) | Record their phase into `transactionLog`; the element id is the task definition key. |
| `io.github.kleash.activiti.harness.support.CorpusPropertiesResolver` (class), `${delegatePropertiesResolver}`, `${propertiesFactory.resolved('expression', execution)}` | `customPropertiesResolverClass` / `...DelegateExpression` / `...Expression` | Return `{ resolvedBy: "class" | "delegateExpression" | <the argument>, activity: <element id> }`; the transaction listeners put `resolvedBy` into their entry. |

## C14 mail-shell

A project context gets its own mail server when the project has a **`harness.properties`** (see "Per-project properties: `harness.properties`" above) with
`harness.greenmail=true`. `MailSupportConfiguration` (conditional on that property, in the support package) then starts a
GreenMail SMTP server on a free port of `127.0.0.1` (no authentication, users are created on delivery), sets the engine's
`mailServerHost`, `mailServerPort` and `mailServerDefaultFrom` (`noreply@corpus.test`) through a
`ProcessEngineConfigurationConfigurer`, and stops the server with the context. Projects without the property have no mail server.

| Name | Use | Behaviour |
|---|---|---|
| `${mailbox.inbox(address)}` | `activiti:expression` with a result variable | The messages in the inbox of `address`, in delivery order, as a list of maps: `subject`, `from`, `to`, `cc` (header values or `null`), `contentType` (base type of the message), `text`, `html` (first plain / html part, trimmed, or `null`), `attachments` (file names). A bcc recipient's copy has no `Bcc` header. An unknown address gives an empty list. |
| `${mailAttachments.report()}` | `attachments` field | A data source named `report.txt` (`text/plain`, content `report body`). |
| `${mailTemplates.text()}`, `${mailTemplates.html()}` | stores a template for `textVar` / `htmlVar` | Strings that still contain `${customerName}` and `${orderId}`; a start variable cannot hold them. |

The shell seeds use `echo`, `sh`, `pwd` and `/usr/bin/env` (Linux and macOS); no support code is needed.

## C15 data-properties

| Name | Use | Behaviour |
|---|---|---|
| `${extensionInspector}` | `activiti:expression="${extensionInspector.all(execution)}"` with a result variable | Returns, for every property of the running process' `-extensions.json`, a map with `type`, `required`, `hasDefault`, `description`, `displayName`, `display`, `analytics` and `ephemeral` as the runtime's reader parsed them (`DataSupportConfiguration`). |

## C18 collaboration

No new support code. The throw events use the existing `${recordingThrowMessageDelegate}` (it records the message names in `thrownMessages`,
because the engine's default delegate sends nothing and a message flow carries nothing). The harness itself treats the validator's
diagram warnings about data object references, data store references and data associations as expected notes
(`DeploymentChecks`, engine finding C18.2); a diagram warning about any other element still fails the validation check.

## C21 coverage-extras

No new support code. The seeds use the connectors `crm.LOOKUP` and `echo.EXECUTE` (the descriptors in `seed/connectors/` are copies of the ones of C02) and the JavaScript
(Nashorn) and JUEL script engines. Two things the scenarios rely on are worth knowing when writing similar ones: `echo.EXECUTE` reports in `echoCount` the number of
variables it **received**, which makes the size of a `MAP_ALL_INPUTS` inbound map observable, and a connector inside a multi-instance returns its variables to the
instance, not to the process ([engine findings](engine-findings.md) C21.6).

## C20 business projects and C17-dmn-migrated

C20-loan, C20-order, C20-claims and C17-dmn-migrated need no support code beyond the connectors above (`inventory.RESERVE`, `payment.CHARGE` and `shipping.CREATE` are new; their descriptors are
`seed/connectors/inventory.json`, `payment.json` and `shipping.json` of C20-order, next to a copy of the `crm.json` of C02, and are the project's connector catalog for the templates),
the DMN connector (`dmn-connector.EXECUTE_TABLE`, decisions `creditDecision`, `claimTriage` and `discount`) and `crm.LOOKUP`.

Things the scenarios of these projects rely on, worth knowing when writing similar ones:

- The projects are built **with the modeler's default mappings** (`createProject` without `defaultMappings`): user tasks, call activities and message catch events carry `MAP_ALL`, a multi-instance user task `MAP_ALL_OUTPUTS`, a signal catch event nothing (ADR 0006),
  connector tasks carry what their template created. `model-expect.json` asserts the entries as the engine's reader parsed them (`mappingType`, `inputs`, `outputs`, `constants`).
- A user task with `MAP_ALL` receives **every** process variable as a task-local variable, so an exact `expectTask.localVariables` lists them all (the start variables, what earlier steps
  produced, `sys_task_assignee` after an earlier user task). A child instance started by a `MAP_ALL` call activity gets the caller's variables only when the child has an extensions entry.
- A **multi-instance user task must not have `MAP_ALL`** (it wedges a parallel one); the modeler's default for it is `MAP_ALL_OUTPUTS` and `C20-claims` is built with that default. `mapAllMultiInstance` sets `MAP_ALL` explicitly
  (`api.setProperty(id, 'mapping.type', 'MAP_ALL')`) and pins the wedge; `interruptMultiInstance` pins that an interrupting message event sub process cannot interrupt a multi-instance activity (`expectFailure` on the message step).
  A signal payload needs no mapping: `C20-order` has no mapping on its signal catch events and `signalMappingIgnored` shows that an explicit one is not applied.
- The test API method `openDmn(name, xml)` (`app/src/dmnTestApi.ts`, `ModelerApi.openDmn`) opens an existing DMN file the way the DMN editor opens a tab: DMN 1.1 / 1.2 files are migrated with
  `@bpmn-io/dmn-migrate`, then imported into a dmn-js modeler; the export writes it through the portable-DMN normalizer. `C17-dmn-migrated` uses it on `corpus/N01-negative/models/legacy-discount.dmn`
  (read, never changed) and compares the result with a hand-reviewed seed.
- Process keys and message names of a project must be unique (L34); a message start name is unique across the project's definitions.

## N01 negative corpus

`corpus/N01-negative` is **not** a project of `CorpusVerificationTest`: it has no `seed/` folder, so discovery (`ProjectDiscovery.seeds`) and the modeler's generated projects never include it, and `N01EngineTest` asserts that. Its models are invalid on purpose. They are run by `N01EngineTest` (package `io.github.kleash.activiti.harness.n01`, `java/verification-harness/src/test`), which differs from the positive harness in three ways:

- **One context per file.** `ProjectContext.start(project, PROGRAMMATIC)` on a temporary project that holds the model, its `-extensions.json`, the context files of `expected-lint.json` (`processes/grade.dmn`, `processes/other.bpmn20.xml`, `connectors/crm.json`) and the helper models of its `expected-engine.json` entry. Nothing a model subscribes to, starts or declares reaches another. A deployment failure is the expected outcome of `DEPLOY_ERROR` files, not a test error.
- **No scenarios.** The oracle is `corpus/N01-negative/expected-engine.json` (format and outcomes in the README of that folder). Each entry names a check by id; the checks (`FlowChecks`, `EventChecks`, `FailureChecks`, `DataChecks`, `FixedChecks`) start instances through `RuntimeService`, `TaskRuntime` and `ProcessRuntime` and look at the parsed model, the history, the jobs and the event subscriptions.
- **No sleeping.** The async executor is off; "the instance hangs" is asserted after a bounded drive with the `ManualJobDriver` (still running, waiting at the element, no task, job, timer or subscription). Timers are fired with `JobDriver.fireTimer` / `fireStartTimer`.

The checks use the existing support beans (`crm.LOOKUP`, `${recordingDelegate}`, `${recordingTaskListener}`, `DmnEvaluationLog`, `ConnectorCallRecorder`). A bean a check needs only once, such as a delegate that throws (`mapException` variant), is registered in the test's context at run time and is not part of the support library.

`ValidatorMirrorTest` is the other test of this kind: it runs the fixtures of the modeler's validator-mirror lint rules through `RepositoryService.validateProcess` (see `docs/engine-findings.md`, "Validator mirror"). Its snapshot is regenerated with `node scripts/export-lint-fixtures.mjs`.

## System properties of the harness tests

| Property | Meaning |
|---|---|
| `corpus.dir` | Run only this folder (a project, or a folder of projects, or a seed project / the corpus root). |
| `harness.projects` | Comma separated project id prefixes (`C01,C04`). |
| `harness.deploy.modes` | `auto`, `programmatic` or both (default both). |
| `harness.generated.dir` | Where the modeler's generated projects are (default `java/verification-harness/target/corpus`). |
| `harness.extra-config` | Extra Spring configuration classes for every context. |
| `repo.root` | Repository root when the tests do not run from it. |

```
mvn -B -f java/pom.xml -pl activiti-scenario-runner,verification-harness -am verify
mvn -B -f java/pom.xml -pl activiti-scenario-runner,verification-harness -am test \
    -Dtest=CorpusVerificationTest -Dharness.projects=C01 -Dsurefire.failIfNoSpecifiedTests=false
scripts/verify-models.sh corpus --project C01
```
