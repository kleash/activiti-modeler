# N01: the negative corpus of the lint

Small hand-written models for everything the lint is about: one per construct the modeler hides ([feature matrix §C](../../docs/FEATURE_MATRIX.md)), one per engine trap that a rule reports (the engine findings), a file as Camunda Modeler writes it, and a DMN 1.1 file. Each file does one thing wrong, on purpose, and nothing else: it is the oracle for the rules, the Problems panel, the quick fixes and the `activiti-lint` command.

This is not a project of the positive harness. `CorpusVerificationTest` discovers `corpus/<id>/seed/processes` (and the modeler's generated projects), and these models are *invalid on purpose* (several do not deploy), so there is no `seed/` folder here and that test never sees them. They are run by a test of their own, [`N01EngineTest`](../../java/verification-harness/src/test/java/io/github/kleash/activiti/harness/n01/N01EngineTest.java), which deploys each file in a Spring context and H2 database of its own and checks the engine outcome of [`expected-engine.json`](expected-engine.json) (below).

## Layout

- `models/<name>.bpmn20.xml`: the model. `models/<name>-extensions.json`: its extensions file, where the case needs one.
- `models/context/`: files a case needs from the rest of the project (a connector catalog, a DMN file, another process). The oracle names them per case, relative to this folder; they are laid out as in a project (`connectors/crm.json`, `processes/grade.dmn`, `processes/other.bpmn20.xml`).
- `models/legacy-discount.dmn`: the DMN 1.1 file.
- `expected-lint.json`: the hand-written oracle of the lint.
- `expected-engine.json`: the hand-written oracle of the engine: for each file the outcome, the evidence and the check that asserts it.
- `engine/`: what the engine test needs besides the models: `variants/` (hand-written variants of a model, for example one that can run), `fixed/` (what the quick fixes lead to) and `helpers/` (models deployed next to the subject: a process that waits for a signal, a caller of a decision).

```json
{ "files": {
  "<file>": {
    "expect": ["activiti/no-business-rule-task@decide", "..."],   // rule@elementId (rule alone: a problem of the file); every problem of the file, no more
    "context": ["processes/grade.dmn"],                           // files of models/context/ the case needs
    "afterFixes": []                                              // only if the file has quick fixes: what is left after applying all of them
  }
} }
```

A model without `afterFixes` offers no quick fix; with it, applying every offered fix leaves exactly those problems and the model exports through the serializer's checks. What is left is a note, except where the construct has no Activiti equivalent (`camunda-external-task` keeps its error: an external task cannot be translated).

## Who checks it

- `modeler/packages/bpmnlint-plugin-activiti/src/n01.test.ts`: `lintProject` over each case equals `expect`.
- `src/editor/n01-fixes.test.ts`: the quick fixes in a bpmn-js modeler leave `afterFixes` and the model exports.
- `src/cli.test.ts`: the `activiti-lint` command gives the same problems.
- `java/verification-harness` `N01EngineTest` (JUnit, `mvn -B -f java/pom.xml -pl activiti-scenario-runner,verification-harness -am verify`, or `-Dtest=N01EngineTest`): one dynamic test per file, named after the file, plus one per variant and per quick fix. See "The engine oracle".
- `modeler/e2e/n01.spec.ts` (Playwright): each case is dropped into the app like a user does; the Problems panel lists exactly `expect`; the fixes are clicked through the panel, the project is exported as a zip, and the exported files lint to `afterFixes` when they are imported again.

Change a rule or a model, and the oracle says which test fails. Do not regenerate the oracle from the output of the lint, nor `expected-engine.json` from the output of a run: it is derived from the engine sources and then confirmed.

## The files and what the engine does with them

"Engine" is what Activiti 9.0.0 does with the file, as `expected-engine.json` records it and `N01EngineTest` asserts it; the evidence is under the sentence: an R1 section (`docs/research/activiti-9-bpmn-support.md`), a lab run (`tNN`, R1 Appendix A) or an engine finding (`docs/engine-findings.md`). Where the outcome is "deploys", the harm is at run time or none that anything reports.

| File | Lint (rule@element) | Quick fix | Engine |
|---|---|---|---|
| `ad-hoc-sub-process.bpmn20.xml` | `activiti/no-ad-hoc-sub-process@ahp` | no fix | Deploys; the instance waits in the sub process forever: nothing activates the inner tasks. <br><sub>R1 §0.1-5, run t10</sub> |
| `artifact-before-flow.bpmn20.xml` | `activiti/artifact-before-flow-element@artifactFirst` | no fix | Deployment fails against the BPMN XSD (`XMLException`): `cvc-complex-type.2.4.a: Invalid content was found starting with element '{...MODEL}:sequenceFlow'`. <br><sub>findings C18.1</sub> |
| `auto-store-variables.bpmn20.xml` | `activiti/auto-store-variables-no-effect@calc` | no fix | Deploys; `autoStoreVariables` does nothing with the bundled script languages (the variable is not stored). <br><sub>finding 25</sub> |
| `business-rule-task.bpmn20.xml` (with `processes/grade.dmn`) | `activiti/no-business-rule-task@decide` | left: `activiti/decision-task-needs-dmn-connector@decide` | Deployment fails: a `NullPointerException` while the process is parsed (a business rule task needs an `activiti:class` and has no rules engine behind it). <br><sub>R1 §0.1-2, run t04</sub> |
| `call-activity-invalid.bpmn20.xml` | `activiti/called-element-invalid@call` | no fix | Deploys; the call fails when it is reached: no process has the key `my child`. <br><sub>R1 §4.6</sub> |
| `call-unknown-process.bpmn20.xml` (with `processes/other.bpmn20.xml`) | `activiti/called-element-unknown@call` | no fix | Deploys; the call fails when it is reached: no process deployed with key `ghostProcess`. <br><sub>R1 §4.6</sub> |
| `camunda-external-task.bpmn20.xml` | `activiti/no-camunda-extensions@work` x2, `activiti/service-task-missing-implementation@work` | left: `activiti/service-task-missing-implementation@work` | Deployment fails with `SERVICE_TASK_MISSING_IMPLEMENTATION`: external tasks do not exist in Activiti. <br><sub>R1 §0.1-1</sub> |
| `camunda-modeler.bpmn20.xml` | `activiti/missing-mapping@review`, `activiti/no-camunda-extensions@Definitions_camunda` x2, `activiti/no-camunda-extensions@approval`, `activiti/no-camunda-extensions@archive` x4, `activiti/no-camunda-extensions@notify`, `activiti/no-camunda-extensions@review` x6, `activiti/no-camunda-extensions@start` x2, `activiti/service-task-missing-implementation@archive`, `activiti/service-task-missing-implementation@notify` | left: `activiti/initiator-needs-authenticated-user@start`, `activiti/json-property-without-default@approval` | Deployment fails with `SERVICE_TASK_MISSING_IMPLEMENTATION` for `archive` and `notify` (`camunda:class`, `camunda:delegateExpression` are not read). With the two service tasks made deployable (variant `camunda-modeler-deployable`) the rest is lost without a message: the assignee, candidate group, due date, form key, initiator, input/output parameters, async flags and result variable of `camunda:` are not read, `modeler:` attributes are skipped. **Exception:** `<camunda:taskListener>` is read (child elements are matched by local name, listener attributes without namespace): it is a working task listener, and its class `com.example.ReviewCreated` fails the start (variant `camunda-modeler-listener`). <br><sub>R1 §0.1-1, §0.2-15, §5; runs t01, t03, t13d, t66</sub> |
| `cancel-end-without-compensation.bpmn20.xml` | `activiti/cancel-end-without-compensation@txCancel` | no fix | Deploys; the task before the cancel end is a plain task (a pass-through), so the start runs into the cancel end and fails with `No execution found for sub process of boundary cancel event` and rolls back. (With a wait state before it, completing that task fails the same way.) <br><sub>finding C09.1</sub> |
| `compensate-end-event.bpmn20.xml` | `activiti/no-unsupported-end-event@comp` | no fix | Deploys; the end event is a none end event, nothing is compensated. <br><sub>R1 §3.2</sub> |
| `complex-gateway.bpmn20.xml` | `bpmnlint/no-complex-gateway@route` | clean | Deploys. `ComplexGatewayXMLConverter` builds an exclusive gateway: the first flow whose condition is true is taken, the activation condition is ignored. <br><sub>R1 §0.1-4</sub> |
| `conditional-start.bpmn20.xml` | `activiti/no-unsupported-event-definition@start` | no fix | Deploys; the conditional definition is not read, the start event is a none start event. <br><sub>R1 §0.1-8</sub> |
| `connector-input-unmapped.bpmn20.xml` (with `connectors/crm.json`) | `activiti/connector-required-input-unmapped@lookup` | no fix | Deploys; the connector `crm.LOOKUP` runs without its required input `customerId`. <br><sub>R1 §6.2.4</sub> |
| `connector-unknown.bpmn20.xml` (with `connectors/crm.json`) | `activiti/connector-bean-unknown@send` | no fix | Deploys; the task fails when it is reached: `NoSuchBeanDefinitionException: No bean named 'mailer.SEND' available`. <br><sub>R1 §6.1</sub> |
| `data-object-reference.bpmn20.xml` | `activiti/di-invalid-reference@orderRef` | no fix | Deploys with the validator warning `DI_INVALID_REFERENCE`; the shape of the data object reference is dropped. <br><sub>findings C18.2</sub> |
| `decision-input-unmapped.bpmn20.xml` (with `processes/grade.dmn`) | `activiti/decision-input-unmapped@decide`, `activiti/decision-task-needs-dmn-connector@decide` | no fix | Deploys; `region` is `null` in FEEL, so the decision evaluates with a missing input (rows that read it do not match). <br><sub>ADR 0004</sub> |
| `decision-unknown.bpmn20.xml` (with `processes/grade.dmn`) | `activiti/decision-task-needs-dmn-connector@decide`, `activiti/decision-task-unknown-decision@decide` | no fix | Deploys; the decision task fails when it is reached: `'nothing' is neither a DMN resource name, a DMN definitions name nor a decision id`. <br><sub>ADR 0004</sub> |
| `escalation-boundary.bpmn20.xml` | `activiti/boundary-event-no-event-definition@late`, `activiti/no-unsupported-event-definition@late` | no fix | Deployment fails with `BOUNDARY_EVENT_NO_EVENT_DEFINITION`: the escalation definition is not parsed, so the boundary event has none. <br><sub>R1 §0.1-8, §7</sub> |
| `escalation-end-event.bpmn20.xml` | `activiti/no-unsupported-event-definition@esc` | no fix | Deploys; the end event is a none end event. <br><sub>R1 §0.1-8</sub> |
| `escalation-throw.bpmn20.xml` | `activiti/no-unsupported-event-definition@escalate` | no fix | Deploys; the escalation definition is not read, the event runs as a plain throw event and the token passes. <br><sub>R1 §0.1-8</sub> |
| `event-gateway-receive-task.bpmn20.xml` | `activiti/event-gateway-only-connected-to-intermediate-events@wait` | no fix | Deployment fails with `EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS`. <br><sub>R1 §7, §7.1 L19</sub> |
| `extensions-orphan-keys.bpmn20.xml` | `activiti/extensions-unknown-element@orphanKeys`, `activiti/extensions-unknown-process@orphanKeys` | clean | Deploys; both entries (an element that does not exist, a process that is not in the file) are never read. <br><sub>R1 §6.2.1, §6.2.4</sub> |
| `failed-job-retry-on-user-task.bpmn20.xml` | `activiti/failed-job-retry-ignored@review` | no fix | Deploys; the retry cycle `R5/PT1S` is ignored, a failed async job gets the default three attempts. <br><sub>finding C19.2</sub> |
| `groovy-script.bpmn20.xml` | `activiti/unsupported-script-format@calc` | no fix | Deploys; the task fails when it is reached: `Can't find scripting engine for 'groovy'` (no JSR-223 engine on the classpath). <br><sub>R1 §8.2, run t13b</sub> |
| `group.bpmn20.xml` | `activiti/di-invalid-reference@grp`, `activiti/no-group@grp` | clean | Deploys; the group is dropped by the converter (a `DI_INVALID_REFERENCE` warning for its shape). <br><sub>R1 §0.1-11, run t14; findings C18.2</sub> |
| `invalid-property-type.bpmn20.xml` | `activiti/property-type-invalid@badProperty` | no fix | The first process start fails with a `NullPointerException` (a property of type `number` has a default value). <br><sub>R1 §6.2.3, run t17v</sub> |
| `invalid-timer.bpmn20.xml` | `activiti/invalid-timer-value@start` | no fix | Deployment fails (`ParseException`): `Failed to parse cron expression: every hour` (the timer job of the start event cannot be created). <br><sub>R1 §8.3</sub> |
| `legacy-discount.dmn` | `activiti/dmn-legacy-version`, `activiti/dmn-output-without-name@output1` | no fix | Both engines load a DMN 1.1 file (the modeler migrates it to 1.3 when it opens it). A decision task that evaluates it fails with `output column 'output1' has no name`: the connector hands a column value to the process under the column's name. <br><sub>docs/user-guide/dmn-conventions.md; ADR 0004</sub> |
| `link-end-event.bpmn20.xml` | `activiti/no-unsupported-end-event@jump` | no fix | Deploys; the end event is a none end event: nothing jumps to the catch link event, the instance ends. <br><sub>R1 §3.2, FEATURE_MATRIX §C</sub> |
| `map-exception-delegate-expression.bpmn20.xml` | `activiti/map-exception-ignored@call` | no fix | Deploys; the exception mapping is parsed and never used: the Java exception rolls the call back instead of becoming a BPMN error. <br><sub>finding C08.6</sub> |
| `message-clash.bpmn20.xml` | `activiti/message-subscription-clash@docsBoundary`, `activiti/message-subscription-clash@docsStart` | no fix | Deploys, but `work` is a plain task (a pass-through): the instance ends at its start and the two subscriptions of `docs` never coexist. With a user task as `work` (variant `user-task-work`) both exist at once and `receive` fails with `Query return 2 results instead of max 1`. <br><sub>findings 31, 32</sub> |
| `message-field.bpmn20.xml` | `activiti/message-definition-field-ignored@say`, `activiti/message-throw-without-delegate@say` | no fix | Deploys; the field is parsed but never injected, and with no delegate the throw event sends nothing. <br><sub>finding 33; R1 §0.1-13, run t21</sub> |
| `minified-multi-instance.bpmn20.xml` | `activiti/multi-instance-minified-xml@review` | no fix | Deploys with no sequence flows (the closing tag of the task is swallowed); the instance ends at once at start, without an error. This file is minified on purpose: the closing tags follow each other on one line. <br><sub>R1 §0.2-14, ADR 0003 guarantee 2</sub> |
| `missing-mapping.bpmn20.xml` | `activiti/missing-mapping@review` | left: `activiti/user-task-map-all-copies-assignee@review` | Deploys; the task is created without task-local variables and the variables it is completed with never reach the process. <br><sub>R1 §6.2.4; finding 15</sub> |
| `multiple-event-definitions.bpmn20.xml` | `bpmnlint/single-event-definition@multi`, `bpmnlint/single-event-definition@both` | no fix | Deploys; both definitions are in the parsed model but only the first one has a behaviour: the catch event with a timer and a signal waits for the timer only, and `parallelMultiple` is not read. <br><sub>R1 §0.1-8, `IntermediateCatchEventParseHandler`</sub> |
| `process-end-listener-sets-variable.bpmn20.xml` | `activiti/process-end-listener-sets-variable@endListener` | no fix | Deploys; the instance cannot end (foreign key violation `ACT_FK_VAR_EXE`) and the call rolls back: the end listener runs after the instance was deleted. `work` is a pass-through, so it is the start that fails; with a wait state it is the completion of the last task. <br><sub>finding C13.1</sub> |
| `send-task-type-mule.bpmn20.xml` | `activiti/unsupported-service-task-type@send` | no fix | Deployment fails: the mule module is not shipped. <br><sub>R1 §0.1-9, run t31b</sub> |
| `send-task-without-mail.bpmn20.xml` | `activiti/send-task-invalid-implementation@notify` | no fix | Deployment fails with `SEND_TASK_INVALID_IMPLEMENTATION`. <br><sub>R1 §7, §7.1 L13</sub> |
| `service-task-type-camel.bpmn20.xml` | `activiti/unsupported-service-task-type@route` | no fix | Deployment fails: the camel module is not shipped. <br><sub>R1 §0.1-9, run t31</sub> |
| `service-task-type-dmn.bpmn20.xml` | `activiti/unsupported-service-task-type@decide` | no fix | Deploys; the `dmn` type has no behaviour and the task is skipped silently at run time. <br><sub>R1 §0.1-3, run t06</sub> |
| `signal-end-event.bpmn20.xml` | `activiti/no-signal-end-event@raise` | clean | Deploys; the signal end event ends like a none end event, the signal is never thrown. <br><sub>R1 §0.1-7, run t68</sub> |
| `signal-expression-catch.bpmn20.xml` | `activiti/signal-expression-catch-stale-subscription@catch` | no fix | Deploys; the catch event waits for the signal named by the variable and passes. The stale subscription of finding 29 shows only when the execution lives on: in the variant `then-user-task` a second broadcast of the name fails with `UserTask should not be signalled before complete`. <br><sub>finding 29</sub> |
| `signal-expression-with-declared-signal.bpmn20.xml` | `activiti/signal-expression-catch-stale-subscription@catch`, `activiti/signal-expression-with-declared-signal@catch`, `bpmnlint/global@Signal_go` | no fix | Deployment fails: `NullPointerException` ("Error parsing XML") because the file declares a `<signal>` next to an event named by `activiti:signalExpression`. <br><sub>finding 28</sub> |
| `signal-start-in-event-sub-process.bpmn20.xml` | `activiti/no-signal-start-in-event-subprocess@espStart` | no fix | Deploys (the validator accepts it) but the start event gets no behaviour and no subscription is created: the event sub process never starts (here `work` is a pass-through and the instance ends at once; variant `user-task-work` waits and ignores the broadcast). <br><sub>R1 §0.1-6, run t09</sub> |
| `skip-expression.bpmn20.xml` | `activiti/skip-expression-needs-enable-variable@review` | no fix | Deploys; the skip expression is ignored because `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is not set, the task is created. <br><sub>R1 §3.3; finding 6</sub> |
| `standard-loop.bpmn20.xml` | `activiti/no-standard-loop@repeat` | clean | Deploys; `standardLoopCharacteristics` is ignored and the task runs once. <br><sub>R1 §0.1-11, run t12</sub> |
| `string-plus.bpmn20.xml` | `activiti/juel-string-concatenation@catch`, `activiti/signal-expression-catch-stale-subscription@catch` | no fix | Deploys (the file declares no `<signal>`); the token fails at the event with `Cannot coerce 'go-' of class java.lang.String to class java.lang.Double`. <br><sub>finding 36</sub> |
| `timer-end-date-before-start.bpmn20.xml` | `activiti/timer-end-date-before-start@start` | no fix | Deploys; the timer job is deleted when it fires, silently: no instance is ever started. <br><sub>findings 26, 27</sub> |
| `timer-start-in-event-sub-process.bpmn20.xml` | `activiti/event-subprocess-invalid-start-event-definition@esp` | no fix | Deployment fails with `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION`. <br><sub>R1 §0.1-6, §7</sub> |
| `typed-start-in-sub-process.bpmn20.xml` | `activiti/subprocess-start-event-event-definition-not-allowed@subStart`, `bpmnlint/sub-process-blank-start-event@subStart` | no fix | Deployment fails with `SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED`. <br><sub>R1 §7</sub> |
| `undeclared-output-target.bpmn20.xml` (with `connectors/crm.json`) | `activiti/output-target-undeclared@lookup` | clean | Deploys; the output `tier` is dropped silently because `tier` is not a declared property. <br><sub>finding 16</sub> |
| `undeclared-prefix.bpmn20.xml` | `activiti/undeclared-qname-prefix@amount` | no fix | Deployment fails: the Activiti parser rejects the undeclared prefix `xsd` (`UndeclaredPrefix`). <br><sub>ADR 0003 guarantee 6</sub> |
| `web-service-task.bpmn20.xml` | `activiti/no-web-service-task@call` | no fix | Deploys (no `operationRef`, nothing for the validator to check) and the start fails with `'name' must not be null`: the default service task behaviour looks up a connector bean by an implementation name the converter did not keep for `##WebService`. With the complete wiring (variant `wsdl-import-and-operation`) it deploys and the start fails with `Could not find importer for type http://schemas.xmlsoap.org/wsdl/`: the importer class `CxfWSDLImporter` is in no Activiti 9.0.0 jar. <br><sub>R1 §0.1-9, run t47</sub> |

## The engine oracle

`expected-engine.json` maps every file of `models/` to an entry:

```json
"complex-gateway.bpmn20.xml": {
  "outcome": "DEPLOYS_AND_DEGRADES",          // one of the six below
  "details": "what the engine does, in words",
  "evidence": ["R1 §0.1-4", "run t05"],
  "check": "complex-gateway-is-exclusive",     // id of the Java check that asserts it (not for DEPLOY_ERROR)
  "deployError": { "exception": "...", "messageContains": ["..."], "problems": [{ "key": "SERVICE_TASK_MISSING_IMPLEMENTATION", "activityId": "work" }] },  // DEPLOY_ERROR only
  "context": ["processes/grade.dmn"], "helpers": ["signal-waiter.bpmn20.xml"],   // files of models/context and engine/helpers the case needs
  "variants": { "<name>": { ...the same, plus "file" (engine/variants) or "transform" (a literal text of the model that is replaced) } },
  "fixed": { "quickFix": "...", "variant": "<file of engine/fixed>", "check": "...", "details": "..." }
}
```

| Outcome | Meaning | What the test asserts |
|---|---|---|
| `DEPLOY_ERROR` | the deployment is refused | the validator problems by key and element id (exactly these), or the exception class and message fragments |
| `DEPLOYS_WITH_WARNING` | deploys; the validator reports warnings only | the warnings of `validateProcess` on the file, and that it runs |
| `DEPLOYS_AND_DEGRADES` | deploys and runs, but a construct is silently dropped or replaced | the parsed model (the definition is gone, the element is another one) and the degraded behaviour of an instance |
| `RUNTIME_ERROR` | deploys; a start, completion, signal or message throws | the exception chain, and that the call was rolled back (no instance, no history) |
| `HANGS` | the instance waits for something nothing can deliver | after a bounded drive with the manual job driver: still running, waiting at the element, no task, job, timer or subscription |
| `DEPLOYS_OK` | deploys and runs as written | what the lint warns about does not show on this model, or the entry is inert |

Nothing sleeps: the async executor is off and the manual job driver runs what is due. A model is deployed through a `DeploymentBuilder` (programmatic deployment) into its own context, with its extensions file, the context files of `expected-lint.json` and the helpers it names.

Many models use a plain `task` where a user would expect a wait state; a plain task passes the token on, so the instance ends (or fails) at its start. Where the harm only shows with a wait state, a **variant** replaces the task by a user task (`message-clash`, `signal-start-in-event-sub-process`), or adds one (`signal-expression-catch`). A variant is the file with one literal text replaced (`transform`; it must occur exactly once) or a hand-written file in `engine/variants/`.

**Quick fixes.** Each file with an `afterFixes` in `expected-lint.json` has a `fixed` entry (a test compares the two lists). Where the fix changes what the engine does, `engine/fixed/` holds the hand-written model the fix leads to (a decision task, an exclusive gateway, a throw signal and a none end, a MAP_ALL mapping, a declared output target, the translated Camunda file), and the test deploys it and runs it as intended. Where the engine cannot tell the fixed model from the original (a group, a loop, an orphan key, a camunda external task that stays an error) the entry says why there is none. The fixed files carry no diagram: they are not lint cases.

Where a reading of the sources and the run disagreed, the oracle records the run; the findings are in [engine findings](../../docs/engine-findings.md) (N01.1 to N01.5).

## Why some files list more than one problem

- `escalation-boundary`: the same definition is reported once as an unsupported definition and once with the engine's own key.
- `signal-expression-with-declared-signal`: `bpmnlint/global` reports the unused `<signal>`, which is also what the engine trips over.
- `typed-start-in-sub-process`: bpmnlint's `sub-process-blank-start-event` says the same as the engine rule, in its own words.
- `group`: the group is a construct Activiti drops, and its shape refers to an element the model does not have.
- `camunda-modeler`: one problem per `camunda:` / `modeler:` attribute and element (their count is what the file contains), plus the two service tasks that have no implementation Activiti reads, and the user task without a mapping.
