# Activiti 9.0.0 BPMN reference: what the engine parses and executes

A catalog of every BPMN 2.0 feature that Activiti 9.0.0 **parses and executes**, with the exact `activiti:` spellings, the
validator problem keys and the embedding setup. The modeler emits only what this page lists as working. The lint rules, the
[feature matrix](../FEATURE_MATRIX.md) and the negative corpus N01 cite it as **R1 §n**; what running the corpus established
beyond it is in [engine findings](../engine-findings.md).

Checked on 2026-10-26 against `org.activiti:*:9.0.0` (the Alfresco repository
`https://artifacts.alfresco.com/nexus/content/repositories/activiti-releases/`).

## How to read this document

Every statement is tagged with how it was established:

- **[src]** read in the 9.0.0 source jars (`*-9.0.0-sources.jar`, downloaded from the Alfresco repository). Class names are given.
- **[run]** observed by running the real 9.0.0 engine (Spring Boot 3.5.7, JDK 25, H2) on a purpose-built test model. The runs `tNN`
  are listed in Appendix A; their models are kept as test fixtures in `modeler/packages/activiti-moddle/test/fixtures/lab/`.
- **[inferred]** conclusion drawn from the above, not directly confirmed.
- **[uncertain]** could not be confirmed; treat as a lead.

Status vocabulary used in the support tables:

| Status | Meaning |
|---|---|
| SUPPORTED | parsed, passes the validator, and has a runtime behavior |
| PARTIAL | works, with a quirk or restriction (stated in the notes) |
| PARSED-ONLY | the converter reads it into the model, but the engine does nothing with it (silent pass-through or no effect) |
| IGNORED | the converter does not read it at all; it is silently dropped (or becomes some other element) |
| REJECTED | deployment fails (XSD, validator, or parse-time exception) |
| BROKEN | deploys, but misbehaves at run time (hangs, throws) |

Source jars covered: `activiti-bpmn-model`, `activiti-bpmn-converter`, `activiti-engine`, `activiti-process-validation`,
`activiti-spring-process-extensions`, `activiti-spring-connector`, `activiti-api-process-runtime-impl`,
`activiti-spring-boot-starter`, `activiti-spring`, plus (for the API layer and security)
`activiti-api-process-runtime`, `activiti-api-task-runtime`, `activiti-api-task-runtime-impl`, `activiti-spring-security`,
`activiti-spring-security-policies`, `activiti-spring-identity`, `activiti-spring-app-process`, `activiti-connector-model`,
`activiti-expression-language`, `activiti-spring-resource-finder`, and the 9.0.0 POMs of `activiti-parent`, `activiti-core`,
`activiti-core-dependencies`, `activiti-dependencies`.

---

## 0. Key findings (read this first)

### 0.1 Things the modeler must NOT emit (silent failure or deployment failure)

1. **`camunda:` attributes are silently ignored for all "strict" attributes** [run t01, t13d]. A user task with `camunda:assignee` deploys and runs
   with **no assignee, no error**. `camunda:class` on a service task is a deployment error (`SERVICE_TASK_MISSING_IMPLEMENTATION`) [run t46].
   Only the namespace `http://activiti.org/bpmn` is honored for the attributes in section 2.3.
2. **`businessRuleTask` is a trap.** It is parsed, but with no `activiti:class` the engine throws a `NullPointerException` while parsing at
   deployment time (`DefaultActivityBehaviorFactory.createBusinessRuleTaskActivityBehavior`) [src] [run t04]. There is no Drools/DMN. Never emit it.
3. **`serviceTask activiti:type="dmn"` passes validation but has no behavior**: it deploys, and at run time the task is **silently skipped** [src] [run t06].
   (`ServiceTaskValidator` accepts `dmn`; `ServiceTaskParseHandler` only knows mail/mule/camel/shell; a null behavior means "take outgoing flows" in `ContinueProcessOperation`.)
4. **`complexGateway` is silently turned into an exclusive gateway** [src `ComplexGatewayXMLConverter`] [run t05].
5. **Ad-hoc sub process is BROKEN**: it deploys, enters a wait state with no way to start inner activities, and never completes [src `AdhocSubProcessActivityBehavior`] [run t10].
6. **Signal-start event sub processes are not implemented** (validator allows them; the engine only has behaviors for message and error start events in event sub processes) [src `StartEventParseHandler`, `ProcessInstanceHelper`] [run t09 vs t09b].
   **Timer-start event sub processes are rejected** by the validator [run t08].
7. **Signal end event does not throw the signal**: it is treated as a none end event [src `EndEventParseHandler`] [run t68].
8. **Escalation, conditional, multiple, parallel event definitions are not parsed at all.** Consequences: an intermediate throw event with
   `escalationEventDefinition` becomes a plain none throw (silent pass-through) [run t11]; a start event with `conditionalEventDefinition` becomes a none start [run t11b];
   an end event with `escalationEventDefinition` becomes a none end [run t11d]; a boundary event with an escalation definition fails validation (`BOUNDARY_EVENT_NO_EVENT_DEFINITION`) [run t11c].
9. **`camel` and `mule` service/send task types fail at deployment** (`ClassNotFoundException` wrapped in `ActivitiException`); those modules are not shipped [src] [run t31, t31b].
   **Web service tasks** (`implementation="##WebService"`) need `org.activiti.engine.impl.webservice.CxfWSDLImporter`, which is not in any 9.0.0 jar: effectively unsupported [src] [run t47].
10. **`groovy` scripts do not work out of the box** (no JSR-223 Groovy on the runtime classpath: `Can't find scripting engine for 'groovy'`) [run t13b]. JavaScript (Nashorn 15.7) and JUEL do work.
11. **`standardLoopCharacteristics`, `group`, `dataStore`/IO-spec semantics, lanes, pools, message flows, `text annotation`** carry no runtime meaning. `standardLoopCharacteristics` is ignored, so the task runs once [run t12]; `group` is dropped silently [run t14].
12. **No form engine.** `activiti:formProperty` is parsed and kept in the model, `activiti:formKey` is copied to the task, but there is no `FormService` in 9.0.0 and nothing consumes form properties [src].
13. **Message throw events (intermediate and end) do not send anything by default**: the default `ThrowMessageDelegate` is a no-op returning `true` [src `DefaultThrowMessageJavaDelegate`] [run t21]. A real send needs a custom delegate (`activiti:class` / `activiti:delegateExpression` on the `messageEventDefinition`).

### 0.2 Parser traps

14. **Whitespace bug in `multiInstanceLoopCharacteristics` parsing** [src `MultiInstanceParser`] [run t15x]: the parser unconditionally consumes **one more XML event after
    `</multiInstanceLoopCharacteristics>`**. If that event is the closing tag of the task (`</userTask>`), i.e. **minified XML without whitespace between them**, the closing tag is swallowed and every following
    flow element is absorbed into the task. The process then deploys, has no sequence flows, and **ends immediately at start, with no error**. The serializer must pretty-print (newline + indent between the loop element and the closing tag). bpmn-js `saveXML({format:true})` does this.
15. **Child elements are matched by local name only** (namespace ignored) [src `BpmnXMLUtil.parseChildElements`]. Therefore `<camunda:executionListener>`/`<camunda:taskListener>`/`<camunda:field>`/`<camunda:formProperty>` are accepted, and
    their attributes are read namespace-agnostically (see 2.3). This is an accident of the implementation; the modeler should still emit `activiti:`.
16. **Unknown XML is not an error**: unknown extension elements are preserved as generic `ExtensionElement`s; unknown attributes are preserved; unknown `*EventDefinition` children are dropped.

### 0.3 Activiti 7+ runtime layer surprises (Spring Boot starter)

17. **Variables are dropped unless the `*-extensions.json` has a mapping for the element** [src `ExtensionsVariablesMappingProvider`, `VariablesPropagator`] [run t17, t17b]:
    - service task with `implementation="bean"`: connector gets **empty inputs** and its outputs are **discarded** unless `mappings.<taskId>` exists;
    - user task: the task's local variables are **empty** (nothing is copied from the process) unless `mappings.<taskId>` has `MAP_ALL`/`MAP_ALL_INPUTS` or explicit `inputs`;
    - user task completed through `TaskRuntime` (variables are task-local, `localScope=true`): **not copied to the process** unless `mappings.<taskId>` exists;
    - call activity: variables coming back from the called process are **not propagated** unless a mapping (or explicit `activiti:out`) exists;
    - message/signal payloads delivered to a catching event: dropped unless `mappings.<catchEventId>` exists.
    Use `"mappingType": "MAP_ALL"` (or `MAP_ALL_INPUTS` / `MAP_ALL_OUTPUTS`) for "pass everything", or explicit `inputs`/`outputs`.
18. **The extension JSON must be named `*-extensions.json`, deployed in the same deployment, keyed by the process id** (`extensions.<processId>`), and mappings are keyed by **BPMN element id** [src] [run].
19. **A `UserDetailsService` bean is required** in a non-web Spring Boot app (`ActivitiSpringIdentityAutoConfiguration` needs it), and `ProcessRuntime`/`TaskRuntime` require an authenticated user with role `ACTIVITI_USER` [src] [run].
20. **`ProcessRuntime.processInstance(id)`/`variables(...)` fail with "security policies violation" for the user who started the instance**, because nothing in 9.0.0 sets the engine thread-local `Authentication.setAuthenticatedUserId(...)`, so `startUserId` and `initiator` are `null` [src] [run]. The host app must set it (see section 9.4).
21. **Unknown variable `type` in `properties` with a default value → `NullPointerException` at process start** [src `VariableParsingService`] [run t17v]. Only the types listed in 6.2.3 are valid.

### 0.4 Platform

22. **Java 25 bytecode** (class file major 69) and **Spring Boot 3.5.7** [src POMs] [run]. Embedding needs a JDK 25 runtime.
23. The process validator treats most findings as **errors that abort deployment**; only the warnings in section 7 are non-fatal.
24. `activiti:async` jobs and timers need the async executor; it is **on by default** (`spring.activiti.async-executor-activate=true`) [src `ActivitiProperties`]. If switched off, the starter adds warnings (not errors) for async flags and timer events.

---

## 1. Platform facts

| Item | Value | Evidence |
|---|---|---|
| Activiti version | 9.0.0 (all modules; sources carry "Copyright 2010-2026 Hyland Software, Inc. and its affiliates") | [src] |
| Java | **25** (`<java.version>25</java.version>`, `maven.compiler.release`; enforcer `requireJavaVersion 25`; class files major 69 verified on `activiti-engine`, `activiti-bpmn-model`, `activiti-api-process-model`, `activiti-spring-boot-starter`) | [src] `activiti-parent-9.0.0.pom`; [run] |
| Spring Boot | **3.5.7** (`<spring-boot.version>` imported as `spring-boot-dependencies` BOM in `activiti-parent`) | [src] |
| Jakarta | `jakarta.el-api` 5.0.1; Spring 6.2.12, Spring Security 6.5.x resolved with Boot 3.5.7 | [src]/[run] |
| H2 (test) | 2.4.240 in the Activiti POM; Boot BOM manages 2.3.232 | [src] |
| Nashorn (JavaScript) | `org.openjdk.nashorn:nashorn-core:15.7` as a **compile dependency of `activiti-engine`** | [src] `activiti-core-9.0.0.pom`, `activiti-engine-9.0.0.pom` |
| Groovy | `3.0.25` is only *managed*; in `activiti-engine` and `activiti-spring` it is `test` scope, in the starter `optional` -> **not on the runtime classpath** unless you add `org.codehaus.groovy:groovy` + `groovy-jsr223` | [src] |
| Expression language | **JUEL** via `org.activiti:activiti-juel-jakarta` + `jakarta.el-api` | [src] `ExpressionManager` |
| Mail | `org.apache.commons:commons-email2-jakarta` (compile dep of the engine) | [src] |
| Mapper/ORM | MyBatis, no JPA required (`hibernate-core` optional) | [src] |
| BOM | `org.activiti:activiti-dependencies:9.0.0` (type pom, scope import) resolves every module version | [run] |

Not downloaded/analysed: `activiti-image-generator`, `activiti-json-converter`, `activiti-bpmn-layout` (not relevant to execution).

---

## 2. How Activiti reads BPMN XML (rules the modeler must respect)

### 2.1 Pipeline [src]

1. `BpmnParse.execute()` -> `BpmnXMLConverter.convertToBpmnModel(...)` with **XSD validation on by default** (`BPMN20.xsd` = standard OMG Semantic/BPMNDI schemas bundled in `activiti-bpmn-converter`; `anyAttribute namespace="##other" processContents="lax"`, so any prefixed foreign attribute passes, an unprefixed unknown attribute does not).
2. `ProcessValidator` (validator set `activiti-executable-process`; plus the starter's `AsyncPropertyValidator` set when the async executor is disabled). Any non-warning problem aborts deployment with `ActivitiException("Errors while parsing: ...")`.
3. Parse handlers attach `ActivityBehavior`s to the model (`engine/impl/bpmn/parser/handler/*`, registered in `ProcessEngineConfigurationImpl.getDefaultBpmnParseHandlers()`).
4. Deployer registers process-level **timer start events** (`TimerManager`), **message start** and **signal start** subscriptions (`EventSubscriptionManager`). Only top-level start events of the process are scanned. Message start names must be unique across deployed definitions (`there already is a message event subscription ...`).
5. A non-executable process (`isExecutable="false"`) is skipped (`ProcessParseHandler`). bpmn-js writes `isExecutable="false"` by default, so **the modeler must write `isExecutable="true"`**. `Process.executable` defaults to `true` only when the attribute is absent.

Only resources whose names end in `.bpmn20.xml` or `.bpmn` are parsed as processes (`ResourceNameUtil.BPMN_RESOURCE_SUFFIXES`).

### 2.2 Namespaces

| Prefix | URI | Use |
|---|---|---|
| `bpmn2` (any prefix is fine) | `http://www.omg.org/spec/BPMN/20100524/MODEL` | BPMN model |
| `activiti` | **`http://activiti.org/bpmn`** (`BpmnXMLConstants.ACTIVITI_EXTENSIONS_NAMESPACE`) | all Activiti extensions |
| `bpmndi`, `omgdc`, `omgdi` | `.../BPMN/20100524/DI`, `.../DD/20100524/DC`, `.../DD/20100524/DI` | diagram interchange (parsed for the diagram, not needed to run) |
| `xsi` | `http://www.w3.org/2001/XMLSchema-instance` | `xsi:type="tFormalExpression"` on `conditionExpression` (optional: works without it, [run t59]) |
| default target namespace | `http://www.activiti.org/test` (written when `targetNamespace` is empty) | `targetNamespace` is stored as process definition `category`; max 255 chars |

### 2.3 Which attributes are namespace-strict and which are namespace-agnostic

The converters read attributes in two different ways [src]:

- `xtr.getAttributeValue(ACTIVITI_EXTENSIONS_NAMESPACE, name)` -> **strict**: only `activiti:name` counts. `camunda:name` or unprefixed `name` is ignored.
- `xtr.getAttributeValue(null, name)` -> with the JDK StAX (no Woodstox/Aalto on the classpath) a `null` namespace means **"match by local name in any namespace or none"**. [run t65/t66: both `activiti:event=...` and `camunda:event=...` and unprefixed `event=...` work on listeners].

**Strict (`activiti:` required)**

| Element | Attributes |
|---|---|
| any flow node / sub process | `async`, `exclusive` |
| `process` | `candidateStarterUsers`, `candidateStarterGroups` |
| `startEvent` | `initiator`, `formKey` |
| `userTask` | `assignee`, `owner`, `candidateUsers`, `candidateGroups`, `dueDate`, `businessCalendarName`, `category`, `priority`, `formKey`, `skipExpression`, `extensionId` |
| `serviceTask` | `class`, `expression`, `delegateExpression`, `resultVariableName` (alias `resultVariable`), `type`, `skipExpression`, `extensionId` |
| `scriptTask` | `resultVariable` (alias `resultVariableName`), `autoStoreVariables` |
| `sendTask` | `type` |
| `businessRuleTask` | `ruleVariablesInput`, `rules`, `resultVariable`, `class`, `exclude` |
| `callActivity` | `businessKey`, `inheritBusinessKey`, `inheritVariables` |
| `multiInstanceLoopCharacteristics` | `collection`, `elementVariable`, `elementIndexVariable` |
| `messageEventDefinition` | `messageExpression`, `correlationKey` (and any other `activiti:*` attribute, e.g. `class`, `delegateExpression`) |
| `signalEventDefinition` | `signalExpression`, `async` |
| `timerEventDefinition` | `businessCalendarName` |
| `timeCycle` | `endDate` |
| `terminateEventDefinition` | `terminateAll`, `terminateMultiInstance` |
| `signal` (definitions-level) | `scope` |

**Agnostic (`getAttributeValue(null, ...)`)**: all attributes of `executionListener`, `taskListener`, `eventListener`, `field`, `formProperty` (+ its `value`), `activiti:in`/`activiti:out`, `mapException`; and the standard BPMN attributes `isForCompensation`, `default`, `isInterrupting`, `cancelActivity`, `attachedToRef`, `triggeredByEvent`, `isSequential`, `calledElement`, `scriptFormat`, `implementation`, `operationRef`, `ordering`, `cancelRemainingInstances`, `textFormat`, `associationDirection`, `messageRef`, `signalRef`, `errorRef`, `activityRef`, `waitForCompletion`.

`skipExpression` is special: the bundled `Semantic.xsd` declares an **unprefixed** `skipExpression` on `tSequenceFlow`, `tServiceTask` and `tUserTask`. On a sequence flow the converter reads it namespace-agnostically (prefixed [run t67] and unprefixed [run t70] both work); on service/user tasks the converter reads only `activiti:skipExpression`, so an unprefixed one is XSD-valid but **silently ignored**. Always emit `activiti:skipExpression`. Any other unprefixed Activiti attribute (e.g. `assignee`) fails XSD validation: `Attribute 'assignee' is not allowed to appear in element 'userTask'` [run t71].

### 2.4 Child elements

Matched by **local name only** (generic child parser map in `BpmnXMLUtil`): `executionListener`, `taskListener`, `eventListener`, `field`, `formProperty`, `in`, `out`,
`failedJobRetryTimeCycle`, `mapException`, `multiInstanceLoopCharacteristics`, `conditionExpression`, `documentation`, `script`, `timeDate|timeCycle|timeDuration`, `linkEventDefinition`, `source`, `target`,
`ioSpecification`, `dataInputAssociation`, `dataOutputAssociation`, `dataState`, `flowNodeRef`, `humanPerformer`, `potentialOwner`, `activiti:customResource`.
A recognised element that the current parent does not accept (e.g. `activiti:field` inside a user task) is preserved as a generic extension element, not an error.

### 2.5 Serializer requirements (checklist)

1. `isExecutable="true"` on the process.
2. IDs must be valid `xsd:ID` (NCName: no spaces/colons, not starting with a digit); max 255 chars (validator).
3. Pretty-print; newline between `</multiInstanceLoopCharacteristics>` and the closing tag of the host activity (14 above).
4. XSD child order: `documentation`, `extensionElements`, `laneSet`, flow elements, **artifacts after flow elements** (`association`, `textAnnotation`) [run t33 failed XSD with an association before sequence flows].
5. Use `activiti:` for every extension attribute in section 2.3; never emit `camunda:` / `zeebe:` / `modeler:` semantic attributes (xmlns:modeler attributes on `definitions` are tolerated but meaningless).
6. Put `<activiti:...>` children inside `bpmn:extensionElements`.

---

## 3. Support matrix (element by element)

Columns: **P** parsed by the converter, **V** validator rule, **X** executed. Source classes are in the notes.

### 3.1 Definitions and process

| Element / feature | Status | Notes |
|---|---|---|
| `definitions` | SUPPORTED | `targetNamespace` (<=255) -> process definition category. `typeLanguage`, `expressionLanguage` are carried, not used (expressions are always JUEL). |
| `process` | SUPPORTED | `id` = process definition **key** (<=255), `name` (<=255), `isExecutable`, `documentation` (<=2000, becomes description). Attrs: `activiti:candidateStarterUsers`, `activiti:candidateStarterGroups`. Children: `activiti:executionListener` (events `start`,`end`), `activiti:eventListener`, `activiti:potentialStarter` (`resourceAssignmentExpression/formalExpression`, `user(x)`, `group(y)`). `ProcessParser`, `ProcessParseHandler`. |
| Multiple processes in one file | SUPPORTED | Every executable process becomes a definition; duplicate-id check only applies to processes that have a `name` (quirk in `BpmnModelValidator`). |
| `activiti:history` per process (documented in the 6.0 extension XSD) | IGNORED | Not read by the 9.0.0 converter. |
| `import`, `interface`, `operation`, `itemDefinition`, `message`(+itemRef) | PARSED-ONLY | Only relevant to the (unsupported) web service task. `message` is **needed** for message events. |
| `resource` | PARSED-ONLY | Referenced by `potentialOwner/resourceRef` -> candidate group name. |

### 3.2 Events

Event definitions are read only by the parsers in `converter/child/*`: **timer, message, signal, error, terminate, cancel, compensate, link**. All other definitions (escalation, conditional, multiple, parallel) are dropped.

| Event | Definition | Status | Details |
|---|---|---|---|
| **Start (none)** | - | SUPPORTED | `activiti:initiator` (variable name that receives the authenticated user id), `activiti:formKey`, `activiti:formProperty`. At most **one** none start per process level (V). `NoneStartEventActivityBehavior`. |
| Start | timer | SUPPORTED (process level) | `timeDate`/`timeCycle`/`timeDuration`, `activiti:endDate` on `timeCycle`. Job created at deployment (`TimerManager`) [run t20]. V rejects all definitions other than message/timer/signal. |
| Start | message | SUPPORTED (process level) | `messageRef` -> `<message name>`. Subscription at deployment; start by `RuntimeService.startProcessInstanceByMessage` or `ProcessRuntime.start(StartMessagePayload)` [run t54]. |
| Start | signal | SUPPORTED (process level) | Subscription at deployment; a signal creates a new instance [run t55]. |
| Start | error | SUPPORTED (event sub process only) | `EventSubProcessErrorStartEventActivityBehavior` [src]. |
| Start | message (event sub process) | SUPPORTED | `EventSubProcessMessageStartEventActivityBehavior`; non-interrupting (`isInterrupting="false"`) verified [run t09b], interrupting [inferred]. |
| Start | signal (event sub process) | **BROKEN** | V allows it; **no behavior** exists, no subscription is created [run t09]. Do not offer. |
| Start | timer (event sub process) | REJECTED | `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION` [run t08]. |
| Start | conditional / escalation / compensation / multiple | IGNORED | Parsed as a **none** start event [run t11b]. |
| Start inside embedded sub process | any definition | REJECTED | `SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED`; max one start event. |
| **End (none)** | - | SUPPORTED | `NoneEndEventActivityBehavior`. |
| End | error | SUPPORTED | `errorRef` -> `<error errorCode>`. `ErrorEndEventActivityBehavior`. |
| End | terminate | SUPPORTED | `activiti:terminateAll`, `activiti:terminateMultiInstance`. `TerminateEndEventActivityBehavior` [run t57]. |
| End | cancel | SUPPORTED | Only directly inside a `transaction` (V `END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION`). **Runtime quirk**: works only if the transaction has at least one completed compensable activity (compensation subscriptions); otherwise `ActivitiException: No execution found for sub process of boundary cancel event` [src `ScopeUtil`, `BoundaryCancelEventActivityBehavior`] [run t23 first variant]. |
| End | message | PARTIAL | Parsed and executed (`ThrowMessageEndEventActivityBehavior`), but the default delegate sends nothing (finding 13). |
| End | signal | **PARSED-ONLY** | Treated as none end; the signal is **not thrown** [run t68]. Use an intermediate throw signal before a none end. |
| End | escalation / compensation / link | IGNORED | Becomes a none end [run t11d]. |
| **Intermediate catch** | timer | SUPPORTED | `timeDate`, `timeDuration`; `timeCycle` is accepted but a catch event does not repeat (`TimerUtil`). |
| Intermediate catch | message | SUPPORTED | `messageRef` (or `activiti:messageExpression`), `activiti:correlationKey` (expression). Used behind an event-based gateway too. |
| Intermediate catch | signal | SUPPORTED | `signalRef` or `activiti:signalExpression` [run t37]. |
| Intermediate catch | link | SUPPORTED | `<linkEventDefinition id name><source>throwLinkDefId</source></linkEventDefinition>`; V: needs >=1 source. Jump implemented in `TakeOutgoingSequenceFlowsOperation` + `LinkThrowEventFlowNodeHelper` (same container only) [run t22]. |
| Intermediate catch | none, conditional, escalation, ... | REJECTED | `INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION`. |
| **Intermediate throw (none)** | - | SUPPORTED | Pass-through (`IntermediateThrowNoneEventActivityBehavior`). |
| Intermediate throw | signal | SUPPORTED | `signalRef`/`signalExpression`; `<signal activiti:scope="global|processInstance">`; `activiti:async="true"` on the definition needs the async executor. |
| Intermediate throw | compensate | SUPPORTED | `activityRef` (optional), `waitForCompletion` (default true) [run t33]. |
| Intermediate throw | message | PARTIAL | finding 13. |
| Intermediate throw | link | SUPPORTED | V: needs a `<target>`. |
| Intermediate throw | escalation etc. | IGNORED | **Silently a none throw** [run t11]. |
| **Boundary** | timer | SUPPORTED | Interrupting or `cancelActivity="false"`; `timeDuration`/`timeDate`/`timeCycle` (ISO repeat or cron) [run t52]. |
| Boundary | error | SUPPORTED | Always interrupting (`cancelActivity` forced to false by the converter and executed as error catch). `errorRef` optional: **without errorRef it catches every error** [run t69]. Catches `BpmnError` and `activiti:mapException` mapped exceptions. |
| Boundary | message | SUPPORTED | Interrupting or non-interrupting; two message boundaries with the same messageRef on one activity are rejected [run t56]. |
| Boundary | signal | SUPPORTED | Interrupting or non-interrupting [run t56]. |
| Boundary | cancel | SUPPORTED | Only on `transaction`; max one per transaction (V). See cancel end quirk. |
| Boundary | compensate | SUPPORTED | Max one per activity (V); handler linked with `association` (+ `isForCompensation="true"` on the handler) [run t33]. |
| Boundary | conditional / escalation | REJECTED | `BOUNDARY_EVENT_NO_EVENT_DEFINITION` [run t11c]. |

Event-level extension: `activiti:executionListener` (events `start`/`end` on flow nodes), `activiti:failedJobRetryTimeCycle`/`activiti:mapException` apply to activities only.

### 3.3 Tasks

| Task | Status | Attributes / children | Runtime behavior (source class) |
|---|---|---|---|
| `task` (abstract) | SUPPORTED | - | Pass-through (`TaskActivityBehavior`) [run t44]. |
| `manualTask` | SUPPORTED | - | Pass-through (`ManualTaskActivityBehavior`). |
| `userTask` | SUPPORTED | see 4.2 | Creates a task; in the starter `MappingAwareUserTaskBehavior` (task-local variables come from the extension-JSON mapping only, see 6.2.4; with the plain engine `copyVariablesToLocalForTasks=true` copies all variables). Name and `documentation` (becomes description) are JUEL-evaluated. `dueDate` accepts an expression returning `Date` or an ISO date/duration string (`P1D`). `priority`, `category`, `formKey` are expression-evaluated. Assignment: `assignee`, `owner`, `candidateUsers`, `candidateGroups`, also standard `humanPerformer` / `potentialOwner` with `user(x)`, `group(y)` syntax [run t58]. `skipExpression` honored only if process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is `true` (`SkipExpressionUtil`) [run t40]. |
| `serviceTask` + `activiti:class` | SUPPORTED | `activiti:field` children (injected into `Expression` fields or setters) | `ClassDelegate`; JavaDelegate or ActivityBehavior [run t26c]. |
| `serviceTask` + `activiti:expression` | SUPPORTED | `activiti:resultVariableName` | `ServiceTaskExpressionActivityBehavior` [run t26]. |
| `serviceTask` + `activiti:delegateExpression` | SUPPORTED | fields | Resolves bean to `JavaDelegate`, `ActivityBehavior`, or `DelegateExecutionFunction` [run t26b]. `resultVariableName` with class/delegateExpression is a V error. |
| `serviceTask implementation="beanName"` | SUPPORTED (Activiti 7 connector) | extension JSON mappings | Delegates to `${defaultServiceTaskBehavior}` -> `DefaultServiceTaskBehavior` -> Spring bean **named exactly `implementation`**, type `org.activiti.api.process.runtime.connector.Connector` [src] [run t17]. See section 6.1. |
| `serviceTask activiti:type="mail"` | SUPPORTED | fields `to`, `from`, `cc`, `bcc`, `subject`, `text`/`textVar`, `html`/`htmlVar`, `charset`, `ignoreException`, `exceptionVariableName`, `attachments` | `MailActivityBehavior` (commons-email). Needs `spring.activiti.mail-server-*` **and a default from address** (`mail-server-default-from`) or an explicit `from` field: otherwise `NullPointerException` in `setFrom` [run t29]. With `ignoreException=true` the failure text goes to `exceptionVariableName`. V: needs `to` and one of text/html/textVar/htmlVar. |
| `serviceTask activiti:type="shell"` | SUPPORTED | fields `command`, `arg1..arg5`, `wait`, `redirectError`, `cleanEnv`, `outputVariable`, `errorCodeVariable`, `directory` | `ShellActivityBehavior` [run t30]. Executes OS commands: security-sensitive. |
| `serviceTask activiti:type="dmn"` | **PARSED-ONLY** | field `decisionTableReferenceKey` | No behavior: silently skipped [run t06]. |
| `serviceTask activiti:type="camel"|"mule"` | REJECTED | - | Class not found at deployment [run t31, t31b]. |
| `serviceTask` other `activiti:type` | REJECTED | - | `SERVICE_TASK_INVALID_TYPE` [run t07]. |
| `serviceTask implementation="##WebService"` | REJECTED/unsupported | `operationRef` | needs `CxfWSDLImporter` (absent) [src] [run t47]. |
| `serviceTask` with none of class/expression/delegateExpression/type/implementation | REJECTED | - | `SERVICE_TASK_MISSING_IMPLEMENTATION`. |
| `scriptTask` | SUPPORTED | `scriptFormat` (default **`juel`**), `<script>` text, `activiti:resultVariable`, `activiti:autoStoreVariables` | `ScriptTaskActivityBehavior`; engines in 8.2. `autoStoreVariables=true` did **not** persist a `var z = 99;` assignment with Nashorn [run t13f] [uncertain semantics]. Empty script is a V error. |
| `sendTask` | PARTIAL | `activiti:type="mail"` (+ mail fields), or `##WebService` | Only **mail** works. Without `type`, V `SEND_TASK_INVALID_IMPLEMENTATION` [run t16]; `mule`/`camel` fail at deployment. [run t29b] |
| `receiveTask` | SUPPORTED | - | Wait state, resumed by `RuntimeService.trigger(executionId)` (not exposed by `ProcessRuntime`) [run t45]. |
| `businessRuleTask` | **REJECTED** (NPE) | `activiti:class`, `rules`, `ruleVariablesInput`, `resultVariable`, `exclude` | Only works if `activiti:class` names a user-written `BusinessRuleTaskDelegate`; there is no built-in engine [src] [run t04]. |
| `callActivity` | SUPPORTED | see 4.6 | `MappingAwareCallActivityBehavior` in the starter; `calledElement` may be a **process key** or a `${expression}` [run t48]. No `calledElementBinding/Version`, no case/DMN call. |

All activities additionally accept: `activiti:async` / `activiti:exclusive`, `isForCompensation`, `default`, `activiti:executionListener`, `multiInstanceLoopCharacteristics`, `activiti:failedJobRetryTimeCycle`, `activiti:mapException`, `documentation`.

### 3.4 Gateways

| Gateway | Status | Notes |
|---|---|---|
| `exclusiveGateway` | SUPPORTED | `default` attribute; conditions are JUEL boolean expressions. V: >=1 outgoing; a single outgoing flow must be unconditional; default flow must not carry a condition; warning if >1 outgoing flows and some non-default flow has no condition [run t49]. |
| `parallelGateway` | SUPPORTED | fork/join. |
| `inclusiveGateway` | SUPPORTED | `default` supported; join waits for active branches [run t43]. |
| `eventBasedGateway` | SUPPORTED | Outgoing targets must be `intermediateCatchEvent` (V; `receiveTask` is rejected) [run t24]. |
| `complexGateway` | **IGNORED -> exclusive** | `ComplexGatewayXMLConverter` builds an `ExclusiveGateway` [run t05]. |

### 3.5 Sub processes and call activity

| Element | Status | Notes |
|---|---|---|
| `subProcess` (embedded) | SUPPORTED | Max one none start event; `activiti:async` allowed; may be multi-instance [run t61, t62]. Local data objects become variables. |
| `subProcess triggeredByEvent="true"` (event sub process) | PARTIAL | start event must be error, message, or signal (V), but **only error and message work** (finding 6). `isInterrupting` on the start event. |
| `transaction` | PARTIAL | `TransactionActivityBehavior` extends the sub process behavior. Cancel needs compensable inner work (3.2). `activiti:async` is not written for transactions. |
| `adHocSubProcess` | **BROKEN** | `ordering`, `cancelRemainingInstances`, `completionCondition` are read; behavior only sets scope and stops (no activation mechanism) [run t10]. |
| `callActivity` | SUPPORTED | `activiti:inheritVariables`, `activiti:inheritBusinessKey`, `activiti:businessKey`, `activiti:in`/`activiti:out`. In the starter, the extension-JSON mapping for the call activity id is **also** applied (inputs: `calculateInboundVariables`; outputs when the child ends). |

### 3.6 Multi-instance and loops

`multiInstanceLoopCharacteristics` on `userTask`, `serviceTask`, `scriptTask`, `sendTask`, `manualTask`, `task`, `receiveTask`, `callActivity`, `subProcess`, `transaction`:

| Feature | XML | Notes |
|---|---|---|
| sequential / parallel | `isSequential="true|false"` (default false = parallel) | `SequentialMultiInstanceBehavior`, `ParallelMultiInstanceBehavior` |
| cardinality | `<loopCardinality>${n}</loopCardinality>` | takes precedence over a collection (`resolveNrOfInstances`) |
| collection | `activiti:collection="varName"` or `activiti:collection="${expr}"` (anything containing `{` is treated as an expression), alt. `<loopDataInputRef>` | must resolve to a `java.util.Collection` |
| element variable | `activiti:elementVariable="person"` or `<inputDataItem name="person"/>` | task-local variable |
| index variable | `activiti:elementIndexVariable="idx"` | default name **`loopCounter`** |
| completion condition | `<completionCondition>${nrOfCompletedInstances &gt;= 1}</completionCondition>` | must evaluate to Boolean; `nrOfInstances`, `nrOfActiveInstances`, `nrOfCompletedInstances` available |
| output collection | `<loopDataOutputRef>`, `<outputDataItem name="x"/>` | aggregated into a variable named by `loopDataOutputRef` |
| V rule | needs `loopCardinality` **or** `collection` | `MULTI_INSTANCE_MISSING_COLLECTION` (not applied to the multi-instance sub process itself) |
| `standardLoopCharacteristics` | - | IGNORED: single execution [run t12] |

Reminder: serializer must not emit the closing host tag immediately after `</multiInstanceLoopCharacteristics>` (14).

### 3.7 Flows and conditions

| Feature | Status | Notes |
|---|---|---|
| `sequenceFlow` | SUPPORTED | `sourceRef`, `targetRef`, `name`; `activiti:executionListener` (event `take` implied when `event` is absent; `start`/`end`/`take` are all fired when the flow is taken). Must connect two nodes in the **same container** (V). |
| `conditionExpression` | SUPPORTED | JUEL text (`${...}`), must be a parsable JUEL value expression (V). `xsi:type` optional [run t59]. The `language` attribute is ignored. |
| Leaving a node (`TakeOutgoingSequenceFlowsOperation.leaveFlowNode`, `ConditionUtil.hasTrueCondition`) | SUPPORTED | Applies to **every** flow node, not only gateways: all outgoing flows whose condition is empty or true are taken (several => implicit parallel split); the `default` flow is used only when no other flow qualifies; if flows exist but none qualifies and there is no default: `ActivitiException: No outgoing sequence flow of element 'x' could be selected`; a node with **no** outgoing flow simply ends its execution (implicit end). Exclusive gateways use `ExclusiveGatewayActivityBehavior` with the same rules, first true flow wins. |
| `activiti:skipExpression` on a flow | PARTIAL | Prefixed [run t67] or unprefixed [run t70] attribute. Honored only when process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is `true`; then the expression decides whether the **condition is skipped** (flow taken unconditionally) [src `leaveFlowNode`]. |
| `default` | SUPPORTED | on exclusive/inclusive gateways and activities. |
| `messageFlow` | PARSED-ONLY | |

### 3.8 Collaboration, pools, lanes

| Feature | Status | Notes |
|---|---|---|
| `collaboration` / `participant` / `messageFlow` | PARSED-ONLY | Deploys and runs [run t51]; each executable `process` is deployed separately; no cross-pool messaging semantics. |
| `laneSet` / `lane` / `flowNodeRef` | PARSED-ONLY | No effect on assignment or execution [run t50]. `laneSet` must precede flow elements (XSD). |

### 3.9 Data

| Feature | Status | Notes |
|---|---|---|
| `dataObject` (process or sub process level) | SUPPORTED | Becomes a process/sub-process **variable at start** (`ProcessInstanceHelper`, `SubProcessActivityBehavior`, `CallActivityBehavior`) [run t32]. Name required (V). Type via `itemSubjectRef`: **`xsd:string`, `xsd:int`, `xsd:long`, `xsd:double`, `xsd:boolean`, `xsd:datetime`** (any prefix, local part matched). Value in `<extensionElements><activiti:value>...</activiti:value></extensionElements>`; datetime format `yyyy-MM-dd'T'HH:mm:ss`. Unknown type -> error logged and the data object is dropped. Missing type -> string. |
| `dataStore`, `dataStoreReference`, `dataState` | PARSED-ONLY | |
| `ioSpecification`, `dataInput/Output`, `dataInputAssociation/OutputAssociation` | PARSED-ONLY | Used only by the web service behavior. V: association needs `targetRef`. |

### 3.10 Artifacts

| Feature | Status | Notes |
|---|---|---|
| `textAnnotation` (+ `text`, `textFormat`) | PARSED-ONLY | |
| `association` | PARSED-ONLY (but **needed** to attach compensation handlers) | `sourceRef`/`targetRef` required (V); `associationDirection` None/One/Both. |
| `group` | IGNORED | no converter [run t14]. |

---

## 4. `activiti:` extension reference (exact spellings)

Namespace `http://activiti.org/bpmn`, prefix `activiti`.

### 4.1 Any flow node / sub process / activity

| Attribute / child | Values | Notes |
|---|---|---|
| `activiti:async` | `true`/`false` | job before executing the node; async executor must be active (default on). `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE` warning when disabled. |
| `activiti:exclusive` | `false` only matters (default true) | only written/read together with `async`. |
| `isForCompensation` (standard, unprefixed) | `true` | on compensation handlers. |
| `<activiti:executionListener event="start|end" class|expression|delegateExpression onTransaction customPropertiesResolver*>` | see 4.7 | on flow nodes `start`,`end`; on sequence flows `take` (and `start`/`end` are fired too); on process `start`,`end`. |
| `<activiti:failedJobRetryTimeCycle>R5/PT7M</...>` | ISO repeat | activities only. |
| `<activiti:mapException errorCode="E" includeChildExceptions="true|false">fully.qualified.Exception</...>` | | maps a thrown Java exception to a BPMN error; `errorCode` required. Activities only. |
| arbitrary other `<ns:x>` | | kept as extension element, no effect. |

### 4.2 `userTask`

Attributes (all `activiti:`): `assignee`, `owner`, `candidateUsers` (comma list or expression), `candidateGroups` (comma list or expression), `dueDate`, `businessCalendarName`, `category`, `priority`, `formKey`, `skipExpression`, `extensionId`.
Children: `<activiti:taskListener event="create|assignment|complete|delete|all" class|expression|delegateExpression onTransaction customPropertiesResolver*>` (+ `<activiti:field>`), `<activiti:formProperty .../>` (parsed, unused), `<activiti:customResource name="x"><resourceAssignmentExpression><formalExpression>user(a), group(b)</formalExpression>...</activiti:customResource>` (custom identity links), standard `humanPerformer`/`potentialOwner`.
`TaskListener` events constants: `create`, `assignment`, `complete`, `delete`, `all` (`BaseTaskListener`). Transaction-dependent listeners (`onTransaction`): `before-commit`, `committed`, `rolled-back`, only with `delegateExpression`.
Name/description/dueDate/priority/category/formKey are evaluated as JUEL.

### 4.3 `serviceTask`

`activiti:class | activiti:expression | activiti:delegateExpression | implementation="beanName" (standard attr)`, `activiti:resultVariableName` (or `activiti:resultVariable`), `activiti:type`, `activiti:skipExpression`, `activiti:extensionId`.
Children: `<activiti:field name="x"><activiti:string>v</activiti:string></activiti:field>` or `<activiti:field name="x"><activiti:expression>${v}</activiti:expression></activiti:field>`, or attribute forms `stringValue="..."` / `expression="..."` on `activiti:field`.
Precedence in the converter: class > expression > delegateExpression > `##WebService` > plain `implementation`; `activiti:type` (if set) wins in the parse handler.

### 4.4 `scriptTask`

`scriptFormat` (standard), `<script>`, `activiti:resultVariable`, `activiti:autoStoreVariables`.

### 4.5 `sendTask`

`activiti:type="mail"` + `<activiti:field>` (as mail task).

### 4.6 `callActivity`

`calledElement` (standard; process key or `${expr}`), `activiti:businessKey` (expression), `activiti:inheritBusinessKey`, `activiti:inheritVariables`,
`<activiti:in source="x" target="y"/>`, `<activiti:in sourceExpression="${...}" target="y"/>`, `<activiti:out source="y" target="outY"/>`, `<activiti:out sourceExpression="${...}" target="outY"/>`.
An `in`/`out` without target, or without both source and sourceExpression, is dropped. `sourceExpression` wins over `source`. [run t25: `in` x->y and `out` y->outY work]

### 4.7 Listeners

```xml
<activiti:executionListener event="start" class="com.acme.L"/>
<activiti:executionListener event="end" expression="${execution.setVariable('a',1)}"/>
<activiti:executionListener event="take" delegateExpression="${myListener}" onTransaction="committed"/>
<activiti:taskListener event="create" class="com.acme.TL"><activiti:field name="f"><activiti:string>v</activiti:string></activiti:field></activiti:taskListener>
```
Attributes: `event`, one of `class`/`expression`/`delegateExpression`, `onTransaction` (`before-commit|committed|rolled-back`; not with `expression`), `customPropertiesResolverClass|Expression|DelegateExpression`. `<activiti:field>` children allowed on listeners.
The script listener classes (`ScriptExecutionListener`, `ScriptTaskListener`) exist in the engine but **cannot be declared in XML** (no parser).

### 4.8 Process-level event listeners (engine events)

```xml
<extensionElements>
  <activiti:eventListener events="PROCESS_COMPLETED,TASK_CREATED" entityType="task" class="..."/>
  <activiti:eventListener delegateExpression="${bean}"/>
  <activiti:eventListener throwEvent="signal" signalName="s"/>      <!-- also globalSignal, message (messageName), error (errorCode) -->
</extensionElements>
```
`events` = comma list of `ActivitiEventType` names; `entityType` in `attachment|comment|execution|identity-link|job|process-definition|process-instance|task`. Anything else is rejected (V `EVENT_LISTENER_*`).

### 4.9 Events

| Where | Attribute |
|---|---|
| `startEvent` | `activiti:initiator`, `activiti:formKey`, `<activiti:formProperty>` |
| `messageEventDefinition` | `activiti:correlationKey` (expression), `activiti:messageExpression` (expression), `<activiti:field>` (message payload fields), `activiti:class` / `activiti:delegateExpression` (custom `ThrowMessageDelegate` for throw events) |
| `signalEventDefinition` | `activiti:signalExpression`, `activiti:async` (throw only) |
| `signal` (definitions) | `activiti:scope="global|processInstance"` (V: other values rejected) |
| `timerEventDefinition` | `activiti:businessCalendarName` |
| `timeCycle` | `activiti:endDate` |
| `terminateEventDefinition` | `activiti:terminateAll`, `activiti:terminateMultiInstance` |

### 4.10 Data object value

`<dataObject id name itemSubjectRef="xsd:string"><extensionElements><activiti:value>x</activiti:value></extensionElements></dataObject>`

### 4.11 Form properties (parsed, no consumer)

`<activiti:formProperty id name type variable expression default datePattern required readable writable><activiti:value id name/></activiti:formProperty>` on `userTask` / `startEvent`.

### 4.12 Attributes/elements from the old extension XSD that 9.0.0 does NOT read

`activiti:history`, `activiti:formHandlerClass`, `activiti:collection` on `activiti:in`, `activiti:businessCalendarName` as an element, `activiti:type="external"` etc. (`activiti-bpmn-extensions-6.0.xsd` in the converter jar is documentation only; it is not used to validate.)

---

## 5. Camunda -> Activiti translation table (for import/migration and for porting bpmn.io features)

| Camunda | Activiti 9 | Comment |
|---|---|---|
| `camunda:assignee`, `candidateUsers`, `candidateGroups`, `dueDate`, `priority`, `formKey` | same names in `activiti:` | strict namespace [run t01] |
| `camunda:followUpDate`, `camunda:formData`/`formField`, `camunda:formRef` | none | use `activiti:formProperty` (no consumer) or app-level forms via `formKey` |
| `camunda:class` / `delegateExpression` / `expression` | `activiti:class` / `activiti:delegateExpression` / `activiti:expression` | |
| `camunda:resultVariable` (service) | `activiti:resultVariableName` (alias `resultVariable` also read) | |
| `camunda:resultVariable` (script) | `activiti:resultVariable` | |
| `camunda:type="external"` + `camunda:topic` | none (no external tasks) | use a connector bean |
| `camunda:asyncBefore`, `asyncAfter` | `activiti:async="true"` (async before) | no `asyncAfter` |
| `camunda:exclusive` | `activiti:exclusive` | |
| `camunda:jobPriority`, `historyTimeToLive`, `versionTag`, `taskPriority` | none | |
| `camunda:failedJobRetryTimeCycle` | `<activiti:failedJobRetryTimeCycle>` | |
| `camunda:inputOutput` (`inputParameter`/`outputParameter`) | **extension JSON** `mappings.<elementId>.inputs/outputs` | see 6.2 |
| `camunda:in`/`out` (call activity) | `activiti:in`/`activiti:out` with `source`/`sourceExpression`/`target`; `variables="all"` -> `activiti:inheritVariables="true"`; `businessKey` -> `activiti:businessKey` | `calledElementBinding/Version/Tenant` have no equivalent |
| `camunda:collection`, `elementVariable` | `activiti:collection`, `activiti:elementVariable` (+ `activiti:elementIndexVariable`) | |
| `camunda:executionListener` / `taskListener` | `activiti:executionListener` / `activiti:taskListener` | Camunda `timeout` task listener and `camunda:script` listeners: none |
| `camunda:field` (+ `camunda:string`/`camunda:expression`) | `activiti:field` (+ `activiti:string`/`activiti:expression`) | on service/send tasks, listeners, message definitions only |
| `camunda:initiator` | `activiti:initiator` | requires `Authentication.setAuthenticatedUserId` in the host (finding 20) |
| `camunda:candidateStarterGroups/Users` | `activiti:candidateStarterGroups/Users` | |
| `camunda:decisionRef` (business rule) | none | use a connector service task (see [ADR 0004](../adr/0004-dmn-execution.md)) |
| `camunda:properties` | arbitrary `activiti:` extension elements (no semantics) | |
| `bpmn:conditionExpression language="..."` (script condition) | JUEL only | |
| `bpmn:escalationEventDefinition`, conditional events, signal-start event sub process, signal end event | none | see section 0.1 |
| Message correlation by business key | `activiti:correlationKey` on `messageEventDefinition` + `ProcessRuntime.receive(ReceiveMessagePayload)` | |

---

## 6. Activiti 7+ runtime layer

### 6.1 Service task `implementation` -> `Connector` beans [src] [run t17]

- BPMN: `<serviceTask id="svc" name="My Svc" implementation="myConnector"/>` (the `implementation` attribute is the plain BPMN attribute, **no namespace**).
- Parse: `ServiceTaskXMLConverter` stores it as `implementation` with no type; `ServiceTaskValidator` accepts it (non-empty implementation).
- Execution: `DefaultActivityBehaviorFactory.createDefaultServiceTaskBehavior` builds a delegate-expression behavior on `${defaultServiceTaskBehavior}`. That bean (`ConnectorsAutoConfiguration` in `activiti-api-process-runtime-impl`) is `DefaultServiceTaskBehavior`, which does
  `applicationContext.getBean(implementation, Connector.class)`, builds an `IntegrationContext` (`IntegrationContextBuilder`), applies the connector `Function<IntegrationContext,IntegrationContext>`, then propagates `getOutBoundVariables()` through the `VariablesPropagator` (output mapping).
- Bean name must equal `implementation` exactly. There is **no deployment-time check** that the bean exists: a missing bean fails at run time with `NoSuchBeanDefinitionException`.
- Values the connector sees: `IntegrationContext.getClientName()` = the service task **name** (JUEL-evaluated), `getClientId()` = the BPMN element id (`currentActivityId`), `getClientType()` = `"ServiceTask"`, `getConnectorType()` = the `implementation` string, plus process ids/keys/business key/app version. [run: `clientName=My Svc connectorType=testConnector`]
- `activiti:field`s on such a task are ignored by the default behavior.
- `ConnectorDefinition` JSON files (`classpath:/connectors/*.json`, property `activiti.connectors.dir`, `activiti-spring-connector` `ConnectorDefinitionService`) are only **descriptors** (id, name, description, `actions{ id, name, description, inputs[], outputs[] }` with `VariableDefinition`s). The engine only validates that each has a non-empty unique `name` **without a `.`**. They are not used to execute anything. The `.` restriction suggests `implementation = "<connectorName>.<actionName>"` as a bean name convention used by the Alfresco modeling tools [inferred]; see [ADR 0004](../adr/0004-dmn-execution.md) for `dmn-connector.EXECUTE_TABLE`.

### 6.2 `*-extensions.json` (process extensions)

#### 6.2.1 Discovery and naming [src]

- Resource name must end with **`-extensions.json`** (`ProcessExtensionResourceReader.getResourceNameSelector`).
- Auto-discovery: `classpath*:**/processes/**-extensions.json` by default. Properties: `spring.activiti.process-definition-location-prefix` (default `classpath*:**/processes/`; also the default for the extension prefix), `spring.activiti.process.extensions.dir` (alternate prefix), `spring.activiti.process.extensions.suffix` (default `**-extensions.json`), `spring.activiti.check-process-definitions` (default `true`; set `false` to skip classpath discovery, for programmatic deployments).
- The file is loaded **from the deployment** (`DeploymentResourceLoader`): deploy it **in the same `Deployment` as the BPMN** (`addInputStream("x-extensions.json", ...)`); the Spring auto-deployment does this because both finders feed the same resource array. [run: programmatic deployment with both resources works]
- Lookup key: `ProcessExtensionModel.extensions.get(processDefinition.getKey())`, i.e. **the BPMN `process/@id`**. A file may contain several processes.
- Jackson settings: `ACCEPT_CASE_INSENSITIVE_ENUMS`; unknown properties are tolerated when the Spring Boot `ObjectMapper` is used (it is, with `spring-web` on the classpath) [run t17u]. Do not rely on a plain `new ObjectMapper()` (it would fail on unknown properties).

#### 6.2.2 Schema (model classes in `org.activiti.spring.process.model`)

```jsonc
{
  "id": "any-string",                          // ProcessExtensionModel.id (not used)
  "extensions": {
    "<processId>": {                           // Extension
      "properties": {                          // Map<String, VariableDefinition>, key = property uuid (free)
        "<uuid>": {
          "id": "<uuid>", "name": "approved", "type": "boolean",
          "required": false, "value": true,    // default value (parsed per type)
          "description": "", "display": true, "displayName": "", "analytics": false, "ephemeral": false
        }
      },
      "mappings": {                            // Map<String, ProcessVariablesMapping>, key = BPMN ELEMENT ID
        "<elementId>": {
          "mappingType": "MAP_ALL | MAP_ALL_INPUTS | MAP_ALL_OUTPUTS",   // optional
          "ephemeral": false,
          "inputs":  { "<targetName>":  { "type": "VARIABLE | VALUE", "value": <name-or-literal> } },
          "outputs": { "<processVar>":  { "type": "VARIABLE | VALUE | JSONPATCH", "value": <name-or-literal-or-patch> } }
        }
      },
      "constants": {                           // Map<String, ProcessConstantsMapping>, key = BPMN ELEMENT ID
        "<elementId>": { "<name>": { "value": <any> } }
      },
      "templates": {                           // TemplatesDefinition (read, not used by the runtime in these jars)
        "default": { "assignee": {"type":"VARIABLE|FILE","value":"..","from":"..","subject":".."}, "candidate": {...}, "emailNotificationEnabled": true },
        "tasks":   { "<userTaskId>": { "assignee": {...}, "candidate": {...}, "emailNotificationEnabled": true } }
      },
      "assignments": {                         // Map<String, AssignmentDefinition> (read, not used by the runtime in these jars)
        "<id>": { "id": "<id>", "assignment": "assignee|candidates", "type": "static|identity|expression", "mode": "sequential|manual" }
      }
    }
  }
}
```

Enum values: `MappingType` {`MAP_ALL`, `MAP_ALL_INPUTS`, `MAP_ALL_OUTPUTS`}; `Mapping.SourceMappingType` {`VARIABLE`, `VALUE`, `JSONPATCH`}; `TemplateType` {`VARIABLE`, `FILE`}; `AssignmentEnum` {`ASSIGNEE`, `CANDIDATES`}; `AssignmentType` {`STATIC`, `IDENTITY`, `EXPRESSION`}; `AssignmentMode` {`SEQUENTIAL`, `MANUAL`} (case-insensitive when read).
`templates` and `assignments` are deserialized but **no class in the analysed 9.0.0 jars consumes them** (consumers live outside these modules) [src]. Safe to omit; safe to round-trip.
`VariableDefinition` fields come from `activiti-connector-model` plus `value`.

#### 6.2.3 Variable types (`variableTypeMap` in `ProcessExtensionsAutoConfiguration`)

| `type` | Java / handling |
|---|---|
| `boolean` | `Boolean` |
| `string` | `String` |
| `integer` | `Integer` |
| `bigdecimal` | `BigDecimal` (from number or string) |
| `json`, `file`, `folder`, `content`, `array` | Jackson-serializable value stored as JSON (`JsonNode`) |
| `date`, `datetime` | `java.util.Date`, parsed by `DateFormatterProvider` (ISO-like strings; expressions allowed as default values) |
| anything else | **NPE when a default value exists** [run t17v]; validation falls back to `json` |

Default values containing `${...}` or JSON objects are resolved at process start against the other start variables.

#### 6.2.4 Semantics (all [src], key behaviors [run])

| Mapping key (element id) | Used when | Effect |
|---|---|---|
| service task id | connector call | `inputs`/`constants` -> `IntegrationContext.inBoundVariables`; `outputs` applied on connector result; no entry => **no inputs, outputs dropped** [run t17 vs t17a/t17m] |
| user task id | task created / completed | `inputs`/`constants` -> **task-local variables**; with no entry the task-local variable set is **empty** (only `constants` if present), even without an extension file, because the starter's `MappingAwareUserTaskBehavior` replaces the engine default copy [run t17b, t17bi: `MAP_ALL_INPUTS` copies all process variables + constants]; `outputs` applied to the task completion variables; no entry => completion variables **not** propagated [run t17b, t17bm, t17bx] |
| call activity id | child start / end | `inputs`/`constants` -> child start variables (after validating against the child's `properties`); `outputs`/MAP_ALL on return; BPMN `activiti:in/out` also applied [run t25, t25m] |
| start event id | process start | acts as an **output mapping on the start payload variables**; if no entry, the payload is kept as is |
| catch event id (message/signal) | event delivered | output mapping of the payload; no entry => payload dropped |
| throw message event id | send | inputs/constants become the message payload |

Mapping type details:
- `inputs.<name>`: `VALUE` -> literal; `VARIABLE` -> value of the process variable whose **name** is in `value`; only if that variable is "defined" (in `properties` by name, or currently set on the execution). Values may contain `${expr}` which is resolved with the execution variables.
- `outputs.<processVar>`: `VARIABLE` -> value taken from the connector/task result under the name in `value`; `VALUE` -> literal; `JSONPATCH` -> RFC 6902 patch array applied to the current value (or `properties` default) of `<processVar>`; `${var}` may appear in the patch `path` (only `string`/`integer` variables). **The target process variable must be defined in `properties` or already exist**, otherwise the output is skipped. If a `properties` entry exists, the value is coerced with the property type. Expressions are not allowed in output values.
- `MAP_ALL` / `MAP_ALL_INPUTS`: pass **all** execution variables as inputs; `MAP_ALL` / `MAP_ALL_OUTPUTS`: take **all** available output variables as they are [run t17a: `result`, `extraOut` both propagated].
- `ephemeral: true` marks the mapped variables transient (`IntegrationContext.hasEphemeralVariables()`); `properties.<x>.ephemeral` similar.
- A malformed extension file (e.g. `constants.<id>.<name>` given as a bare string instead of `{ "value": ... }`) is **not detected at deployment**: it fails at the first process start with `IllegalStateException: Unable to read process extension` [run].
- Start payload validation (`ProcessVariablesPayloadValidator`): names must be valid; values may not contain expressions; type is validated against `properties` (`Variables fail type validation: x`) [run]. Required properties are enforced at start (`Can't start process 'k' without required variables - x`).

#### 6.2.5 Deployment naming and placement

- Default location: `classpath*:**/processes/` + `**.bpmn20.xml` and `**.bpmn` (`spring.activiti.process-definition-location-suffixes`). The conventional location is `src/main/resources/processes/`.
- `spring.activiti.deployment-name` (default `SpringAutoDeployment`); `spring.activiti.deployment-mode`: `default` (one deployment for everything, duplicate filtering on), `single-resource`, `resource-parent-folder`, `never-fail`, `fail-on-no-process`, `none`.
- **Validation by mode:** only the `never-fail` and `fail-on-no-process` modes call `AbstractAutoDeploymentStrategy.validateModel`, which validates each `.bpmn20.xml`/`.bpmn` and **skips** invalid ones (`NeverFailAutoDeploymentStrategy` line 51, `FailOnNoProcessAutoDeploymentStrategy` line 52). In `default` mode everything goes into one deployment, all or nothing. Resource names are absolute file paths for file-system resources (`determineResourceName`).
- A new deployment of an unchanged resource is filtered (duplicate filtering); a changed one creates a new definition version.

### 6.3 Other runtime-layer facts

- `ProcessRuntime` API (`@PreAuthorize("hasRole('ACTIVITI_USER')")`): `start(StartProcessPayload | StartMessagePayload)`, `signal`, `receive(ReceiveMessagePayload)`, `suspend/resume/delete/update`, `processInstances`, `variables`, `setVariables`, `removeVariables`. `ProcessAdminRuntime`, `TaskAdminRuntime`: `hasAnyRole('ACTIVITI_ADMIN','APPLICATION_MANAGER')`.
- `TaskRuntime`: tasks visible to assignee/owner/candidate user/candidate group; `complete` requires the task to be **claimed by the caller** (`The task needs to be claimed before trying to complete it`); `taskService.complete(id, vars, true)` -> local-scope variables (hence the mapping requirement) [run].
- Security policies (`activiti.security.policies[n]`: `name`, `groups`, `users`, `serviceName`, `access` (`READ`/`WRITE`/`NONE`), `keys`; `activiti.security.wildcard`, default `*`): with no policies everything is allowed; `ACTIVITI_ADMIN` bypasses.

---

## 7. Process validation rules to mirror in live linting

Validator set `activiti-executable-process` (`ValidatorSetFactory`). **E** = error (aborts deployment), **W** = warning. XSD validity (`BPMN20.xsd`) comes first.

| Problem key | Sev | Rule |
|---|---|---|
| `ALL_PROCESS_DEFINITIONS_NOT_EXECUTABLE` | E | at least one process must be `isExecutable="true"` |
| `PROCESS_DEFINITION_NOT_EXECUTABLE` | W | non-executable process when another is executable |
| `PROCESS_DEFINITION_ID_NOT_UNIQUE` | E | duplicate process ids (only checked among processes that have a `name`) |
| `PROCESS_DEFINITION_ID_TOO_LONG` / `..._NAME_TOO_LONG` / `..._DOCUMENTATION_TOO_LONG` / `BPMN_MODEL_TARGET_NAMESPACE_TOO_LONG` | E | id <=255, name <=255, documentation <=2000, targetNamespace <=255 (only evaluated when an executable process exists) |
| `FLOW_ELEMENT_ID_TOO_LONG` | E | activity id <=255 |
| `ASSOCIATION_INVALID_SOURCE_REFERENCE` / `..._TARGET_REFERENCE` | E | association needs `sourceRef` and `targetRef` |
| `SIGNAL_MISSING_ID`, `SIGNAL_MISSING_NAME`, `SIGNAL_DUPLICATE_NAME`, `SIGNAL_INVALID_SCOPE` | E | signal id+name required; names unique; `activiti:scope` null/`global`/`processInstance` |
| `OPERATION_INVALID_IN_MESSAGE_REFERENCE` | E | operation `inMessageRef` must exist |
| `ERROR_MISSING_ERROR_CODE` | E | every `<error>` needs a non-blank `errorCode` |
| `DATA_OBJECT_MISSING_NAME` | E | data objects need a name |
| `MESSAGE_INVALID_ITEM_REF` | E | `message/@itemRef` must exist among item definitions |
| `START_EVENT_MULTIPLE_FOUND` | E | at most one none start per process level |
| `START_EVENT_INVALID_EVENT_DEFINITION` | E | process-level start definition must be message, timer or signal |
| `SUBPROCESS_MULTIPLE_START_EVENTS`, `SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED` | E | embedded sub process: <=1 start, none-type |
| `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION` | E | event sub process start must be error/message/signal (**modeler must additionally forbid signal**) |
| `SEQ_FLOW_INVALID_SRC`, `SEQ_FLOW_INVALID_TARGET`, `SEQ_FLOW_INVALID_TARGET_DIFFERENT_SCOPE` | E | endpoints exist and are in the same container |
| `SEQ_FLOW_INVALID_CONDITIONAL_EXPRESSION` | E | condition must parse as JUEL |
| `USER_TASK_LISTENER_IMPLEMENTATION_MISSING` | E | task listener needs implementation |
| `EXECUTION_LISTENER_IMPLEMENTATION_MISSING`, `EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE` | E | process + top-level flow elements; `onTransaction` not with `expression` |
| `EVENT_LISTENER_IMPLEMENTATION_MISSING`, `EVENT_LISTENER_INVALID_IMPLEMENTATION`, `EVENT_LISTENER_INVALID_THROW_EVENT_TYPE` | E | process event listeners |
| `SERVICE_TASK_MISSING_IMPLEMENTATION` | E | one of class/delegateExpression/expression/##WebService/type/implementation |
| `SERVICE_TASK_INVALID_TYPE` | E | type in mail/mule/camel/shell/dmn (**modeler: only mail/shell**) |
| `SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE` | E | no `resultVariableName` with class/delegateExpression |
| `SERVICE_TASK_WEBSERVICE_INVALID_OPERATION_REF` | E | operation must exist |
| `MAIL_TASK_NO_RECIPIENT`, `MAIL_TASK_NO_CONTENT` | E | fields `to` and one of `text`/`html`/`textVar`/`htmlVar` |
| `SHELL_TASK_NO_COMMAND`, `SHELL_TASK_INVALID_PARAM` | E | field `command`; `wait`/`redirectError`/`cleanEnv` literal `true|false` |
| `DMN_TASK_NO_KEY` | E | `decisionTableReferenceKey` field (**moot, dmn has no behavior**) |
| `SEND_TASK_INVALID_IMPLEMENTATION`, `SEND_TASK_INVALID_TYPE`, `SEND_TASK_WEBSERVICE_INVALID_OPERATION_REF` | E | send task needs `type` mail/mule/camel or `##WebService` |
| `SCRIPT_TASK_MISSING_SCRIPT` | E | non-empty `<script>` |
| `EXCLUSIVE_GATEWAY_NO_OUTGOING_SEQ_FLOW` | E | |
| `EXCLUSIVE_GATEWAY_CONDITION_NOT_ALLOWED_ON_SINGLE_SEQ_FLOW` | E | |
| `EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW` | E | |
| `EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS` | W | |
| `EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS` | E | targets must be intermediate catch events |
| `BOUNDARY_EVENT_NO_EVENT_DEFINITION`, `BOUNDARY_EVENT_INVALID_EVENT_DEFINITION` | E | definition in timer/error/signal/cancel/message/compensate |
| `BOUNDARY_EVENT_CANCEL_ONLY_ON_TRANSACTION`, `BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION` | E | |
| `COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY` | E | one compensation boundary per activity |
| `COMPENSATE_EVENT_INVALID_ACTIVITY_REF` | E | `activityRef` must exist |
| `MESSAGE_EVENT_MISSING_MESSAGE_REF`, `MESSAGE_EVENT_INVALID_MESSAGE_REF`, `MESSAGE_EVENT_MULTIPLE_ON_BOUNDARY_SAME_MESSAGE_ID` | E | messageRef or `activiti:messageExpression`; ref must exist |
| `SIGNAL_EVENT_MISSING_SIGNAL_REF`, `SIGNAL_EVENT_INVALID_SIGNAL_REF` | E | signalRef or `activiti:signalExpression`; ref must exist |
| `EVENT_TIMER_MISSING_CONFIGURATION` | E | one of timeDate/timeCycle/timeDuration |
| `INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION`, `INTERMEDIATE_CATCH_EVENT_INVALID_EVENTDEFINITION` | E | definition in timer/signal/message/link |
| `THROW_EVENT_INVALID_EVENTDEFINITION` | E | intermediate throw definition (if any) in signal/compensate/message/link |
| `END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION` | E | |
| `LINK_EVENT_DEFINITION_MISSING_TARGET[_EMPTY_NAME]`, `..._MISSING_SOURCE[_EMPTY_NAME]` | E | throw link needs `<target>`, catch link needs a `<source>` |
| `MULTI_INSTANCE_MISSING_COLLECTION` | E | `loopCardinality` or `collection` |
| `DATA_ASSOCIATION_MISSING_TARGETREF` | E | |
| `DI_INVALID_REFERENCE`, `DI_DOES_NOT_REFERENCE_FLOWNODE`, `DI_DOES_NOT_REFERENCE_SEQ_FLOW` | W | diagram references |
| `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE`, `EVENT_TIMER_ASYNC_NOT_AVAILABLE`, `SIGNAL_ASYNC_NOT_AVAILABLE` | W | starter set `activiti-spring-boot-starter`, added only when `spring.activiti.async-executor-activate=false` |

### 7.1 Extra lint rules for what the engine does NOT enforce

| # | Rule | Reason |
|---|---|---|
| L1 | Error on any `camunda:`/`zeebe:` semantic attribute/element; offer translation (section 5) | silently ignored [run t01, t13d] |
| L2 | Error: `businessRuleTask` | NPE at deployment [run t04] |
| L3 | Error: `serviceTask activiti:type` other than `mail`/`shell` (`dmn`, `camel`, `mule` included) | no behavior / class missing |
| L4 | Error: `complexGateway`, `adHocSubProcess` | converted to exclusive / hangs |
| L5 | Error: start event with signal definition inside an event sub process; any timer start inside event sub process | not implemented / rejected |
| L6 | Error: end event with signal/escalation/link/compensation definition; throw event with escalation | silently degraded |
| L7 | Error: boundary/start/catch events with escalation or conditional definitions | not parsed |
| L8 | Error: `serviceTask implementation=` pointing to a bean name that is not in the project's connector list; warning if no `mappings.<taskId>` | outputs dropped (finding 17) |
| L9 | Warning: user task / call activity / catch event / service task without a `mappings` entry when variables are expected to flow | finding 17 |
| L10 | Error: `extensions.<key>` that is not an executable process id; mapping/constant keys that are not element ids of that process | the file is silently inert |
| L11 | Error: property `type` not in the 6.2.3 list when a default `value` is set | NPE at start |
| L12 | Error: transaction with a cancel end event but no compensable activity (activity with compensation boundary + handler) before the cancel | runtime exception |
| L13 | Error: `sendTask` without `activiti:type="mail"` | only mail works |
| L14 | Error: `scriptFormat` other than `juel`, `javascript` (aliases `js`, `JavaScript`, `ECMAScript`, `nashorn`) unless the app adds a JSR-223 engine | `Can't find scripting engine` |
| L15 | Warning: `isExecutable` must be true; warn on missing `name` on service tasks used as connectors (the name becomes `clientName`) | |
| L16 | Error: serializer must pretty-print around `multiInstanceLoopCharacteristics` | parser bug (14) |
| L17 | Error: message start events with the same message name in two definitions | deployment error (`there already is a message event subscription`) |
| L18 | Warning: message throw events (no real sender configured) | finding 13 |
| L19 | Error: event-based gateway targets other than intermediate catch events (incl. `receiveTask`) | V |
| L20 | Warning: `skipExpression` on user tasks without the `_ACTIVITI_SKIP_EXPRESSION_ENABLED` variable convention | never skipped otherwise |

---

## 8. Expressions, scripts, timers

### 8.1 Expressions [src]

- **JUEL** (`activiti-juel-jakarta`, `jakarta.el` 5), created by `ExpressionManager` (`ExpressionFactory.newInstance()`). Both `${...}` and `#{...}` are accepted. `typeLanguage`/`expressionLanguage` attributes are ignored.
- Resolvers (order): `VariableScopeElResolver` (items: `execution`, `task`, `authenticatedUserId`, `initiator` (process initiator variable), then process/task variables by name), custom resolvers (Spring: `ApplicationContextElResolver` exposes all beans by name; starter: `EnvironmentVariableELResolver` exposes `${vars.NAME}` -> env var `vars.NAME`, switch `spring.activiti.env-var-el-resolver.enabled`), array/list/map/JsonNode resolvers, and a `BeanELResolver` wrapped by `ELResolverReflectionBlockerDecorator` (blocks `java.lang.reflect` and `Object` native/final methods, e.g. `getClass()`).
- Custom functions: `CustomFunctionProvider` beans.
- Condition expressions, skip expressions, MI cardinality/collection/completion, task attributes, timers, field expressions, message/signal names, `calledElement`, listener `expression` are all JUEL.

### 8.2 Scripts [src] [run]

| `scriptFormat` | Works? | Notes |
|---|---|---|
| omitted / `juel` | yes | `ScriptingEngines.DEFAULT_SCRIPTING_LANGUAGE = "juel"`: the script text is a JUEL expression (`${1+2}`) [run t13c] |
| `javascript`, `JavaScript`, `js`, `nashorn`, `ECMAScript` | yes (Nashorn 15.7 JSR-223) | looked up with `ScriptEngineManager.getEngineByName` [run t13e]; Java 25 has no built-in Nashorn, the dependency provides it. `application/javascript` (a MIME type) does not resolve. |
| `groovy` | **no** by default | add `org.codehaus.groovy:groovy` (+ `groovy-jsr223`, version managed 3.0.25) to the app |
| others | only if a JSR-223 engine is on the classpath | |

Result goes to `activiti:resultVariable`. A `BpmnError` thrown from a script is routed to error handling.

### 8.3 Timers [src] [run]

`TimerUtil.createTimerEntityForTimerEventDefinition`: the text of `timeDate`/`timeCycle`/`timeDuration` is a JUEL expression whose result is a `String`, `java.util.Date` or Joda `DateTime`.

| Element | Accepted syntax |
|---|---|
| `timeDate` | ISO 8601 date-time (`2030-01-01T12:00:00`, Joda `DateTime.parse`); a leading `P...` is treated as a period added to now |
| `timeDuration` | ISO 8601 duration (`PT10M`, `P1DT2H`) via `DurationHelper` |
| `timeCycle` | ISO 8601 repeating interval `R3/PT10M`, `R/PT1H`, optionally `R5/2030-01-01T00:00:00/PT1H`; **or a cron expression** (not starting with `R`): Quartz style `s m h dom mon dow [year]`, e.g. `0 0 12 * * ?` (`CronExpression`) [run t52]; `activiti:endDate` on `timeCycle` |
| `activiti:businessCalendarName` | custom `BusinessCalendar` registered in the engine (default calendars: `dueDate`, `duration`, `cycle`) |

Repeat only applies to start events and **non-interrupting boundary** timers; interrupting boundary and intermediate catch timers fire once. Timer jobs need the async executor (default on).

---

## 9. Embedding in Spring Boot (minimal setup)

### 9.1 Minimal `pom.xml` (verified to resolve and run [run])

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lab</groupId><artifactId>activiti9-app</artifactId><version>1</version>
  <properties>
    <java.version>25</java.version>
    <maven.compiler.release>25</maven.compiler.release>
  </properties>
  <repositories>
    <repository>
      <id>alfresco</id>
      <url>https://artifacts.alfresco.com/nexus/content/repositories/activiti-releases/</url>
    </repository>
  </repositories>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId>
        <version>3.5.7</version><type>pom</type><scope>import</scope>
      </dependency>
      <dependency>
        <groupId>org.activiti</groupId><artifactId>activiti-dependencies</artifactId>
        <version>9.0.0</version><type>pom</type><scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency><groupId>org.activiti</groupId><artifactId>activiti-spring-boot-starter</artifactId></dependency>
    <!-- optional deps of the starter that the runtime actually needs: -->
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-json</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-jdbc</artifactId></dependency>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId></dependency>
    <!-- add spring-boot-starter-web for a REST app; add groovy + groovy-jsr223 only if you need groovy scripts -->
  </dependencies>
</project>
```

Why the extras: the starter declares `spring-boot-starter-security`, `spring-boot-starter-web`, `spring-boot-starter-integration` as **optional**, so a consumer must add Security (method security + `UserDetailsService` + `ProcessRuntime` security) and a JDBC/DataSource starter; Jackson/`spring-web` (via `spring-boot-starter-json` or `-web`) is needed for the Boot `ObjectMapper` used by the extension reader. Use Boot 3.5.7 or any 3.5.x; Boot 4 is out of scope (see `compat-check/`).

### 9.2 `application.properties`

```properties
spring.datasource.url=jdbc:h2:mem:activiti;DB_CLOSE_DELAY=-1
spring.datasource.username=sa
spring.activiti.database-schema-update=true           # default "true"
# spring.activiti.history-level=none                    # default NONE (none|activity|audit|full)
# spring.activiti.db-history-used=false                 # default false
# spring.activiti.async-executor-activate=true          # default true
# spring.activiti.process-definition-location-prefix=classpath*:**/processes/   # default
# spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn    # default
# spring.activiti.check-process-definitions=true
# spring.activiti.deployment-name=SpringAutoDeployment
# spring.activiti.deployment-mode=default
spring.activiti.mail-server-host=localhost
spring.activiti.mail-server-port=1025
spring.activiti.mail-server-default-from=noreply@example.org   # required for mail tasks without a 'from' field
# spring.activiti.use-strong-uuids=true  spring.activiti.copy-variables-to-local-for-tasks=true
# spring.activiti.serialize-pojos-in-variables-to-json=true
# spring.activiti.security.enabled=true                 # method security auto-config
# spring.activiti.env-var-el-resolver.enabled=true
# spring.activiti.async-executor.core-pool-size=2 ... (AsyncExecutorProperties)
# activiti.connectors.dir=classpath:/connectors/
# activiti.security.policies[0].name=... (see 6.3)
```

Place models at `src/main/resources/processes/<name>.bpmn20.xml` and `<name>-extensions.json`.

### 9.3 Required beans

```java
@SpringBootApplication
public class App {
  @Bean UserDetailsService userDetailsService() {      // REQUIRED in a non-web app; ExtendedInMemoryUserDetailsManager recommended
    ExtendedInMemoryUserDetailsManager m = new ExtendedInMemoryUserDetailsManager();
    m.createUser(User.withUsername("user").password("{noop}pw")
        .authorities("ROLE_ACTIVITI_USER", "GROUP_g1").build());   // roles: ROLE_*, groups: GROUP_*
    return m;
  }
  @Bean(name = "myConnector") Connector myConnector() { return ctx -> { ctx.addOutBoundVariable("result","x"); return ctx; }; }
}
```

Without a `UserDetailsService` the context fails: `Parameter 0 of method userGroupManager ... required a bean of type 'UserDetailsService'` [run]. (In a servlet app Boot's default in-memory manager satisfies it, but `UserGroupManager.getUsers()/getGroups()` cast to `ExtendedInMemoryUserDetailsManager`.)

### 9.4 Using `ProcessRuntime` / `TaskRuntime` [run]

1. Authenticate: `SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("user","pw", List.of(new SimpleGrantedAuthority("ROLE_ACTIVITI_USER"), new SimpleGrantedAuthority("GROUP_g1"))))`. Without it: `AuthenticationCredentialsNotFoundException`.
2. Also set `org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId("user")` before `start(...)`; otherwise `initiator` is `null`, `${initiator}`/`activiti:initiator` variables are `null`, and the starter cannot read the instance back (finding 20).
3. A user sees tasks only as assignee/owner/candidate (candidate groups come from `GROUP_` authorities); claim before complete; completion variables flow to the process only through `mappings` (6.2.4).

### 9.5 Engine-level API (no security layer)

`RepositoryService.createDeployment().addInputStream(...).deploy()`, `RuntimeService.startProcessInstanceByKey`, `TaskService.complete(id, vars)` (**global scope**: variables become process variables directly, unlike `TaskRuntime`/`complete(id, vars, true)`), are available as beans and bypass the API runtime's security. Useful for test harnesses [run].

---

## 10. Support summary: what the modeler offers and what it hides

**Offer (all verified executable):** none/message/timer/signal start events (process level), error and message start in event sub processes; none/error/terminate/message(*)/cancel end events; intermediate catch timer/message/signal/link; intermediate throw none/signal/compensate/message(*)/link; boundary timer/message/signal/error/cancel/compensate; user, service (class/expression/delegateExpression/connector `implementation`/mail/shell), script (juel/javascript), receive, manual, plain task, send (mail only); exclusive, parallel, inclusive, event-based gateways; embedded sub process, event sub process (error, message), transaction, call activity; multi-instance (sequential/parallel; cardinality, collection, completion condition); data objects; sequence flows with conditions/default; pools/lanes as documentation only; text annotation/association (needed for compensation).
(*) message throw: only meaningful with a custom `ThrowMessageDelegate`.

**Hide / reject:** business rule task, complex gateway, ad-hoc sub process, escalation/conditional/multiple/parallel event definitions, signal-start in event sub process, timer-start in event sub process, signal/escalation/link/compensate end events, camel/mule/dmn task types, web service task, `standardLoopCharacteristics`, group, `camunda:`/`zeebe:` anything.

---

## Appendix A. Empirical test matrix (lab, Activiti 9.0.0, JDK 25, Spring Boot 3.5.7)

Each model (`modeler/packages/activiti-moddle/test/fixtures/lab/tNN_*.bpmn20.xml`) was deployed on its own, started with the engine API, and its state printed.

| Test | Observation |
|---|---|
| t01 camunda:assignee/candidateGroups/formKey | deploys; task has no assignee, no candidates, no formKey |
| t02 activiti attrs | name expression, assignee, candidateUsers (a,b), candidateGroups (g1,g2), priority 7, category, formKey, dueDate `P1D`, documentation->description all set |
| t03 camunda:executionListener (unprefixed attrs) / t65 activiti: prefixed attrs / t66 camunda: prefixed attrs | listener fired in all three: attribute namespace is ignored for listeners |
| t04 businessRuleTask w/o class | deployment fails: NPE `ruleActivity is null` |
| t05 complexGateway | acts as exclusive (took the true branch) |
| t06 serviceTask type=dmn | deploys, run skips it |
| t07 serviceTask type=foo | `SERVICE_TASK_INVALID_TYPE` |
| t08 event sub process timer start | `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION` |
| t09 event sub process signal start | deploys; no subscription; signal does nothing |
| t09b event sub process message start | works |
| t10 adHocSubProcess | deploys; instance sits in `ah` with no tasks |
| t11 intermediate throw escalation | passes through (none throw) |
| t11b start conditional | acts as none start |
| t11c boundary escalation | `BOUNDARY_EVENT_NO_EVENT_DEFINITION` |
| t11d end escalation | none end |
| t12 standardLoopCharacteristics | ignored |
| t13/t13c/t13e script javascript, juel(default), aliases `javascript`,`JavaScript`,`js`,`nashorn`,`ECMAScript` | work; `application/javascript` and `groovy` fail with `Can't find scripting engine` |
| t13d camunda:resultVariable | result variable not set |
| t13f autoStoreVariables=true with `var z = 99;` | `z` not stored |
| t14 `group` artifact | ignored |
| t15, t15b-d MI user task (pretty XML) | 2 tasks created (assignees anna, bob); cardinality variant works |
| t15x* same MI XML without whitespace before `</userTask>` | process ends immediately at start, no error |
| t16 sendTask implementation only | `SEND_TASK_INVALID_IMPLEMENTATION` |
| t17 connector, no extension file | connector called with `{}`; outputs dropped |
| t17a MAP_ALL | all vars in, all outputs out |
| t17m explicit inputs/outputs | inputs `in1=abc` (VALUE), `in2=fromProp` (VARIABLE from property default), output `result` mapped; `extraOut` dropped |
| t17b/t17bm/t17bx user task complete with `localScope=true` | no mapping: variables not propagated; `MAP_ALL_OUTPUTS`: all propagated; explicit output: only mapped var |
| t17bi user task with `MAP_ALL_INPUTS` + constant | task-local variables = all process variables + the constant; without mapping (t17b, t17bm, t17bn) local variables are empty |
| t17bd properties defaults | `integer`, `date`, `json` defaults materialized as start variables |
| t17u unknown JSON keys, lower-case enum | accepted |
| t17v `type` unknown + value | NPE at start; constants merged into inputs; templates/assignments accepted |
| t20 timer start | timer job created at deployment |
| t21/t21b message throw (intermediate/end) | passes, nothing sent |
| t22 link | jumps over the skipped branch |
| t23 transaction + cancel end + compensable inner task | works (compensation ran, `afterCancel` reached); without compensable work: `No execution found for sub process of boundary cancel event` |
| t24 event-based gateway | timer job + message subscription created |
| t25 call activity `in`/`out` | `in x->y` and `out y->outY` work; with `MAP_ALL` mapping the child's variables return as well |
| t26/t26b/t26c expression, delegateExpression, class + field | work |
| t27 formProperty | parsed, formKey null, no effect |
| t28 task listeners create/assignment/complete | all fire |
| t29/t29b mail (service/send) with `ignoreException` | works once `mail-server-default-from` is set; error text stored in `exceptionVariableName`; without default from: NPE |
| t30 shell | `echo hello` output stored in `outputVariable` |
| t31/t31b camel, mule | deployment fails (class not found) |
| t32 data objects | variables created with proper types |
| t33 compensation | handler ran on throw compensate |
| t34/t69 error boundary (with/without errorRef) | both catch |
| t36 async service task | job executed by the async executor |
| t37 signal catch | resumes on `signalEventReceived` |
| t40 skipExpression | not skipped (needs `_ACTIVITI_SKIP_EXPRESSION_ENABLED`) |
| t41 initiator | `activiti:initiator` variable and `${starter}` assignee resolved when `Authentication.setAuthenticatedUserId` is set |
| t43 inclusive, t44 manual/task, t45 receive, t49 exclusive, t50 lanes, t51 collaboration, t52 boundary timers, t54 message start, t55 signal start, t56 boundary message/signal, t57 terminate, t58 humanPerformer/potentialOwner, t59 condition without xsi:type, t60 process listeners, t61/t62 sub processes | work as described |
| t46 `camunda:class` | `SERVICE_TASK_MISSING_IMPLEMENTATION` |
| t47 `##WebService` without interface | invalid operation ref |
| t67/t70 `activiti:skipExpression` / unprefixed `skipExpression` on sequenceFlow | both accepted |
| t71 unprefixed `assignee` on userTask | XSD error |
| t68 signal end event | signal not thrown |
| API test | no authentication: `AuthenticationCredentialsNotFoundException`; `processInstance(id)` denied unless `Authentication.setAuthenticatedUserId` set; task visible via candidate group; complete before claim rejected; start variables type-checked against `properties` |

## Appendix B. Key source classes

- Converter: `org.activiti.bpmn.converter.BpmnXMLConverter`, `*XMLConverter` (per element), `converter.child.*` (listeners, fields, event definitions, multi-instance, form properties), `converter.parser.*`, `converter.util.BpmnXMLUtil`, `org.activiti.bpmn.constants.BpmnXMLConstants`.
- Model: `org.activiti.bpmn.model.*` (`ImplementationType`, `Signal.SCOPE_*`).
- Validation: `org.activiti.validation.validator.ValidatorSetFactory`, `validator.impl.*`, `Problems`, `process-validation-messages.json`.
- Engine parse/exec: `engine.impl.bpmn.parser.handler.*`, `engine.impl.bpmn.parser.factory.DefaultActivityBehaviorFactory`, `engine.impl.bpmn.behavior.*`, `engine.impl.bpmn.helper.ErrorPropagation|ScopeUtil|SkipExpressionUtil`, `engine.impl.util.TimerUtil`, `engine.impl.calendar.*`, `engine.impl.agenda.ContinueProcessOperation|TakeOutgoingSequenceFlowsOperation`, `engine.impl.bpmn.deployer.TimerManager|EventSubscriptionManager`, `engine.impl.scripting.ScriptingEngines`, `engine.impl.el.ExpressionManager`.
- Activiti 7+: `org.activiti.runtime.api.connector.DefaultServiceTaskBehavior`, `IntegrationContextBuilder`, `org.activiti.runtime.api.impl.ExtensionsVariablesMappingProvider|MappingAware*|ProcessVariablesPayloadValidator|EventSubscriptionVariablesMappingProvider`, `org.activiti.spring.process.ProcessVariablesInitiator`, `org.activiti.spring.process.model.*`, `org.activiti.spring.process.ProcessExtensionResourceReader`, `org.activiti.core.common.spring.connector.*`, `org.activiti.spring.boot.ProcessEngineAutoConfiguration|ActivitiProperties|AsyncExecutorProperties`, `org.activiti.spring.autodeployment.*`.

## Appendix C. Points the sources alone did not settle

1. `activiti:autoStoreVariables` with Nashorn (observed: assignment `var z = 99;` not stored) [run t13f]. Settled by the corpus: the flag has no effect with the bundled script languages (engine finding 25, `C03-script-tasks/scenarios/auto-store.scenario.json`).
2. User task input variables: empty unless mapped (see 6.2.4).
3. Conditions on flows that leave tasks or events (not gateways): run by `C12-misc-flow/scenarios/implicit-split.scenario.json`.
4. Message **throw** with a real delegate (`activiti:class` on `messageEventDefinition`): run by `C06-messages/scenarios/message-throw.scenario.json` and `message-end.scenario.json` (engine finding 33).
5. The consumers of `templates` / `assignments` in the extension JSON are outside the analysed modules (notification/assignment services of Activiti Cloud / APA).
6. The class name of connector beans in the Alfresco ecosystem (`connectorName.actionName`) is inferred from the `.` restriction in `ConnectorDefinitionService`.
7. `9.1.0-alpha.*` artifacts exist in some repositories; they were not analysed (out of scope: stable 9.0.0 only).
