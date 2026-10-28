# Scenario reference

A scenario is an executable test of a BPMN/DMN project: it starts a process instance, plays the people and events around it
(completing tasks, sending messages, firing timers) and asserts what the engine did. Scenarios are plain JSON files, so a
new model gets tests without any Java. The format is specified by [ADR 0005](../adr/0005-scenario-format.md); this page
describes every field with an example. The machine-readable definition is
[`schemas/scenario.schema.json`](../../schemas/scenario.schema.json) (JSON Schema 2020-12); put
`"$schema": "../../schemas/scenario.schema.json"` at the top of a file and editors validate and complete it.

Contents: [project layout](#project-layout) - [running scenarios](#running-scenarios) - [file](#scenario-file) -
[start](#start) - [steps](#steps) - [final expectations](#final-expectations-expect) - [value language](#value-language) -
[decision cases](#decision-cases) - [model-expect.json](#model-expectjson) - [path coverage](#path-coverage-and-exemptions) -
[behaviour you should know](#behaviour-you-should-know)

## Project layout

```
my-project/
  processes/                       what is deployed
    order.bpmn20.xml
    order-extensions.json          variable properties and mappings of the process "order"
    rules.dmn
  connectors/                      optional connector descriptors (crm.json, ...)
  scenarios/
    order.scenario.json            one or more files; the name must end in .scenario.json
    coverage-exemptions.json       optional, see "Path coverage"
  model-expect.json                optional, see "model-expect.json" (also accepted in scenarios/)
  harness.properties               optional, Spring properties for the project's context, see below
```

The repository's seed corpus uses the same layout with the models under `corpus/<id>/seed/processes/`.

## Running scenarios

In the modeler: open a `*.scenario.json` file (form and JSON views, schema check, **Run scenario** with the step report and the path on the diagram) or use **Run > Run all scenarios**; see [Running and testing from the modeler](running.md#scenarios). The modeler server runs them with the async executor on.

Without Java, from the repository root (needs JDK 25 and Maven; the first run builds the harness):

```
scripts/verify-models.sh my-project                  # one project, or a folder of projects
scripts/verify-models.sh corpus --project C01,C02    # the repository corpus, selected projects
scripts/verify-models.sh my-project --mode auto      # only the Spring auto-deployment
```

One line is printed per check; the exit status is 0 when everything passed. Every project gets its own Spring context and
its own in-memory H2 database and is deployed twice: by Spring auto-deployment and programmatically (`--mode
auto|programmatic|both`).

**`harness.properties`** (optional, next to `processes/` and `scenarios/`; for the repository corpus `corpus/<id>/harness.properties`)
holds Spring properties that are merged into the context of that project only. The usual use is the DMN engine:
`activiti.dmn.engine=kie` for a project whose decisions use business knowledge models or boxed expressions (the default is Operaton).
Properties the harness owns (database, history level, deployment mode and location, job driving) are rejected with a message that names
them. Every project that has `.dmn` files is also cross-checked: each decision it evaluated (in a process or in `decisions`) is replayed on
the other DMN engine and must give the same rows and matched rules ([corpus support](../corpus-support.md#decisions-and-dmn)).

Inside a Spring Boot application that embeds Activiti 9, add the `activiti-scenario-runner` dependency; the auto-configuration
registers the `ScenarioRunner` bean:

```java
ScenarioFile file = new ScenarioLoader().load(Path.of("scenarios/order.scenario.json"));
FileReport report = scenarioRunner.run(file);                      // one ScenarioReport per scenario inside
assertThat(report.passed()).as(report.render()).isTrue();
```

The runner needs history level `full` with `spring.activiti.db-history-used=true` and refuses to start otherwise, with a
message that says which setting to change. `FileReport` and `ScenarioReport` are JSON serializable and `render()` prints every step with `[ok]`,
`[FAIL]` or `[skip]` followed by all problems found.

## Scenario file

| Field | Type | Meaning |
|---|---|---|
| `$schema` | string | Optional editor hint. |
| `name` | string | Name of the file in reports. |
| `description` | string | Free text. |
| `users` | object | User name to the list of groups the user belongs to. Users become engine users with the role `ACTIVITI_USER` and one `GROUP_<group>` authority per group; they exist for the duration of the file. A step that names a user that is not listed fails. Without `user` a step acts as the built-in `scenario-runner` user, who has no groups. |
| `clock` | ISO instant | Fixed engine clock (`2030-01-01T09:00:00Z`), applied before every scenario and reset afterwards. The engine clock is global to the JVM, so scenarios never run concurrently. A scenario can set its own `clock`. |
| `scenarios` | array | The process scenarios (below). |
| `decisions` | array | DMN [decision cases](#decision-cases). |

```json
{
  "$schema": "../../../schemas/scenario.schema.json",
  "name": "C01 assignment forms",
  "users": { "ann": ["reviewers"], "bob": ["clerks"] },
  "clock": "2030-01-01T09:00:00Z",
  "scenarios": [ { "name": "...", "start": { "process": "assignmentForms", "user": "ann" }, "steps": [], "expect": {} } ]
}
```

A scenario has `name`, optional `description` and `clock`, `start`, `steps` and `expect`. Scenarios of a file run one after the
other; everything they query (tasks, jobs, timers, executions, history) is limited to the scenario's **instance tree**, the
root instance plus every child started by call activities, so leftovers of other scenarios cannot interfere. After a scenario
the runner deletes every instance it left active, with its jobs, and restores users and clock.

## Start

How the root process instance comes into being. Exactly one trigger:

| Field | Meaning |
|---|---|
| `process` | Process key; starts through `ProcessRuntime.start` (so the user must be a candidate starter if the process declares any). |
| `message` | Message name of a message start event (`ProcessRuntime.start` with a message payload). |
| `signal` | Signal name of a signal start event; the one new instance it creates is the root (name the process with `process` when several start). |
| `timer` | Id of a timer start event, together with `process`: the start timer job is fired (`fireTimer` semantics). |
| `businessKey` | Business key (not with `signal` or `timer`). |
| `user` | The starting user; also the default actor of the steps that name none, and the `activiti:initiator`. |
| `variables` | Start variables (plain values, no matchers). Declared properties are validated by type; undeclared variables are accepted; names that start with an underscore are rejected by `ProcessRuntime`. |
| `expectFailure` | The start itself must be rejected (see [expectFailure](#expectfailure)); the scenario then has no `steps` and no `expect`. |

```json
{ "process": "candidateStarters", "user": "dave",
  "expectFailure": { "messageContains": "Unable to find process definition" } }
```

## Steps

A step is an object with exactly one key. Steps run in order; the first failing step stops the scenario and the rest is
reported as skipped. Tasks, messages and signals go through `TaskRuntime` and `ProcessRuntime` as the acting user (so security
and visibility are exercised); the engine services are used only to read history, jobs, timers and the data the runtimes do not
expose.

### Task steps

Tasks are addressed by the **activity id** of the user task inside the scenario's instance tree. When several tasks are open at
one activity (multi-instance), `match` picks one; every given field must match.

`match`: `assignee` (value), `name` (value), `localVariables` (map; the task-local variables overlaid on the variables visible
from the task's execution, so a multi-instance element variable can be used), `index` (1-based, in creation order).

**`expectTask`** reads the open task(s) through the `TaskService` (all tasks, whoever may see them).

| Field | Meaning |
|---|---|
| `activity` | Required. Id of the user task. |
| `match` | See above. |
| `count` | Number of open tasks at the activity (`0`: none); all fields below are then checked on every one of them. |
| `name`, `description`, `owner`, `priority`, `category`, `formKey` | [Values](#value-language). The default priority is 0. |
| `assignee` | Value; `null` means unassigned. |
| `candidateUsers`, `candidateGroups` | Exact sets of candidate users / groups (identity links of type `candidate`). |
| `identityLinks` | List of `{ "type", "user" }` or `{ "type", "group" }` that must exist among the task's identity links, for example the custom links of `activiti:customResource`, or `assignee` / `owner` links. Other links are not checked. |
| `dueDate` | ISO instant, `null`, or a matcher. Under a fixed clock durations are exact. |
| `localVariables`, `partial` | Task-local variables: exact key set unless `partial` is `true`. |
| `visibleTo`, `notVisibleTo` | Users that must / must not see the task through `TaskRuntime` (assignee, owner, candidate user or member of a candidate group). |

```json
{ "expectTask": { "activity": "byCustomResource", "candidateUsers": ["ann"],
    "identityLinks": [ { "type": "supervisor", "user": "dave" }, { "type": "supervisor", "group": "managers" } ],
    "visibleTo": ["ann"], "notVisibleTo": ["dave"] } }
```

**`claim`** `{ activity, user, match? }` - `TaskRuntime.claim` as `user`.
**`release`** `{ activity, user, match? }` - `user` is the current assignee.
**`assign`** `{ activity, assignee, user, match? }` - `user` (the current assignee) hands the task to `assignee`, who must be a candidate.
**`completeTask`** `{ activity, user, variables?, match?, expectFailure? }` - completes through `TaskRuntime` as `user`, who claims
the task first unless it is already assigned to them. `variables` are task-local and reach the process only through the task's
output mapping (see [behaviour](#behaviour-you-should-know)). `expectFailure` makes a rejected completion the expected outcome.

```json
{ "completeTask": { "activity": "approve", "user": "ann", "variables": { "approved": true, "comment": "ok" } } }
```

### Events and waiting

**`message`** `{ name, correlationKey?, variables?, user?, expectFailure? }` - `ProcessRuntime.receive`: delivers a message to the single subscription with this name and correlation key; no or several subscriptions fail.
**`signal`** `{ name, variables?, user? }` - `ProcessRuntime.signal`: broadcasts to every waiting instance.
**`triggerReceiveTask`** `{ activity, variables?, match? }` - `RuntimeService.trigger` on the execution waiting at a receive task (`ProcessRuntime` has no API for it).
Exactly one execution must wait there; at a multi-instance receive task `match: { localVariables }` picks the instance by the variables its
execution sees (its element variable): `{ "triggerReceiveTask": { "activity": "pickUpEach", "match": { "localVariables": { "parcel": "p2" } } } }`.
**`expectActive`** - the activities that are active now over the instance tree (boundary events count). An array is an exact set; an
object takes `exactly`, `contains` and `notContains`.

```json
{ "expectActive": { "exactly": ["timerCatch", "messageCatch"] } }
```

**`setVariables`** `{ ... }` - sets process variables of the root instance as the starting user.

### Timers, clock and jobs

**`expectTimer`** `{ activity, count?, dueDate? }` - the timer jobs not yet fired at a timer event (a timer job of a failed async job counts for its activity). Without `count` at least one must exist. `dueDate` is that of the earliest timer; under a fixed `clock` it is exact.
**`fireTimer`** `{ activity, all? }` - makes the earliest (or `all`) timer job of a boundary, intermediate or start timer event due and executes it.
**`advanceClock`** - an ISO duration (`"PT25H"`, `"P1D"`); moves the engine clock forward.
**`executeJobs`** `{ maxRounds?, timeoutMs? }` - runs the due work of the instance tree until nothing is left: timers whose due date has passed on the engine clock, then executable (async) jobs. `maxRounds` (default 100) is a safety bound, not a way to run only one job: if jobs are still executable after that many rounds the step fails. `timeoutMs` applies in executor mode.
**`failJobUntilDeadLetter`** `{ activity, maxAttempts? }` - executes the job at the activity again and again, moving retry timers to executable, until it lands in the dead-letter table; the job must keep failing.

The runner follows `spring.activiti.async-executor-activate`: with the executor off (the harness) jobs are driven by the step; with
it on the runner waits for the executor. Override with `activiti.scenario.job-driver=MANUAL|EXECUTOR`.

### Connectors and child instances

**`expectConnectorCall`** asserts on the recording wrapper the runner puts around every `Connector` bean.

| Field | Meaning |
|---|---|
| `activity` | Required. Id of the service task. |
| `connector` | Expected implementation (the bean name, for example `crm.LOOKUP`). |
| `count` | Number of calls so far (`0`: none made yet). |
| `call` | Which call (1-based) `inbound` and `outbound` apply to; default 1. |
| `inbound`, `outbound`, `partial` | Variables of the call: the inbound variables after mapping, and what the connector returned before output mapping. Exact key set unless `partial`; `{ "$ignore": true }` accepts any value for a key. |

```json
{ "expectConnectorCall": { "activity": "echoMapped", "connector": "echo.EXECUTE", "count": 1,
    "inbound": { "greeting": "hello", "region": "EU" }, "partial": true } }
```

**`expectChildInstance`** `{ callActivity, process?, businessKey?, count?, call?, state?, startVariables?, variables?, absentVariables?, path? }` -
the process instance(s) a call activity started: `startVariables` are the first recorded values (what the child was started
with, after input mapping), `variables` the current or final ones, `state` is `ACTIVE` or `COMPLETED`, `path` as below.

## Final expectations (`expect`)

Checked after the last step, over the root instance. Everything listed must hold; all problems are reported together.

| Field | Meaning |
|---|---|
| `state` | `COMPLETED` (root ended), `ACTIVE` (running, no dead-letter job) or `DEADLETTER` (running, at least one dead-letter job). |
| `endEvents` | Exact set of end events the root instance reached. |
| `variables` | Process variables (subset), read from history so it works after the instance has ended. |
| `absentVariables` | Names that must not exist. |
| `path` | `contains` / `notContains` (activities entered, order-free), `order` (happens-before pairs `[a, b]`, meaningful along one branch), `sequenceFlows` / `notSequenceFlows` (flows taken). Read from `HistoricActivityInstance` and the engine's `SEQUENCEFLOW_TAKEN` events. |
| `deadLetterJobs` | Exactly these dead-letter jobs exist: `{ "activity", "exceptionMessageContains" }`. |

```json
"expect": {
  "state": "COMPLETED", "endEvents": ["end"],
  "variables": { "verdicts": ["approve", "reject"], "quorum": 2 },
  "absentVariables": ["verdict"],
  "path": { "order": [["reviewEach", "summarize"]], "sequenceFlows": ["f_reviewEach_summarize"] }
}
```

## Value language

Everywhere a value is expected (`variables`, `assignee`, `localVariables`, connector variables, ...):

- a **literal** means equals; numbers compare by value (`5000` equals `5000.0`), dates by instant, text exactly;
- an **object** is compared key by key with the exact key set, an **array** element by element;
- an object whose keys all start with `$` is a **matcher**, and all operators present must hold:

| Operator | Holds when |
|---|---|
| `$exists` | `true`: the key is present (even with a null value); `false`: it is absent. |
| `$type` | The value is a `string`, `number`, `integer`, `boolean`, `array`, `object`, `null` or `date`. |
| `$regex` | The Java regular expression is found anywhere in the text of the value (anchor with `^`, `$`). |
| `$gt`, `$gte`, `$lt`, `$lte` | Number or text comparison. |
| `$contains` | String: substring. Array: some element equals (or matches) the value. Object: the given entries are present. |
| `$size` | Length of an array, object or string: a number or a matcher such as `{ "$gt": 1 }`. |
| `$any` | The value equals or matches at least one alternative. |
| `$ignore` | The key exists; its value is not checked. |

Values sent to the engine (`start.variables`, `completeTask.variables`, ...) are plain: they may not contain matchers.

### expectFailure

`{ "exception": "NotFoundException", "messageContains": "..." }` on `start`, `completeTask` and `message`: the step must fail.
Both fields are checked against the exception and its causes (simple or qualified class name, message text). A step that was
expected to fail but succeeds, or fails differently, fails the scenario.

## Decision cases

`decisions` evaluate a DMN decision through the `DecisionEvaluator` of the project, without a process. The runner has no DMN dependency:
the evaluator is a port (`io.github.kleash.activiti.scenario.run.DecisionEvaluator`), and `activiti-dmn-connector` registers an adapter
over its `DmnEvaluationService` automatically when the runner is on the class path. The decision is looked up like the constant of a
decision task (file base name, DMN model name or decision id) in the newest deployment that has it. Without an evaluator the cases fail
with `No DecisionEvaluator is configured; add the DMN connector module (or provide a DecisionEvaluator bean) to run decision cases`.

```json
{ "name": "medium risk", "decision": "riskLevel", "inputs": { "amount": 5000 },
  "expect": { "result": [ { "riskLevel": "medium" } ], "matchedRules": ["Rule_medium"] } }
```

`result` lists the result rows in order (each an exact key set, values as above); `matchedRules` is the exact set of matched rule ids.

## model-expect.json

Some attributes have no observable effect in one run (`category`, candidate starters, `exclusive=false`, a business calendar
name, a custom identity link). They are asserted statically, against the `BpmnModel` the engine parsed from the deployed
resources, against the process definition's identity links and against the process extensions the runtime parsed. The file is written by hand next to `scenarios/`
([schema](../../schemas/model-expect.schema.json)):

```json
{
  "processes": {
    "candidateStarters": {
      "definition": { "category": "http://activiti.org/bpmn/corpus/C01" },
      "process": { "candidateStarterUsers": ["ann", "bob"] },
      "candidateStarters": { "users": ["ann", "bob"], "groups": ["clerks"] },
      "elements": {
        "work": { "type": "userTask", "attributes": { "assignee": "${starter}" } },
        "asyncDelegate": { "type": "serviceTask", "attributes": { "async": true, "exclusive": false } }
      }
    }
  }
}
```

- `definition`: properties of the deployed `ProcessDefinition` (`name`, `category` = the `targetNamespace`, `version`, ...).
- `process`: properties of the parsed `Process` (`candidateStarterUsers`, `executionListeners`, `dataObjects`, ...).
- `candidateStarters`: exact sets of users and groups from `RepositoryService.getIdentityLinksForProcessDefinition`. A process whose starters are
  not "defined" by the `activiti:candidateStarterUsers` / `...Groups` attributes also has the group `*` (everyone) there.
- `extensions`: what the runtime's own reader (`ProcessExtensionService`) made of the process's `-extensions.json`, so a mapping or a constant is proved to
  be understood by the engine as intended, not just present in the file:
  `properties` (key = property name; the listed properties of its definition, such as `type`, `required`, `value`), `mappings` (key = element id; the listed
  properties of the mapping: `mappingType` as `MAP_ALL`, `MAP_ALL_INPUTS`, `MAP_ALL_OUTPUTS` or `null`, `ephemeral`, `inputs` and `outputs` as name to
  `{ "type": "VARIABLE" | "VALUE" | "JSONPATCH", "value": ... }`; `{ "inputs": { "$size": 0 } }` asserts there are none) and `constants` (key = element id; the
  **exact** constants as name to value, which is where the `_activiti_dmn_table_` of a decision task is asserted). `{ "$exists": false }` as the value of a key
  asserts that the property, mapping or constants do not exist. The runner needs a `ProcessExtensionService` bean for this section (any Activiti Spring Boot
  application has one).
- `elements`: by element id (flow nodes, sequence flows, data objects, searched through sub processes). `type` is the XML element
  name (`userTask`, `serviceTask`, `boundaryEvent`, `sequenceFlow`, `eventBasedGateway`, ...); `attributes` are bean properties of
  the Activiti model class (`assignee`, `candidateUsers`, `loopCharacteristics`, `taskListeners`, `customUserIdentityLinks`, ...)
  with the aliases `async` and `exclusive`. Objects list only the properties to compare; `@class` yields the simple class name; a
  bean property that is `null` is expected with `null`; naming a property the model class does not have is reported as a problem.

## Path coverage and exemptions

Across all scenarios of a project **every flow node and every sequence flow** of every process must be visited. Anything else
fails the suite with the list of elements that were missed. Elements that cannot or need not be visited are listed with a reason
in `scenarios/coverage-exemptions.json` ([schema](../../schemas/coverage-exemptions.schema.json)):

```json
{ "exemptions": [
  { "process": "failingConnector", "element": "fcEnd", "reason": "unreachable: the failing connector never completes" } ] }
```

`process` may be omitted when the element id is unique in the project; the reason needs at least ten characters.

## Behaviour you should know

These were observed in the Activiti 9.0.0 sources and engine runs ([engine findings](../engine-findings.md)); scenarios have to
reflect them.

- **Completion variables are task-local.** They reach the process only through the task's output mapping. A task without an
  extensions mapping drops them; a mapping lists `outputs`, or uses `"mappingType": "MAP_ALL"`.
- **Every completion offers `sys_task_assignee`.** The engine adds the assignee under that name to the variables the output
  mapping can read, so an output mapping may copy it (`"completedBy": { "type": "VARIABLE", "value": "sys_task_assignee" }`), and
  `MAP_ALL` / `MAP_ALL_OUTPUTS` copy it into the process.
- **Input mappings define the task-local variables.** Without a mapping for the element a task has none; `MAP_ALL` gives it
  every process variable.
- **Failures roll back.** An exception in a synchronous step (a delegate, an expression, a gateway without a matching flow)
  rolls back the whole call, so the instance is not created or the task stays open; use `expectFailure` and then assert the
  state. An exception in an async job creates a failed job instead (`failJobUntilDeadLetter`, `expect.state: DEADLETTER`).
- **Users that cannot see a task get "not found".** Completing or claiming a task the user may not see fails with
  `NotFoundException: Unable to find task for the given id`.
- **Asynchronous signal throws are attributed through their subscription.** `activiti:async` on a throw signal creates a job that has no
  process instance; the runner still finds it for the instance whose catch event it will trigger, so `executeJobs` runs it, and it removes
  such jobs when the scenario ends ([engine findings](../engine-findings.md) 35). With a running async executor the engine's own after-commit
  hint and its acquisition thread race for the job (`JobNotFoundException` in the log), and now and then both attempts fail with an
  optimistic locking exception. `EXECUTOR` mode absorbs that: `executeJobs` makes the retry timers of the instance tree executable at once,
  moves a dead-letter job whose last failure was an optimistic locking failure back to the executable table (up to 5 times per job) and
  waits again, within `timeoutMs`. Any other failure that exhausts the retries fails the step with the job's activity and message
  (`ended as dead letter: 'flakyCall' (boom)`). Proof: `AsyncSignalStressTest` runs the async-signal scenario 200 times in a row with the
  executor on (0 failures).
- **Timers.** A repeating timer's next occurrence is planned from the engine clock: use `advanceClock` + `executeJobs` to follow a schedule and
  `fireTimer` to force a firing whatever the clock says ([engine findings](../engine-findings.md) 27). Cron expressions are evaluated in the
  JVM time zone; assert their due dates as windows (`{ "$gt": ..., "$lte": ... }`).
- **The clock is global.** `clock` and `advanceClock` change the engine clock of the whole JVM; the runner resets it after each scenario.
