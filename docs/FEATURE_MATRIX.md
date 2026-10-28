# Feature matrix

What the modeler supports on Activiti, and how each row is proven. The rows of sections A and E name the corpus projects whose hand-written scenarios run the feature on an embedded Activiti 9.0.0 (section J). The same corpus also runs on Activiti 8.8.1 ([ADR 0002](adr/0002-runtime-target.md)). [`verification-index.md`](verification-index.md) names the tests behind every row.

- **Status:**
  - `supported`: built, and proven by the rule below for everything the row lists.
  - `partly supported`: built, but part of the row is missing or not proven. The verification index says which part.
  - `not supported`: not built.
- **Rule for `supported`:** at least one **named assertion** proves the row at engine level, on a model that the modeler generated: a scenario step, a `model-expect.json` entry or a harness test. A row with user-facing behaviour also needs a Playwright test; for a row without engine behaviour, the Playwright test is the proof.
- **Evidence:** **R1 §n** is a section of [`research/activiti-9-bpmn-support.md`](research/activiti-9-bpmn-support.md), the reference of what Activiti 9.0.0 parses and executes. "Engine finding n" is an entry of [`engine-findings.md`](engine-findings.md).

## A. BPMN palette and element support

Only elements that Activiti 9.0.0 executes are creatable. Everything in §C is hidden from the palette, context pad, replace menu and create/append menus. Importing such a model shows lint errors.

### A.1 Events

| # | Element / variant | Modeler | Key properties (XML) | Extensions JSON | Corpus | Status |
|---|---|---|---|---|---|---|
| E1 | None start (process) | palette | `activiti:initiator`, `activiti:formKey`, (legacy `activiti:formProperty` round-trip) | start-event mapping (output mapping on start payload) | C01, C15 | supported |
| E2 | Timer start | replace | `timeDate` / `timeDuration` / `timeCycle` (ISO repeat or Quartz cron), `activiti:endDate` on `timeCycle`, `activiti:businessCalendarName` | - | C05, C21 | supported |
| E3 | Message start | replace | `messageRef` (definitions-level `message` with name) | start mapping | C06 | supported |
| E4 | Signal start | replace | `signalRef` (+ `signal activiti:scope`) | - | C07 | supported |
| E5 | Error start (event sub process only) | replace inside event SP | `errorRef` optional | - | C08 | supported |
| E6 | Message start (event sub process, interrupting/non) | replace inside event SP | `messageRef`, `isInterrupting` | catch mapping | C06 | supported |
| E7 | None end | palette | - | - | all | supported |
| E8 | Error end | replace | `errorRef` -> `error errorCode` | - | C08 | supported |
| E9 | Terminate end | replace | `activiti:terminateAll`, `activiti:terminateMultiInstance` | - | C10 | supported |
| E10 | Cancel end (inside transaction only) | replace, only in transaction | - | - | C09 | supported |
| E11 | Message end | replace (warn: needs custom `ThrowMessageDelegate`) | `messageRef`, `activiti:class`/`activiti:delegateExpression` on definition, `activiti:field` payload | throw mapping (inputs -> payload) | C06 | supported |
| E12 | Intermediate catch timer | palette/replace | `timeDate` / `timeDuration` (`timeCycle` warn: fires once) | - | C05 | supported |
| E13 | Intermediate catch message | replace | `messageRef` or `activiti:messageExpression`, `activiti:correlationKey` | catch mapping (payload) | C06 | supported |
| E14 | Intermediate catch signal | replace | `signalRef` or `activiti:signalExpression` | none: the engine maps no signal payload, the variables arrive as thrown and a mapping is ignored (engine findings 37, C20.2) | C07, C20-order | supported |
| E15 | Intermediate catch link | replace | `linkEventDefinition name`, `source` refs | - | C12 | supported |
| E16 | Intermediate throw none | palette | - | - | C12 | supported |
| E17 | Intermediate throw signal | replace | `signalRef`/`signalExpression`, definition `activiti:async` (needs the async executor) | - | C07 | supported |
| E18 | Intermediate throw compensate | replace | `activityRef`, `waitForCompletion` | - | C08 | supported |
| E19 | Intermediate throw link | replace | `target` | - | C12 | supported |
| E20 | Intermediate throw message | replace (warn as E11) | as E11 | throw mapping | C06 | supported |
| E21 | Boundary timer (interrupting / non-interrupting) | context pad / replace | `cancelActivity`, timer types incl. cycle (non-interrupting repeats) | - | C05 | supported |
| E22 | Boundary error | replace | `errorRef` optional (none = catch all) | - | C08 | supported |
| E23 | Boundary message (int/non-int) | replace | `messageRef`, `cancelActivity` | catch mapping | C06 | supported |
| E24 | Boundary signal (int/non-int) | replace | `signalRef`, `cancelActivity` | - | C07 | supported |
| E25 | Boundary cancel (transaction only) | replace | - | - | C09 | supported |
| E26 | Boundary compensate | replace | association to handler with `isForCompensation="true"` | - | C08 | supported |

### A.2 Tasks

| # | Element / variant | Modeler | Key properties | Extensions JSON | Corpus | Status |
|---|---|---|---|---|---|---|
| T1 | User task | palette | `activiti:assignee`, `owner`, `candidateUsers`, `candidateGroups`, `dueDate` (expr / ISO date / duration), `priority`, `category`, `formKey`, `skipExpression`, `businessCalendarName`, standard `humanPerformer`/`potentialOwner` (`user(x)`, `group(y)`), `activiti:customResource`; `activiti:taskListener` (create, assignment, complete, delete, all; class, expression, delegateExpression; `onTransaction`; `customPropertiesResolver*`; fields) | mappings (inputs -> task-local vars, outputs <- completion vars, MAP_ALL*), constants | C01, C13, C21 | supported |
| T2 | Service task: Java class | replace / template | `activiti:class` + `activiti:field` (string / expression) | - | C02 | supported |
| T3 | Service task: expression | template | `activiti:expression`, `activiti:resultVariableName` | - | C02 | supported |
| T4 | Service task: delegate expression | template | `activiti:delegateExpression` + fields | - | C02 | supported |
| T5 | Service task: connector (Activiti 7+) | template from `connectors/*.json` | `implementation="<connector>.<ACTION>"` | mappings (VALUE / VARIABLE / JSONPATCH, MAP_ALL*), constants, `ephemeral` | C02, C21 | supported |
| T6 | Decision task (DMN) | palette entry "Decision task" (custom icon) | `serviceTask implementation="dmn-connector.EXECUTE_TABLE"` | constant `_activiti_dmn_table_` = decision id; input/output mappings | C16, C17 | supported |
| T7 | Mail task | template | `activiti:type="mail"` + fields `to, from, cc, bcc, subject, text, textVar, html, htmlVar, charset, ignoreException, exceptionVariableName, attachments` | - | C14 | supported |
| T8 | Shell task | template | `activiti:type="shell"` + fields `command, arg1..arg5, wait, redirectError, cleanEnv, outputVariable, errorCodeVariable, directory` | - | C14 | supported |
| T9 | Script task | palette / replace | `scriptFormat` (`juel` default, `javascript`/`js`; others only with a JSR-223 engine), `<script>`, `activiti:resultVariable`, `activiti:autoStoreVariables` (warn); a `BpmnError` thrown from a script is routed to error boundaries | - | C03, C08 | supported |
| T10 | Send task (mail) | replace | `activiti:type="mail"` + mail fields | - | C14 | supported |
| T11 | Receive task | replace | wait state (trigger) | - | C12 | supported |
| T12 | Manual task | replace | pass-through | - | C12 | supported |
| T13 | Task (abstract) | palette | pass-through | - | C12 | supported |
| T14 | Call activity | palette / replace | `calledElement` (key from project or `${expr}`), `activiti:businessKey`, `inheritBusinessKey`, `inheritVariables`, `activiti:in`/`activiti:out` (`source` / `sourceExpression` / `target`) | mappings (inputs -> child start vars, outputs on return) | C11 | supported |
| T15 | Common to all activities | panel groups | `activiti:async`, `activiti:exclusive` (incl. `false`), `activiti:executionListener` (event, class/expression/delegateExpression, `onTransaction`, `customPropertiesResolverClass/Expression/DelegateExpression`, fields), `isForCompensation`, `default` flow, documentation, `activiti:extensionId` (round-trip) | - | C08, C10, C13, C19, C21 | supported |
| T15a | Failed job retry cycle | panel (service tasks only) | `<activiti:failedJobRetryTimeCycle>`: honoured **only on service tasks** (`JobRetryCmd`); lint L31 elsewhere. Other async elements use the default of 3 retries | - | C19 | supported |
| T15b | Exception mapping | panel (`activiti:class` service tasks and call activities only) | `<activiti:mapException errorCode includeChildExceptions>class</...>`: wired only for class delegates and call activities (`DefaultActivityBehaviorFactory`); lint L32 elsewhere. Connectors and delegate expressions throw `BpmnError` instead | - | C08 | supported |
| T16 | Multi-instance (all activity types incl. sub process, call activity) | marker toggle | `isSequential`, `loopCardinality`, `activiti:collection` (var or `${expr}`), `activiti:elementVariable`, `activiti:elementIndexVariable` (default `loopCounter`), `completionCondition`, `loopDataInputRef` / `inputDataItem`, `loopDataOutputRef` / `outputDataItem`. Activiti reads the `loopData*Ref` element **text as a variable name**, not an ID reference, so the moddle models them as string bodies (lint L35) | - | C01, C10, C11, C21 | supported |

### A.3 Gateways, structure, flows, data, artifacts

| # | Element | Modeler | Key properties | Corpus | Status |
|---|---|---|---|---|---|
| G1 | Exclusive gateway | palette | `default` | C04 | supported |
| G2 | Parallel gateway | replace | fork/join | C04 | supported |
| G3 | Inclusive gateway | replace | `default`, join semantics | C04 | supported |
| G4 | Event-based gateway | replace | targets: intermediate catch events only | C04 | supported |
| S1 | Embedded sub process | palette | `activiti:async`, one none start, data objects | C10 | supported |
| S2 | Event sub process | replace | start: error / message (interrupting or not) | C06, C08 | supported |
| S3 | Transaction | replace | cancel end / cancel boundary / compensation | C09 | supported |
| F1 | Sequence flow | connect | `name`, `conditionExpression` (JUEL `${...}`), `activiti:skipExpression`, `activiti:executionListener` (take) | C04 | supported |
| F2 | Default flow | context action | `default` on gateway / activity | C04 | supported |
| F3 | Conditional flow from tasks (implicit split) | condition on non-gateway flow | condition marker | C12 | supported |
| D1 | Data object | palette | `itemSubjectRef` in `xsd:string/int/long/double/boolean/datetime`, `activiti:value` default | C15 | supported |
| D2 | Data object reference / data store reference | palette | documentation only. A **drawn** `dataObjectReference` produces the engine warning `DI_INVALID_REFERENCE` in 9.0.0, so data objects are edited without a shape (`data.objects` accessor) and export warns about a drawn one | C18 | supported |
| P1 | Process (root) | canvas / panel | `id` (key), `name`, `isExecutable=true` (forced), `documentation`, `targetNamespace` (category), `activiti:candidateStarterUsers/Groups`, `activiti:potentialStarter`, execution listeners (start, end), `activiti:eventListener` (events, entityType, class / delegateExpression / throwEvent signal, globalSignal, message, error) | C01, C13, C15, C21 | supported |
| P2 | Definitions-level messages, signals (`activiti:scope`), errors (`errorCode`) | panel lists (create, rename, reference) | - | C06, C07, C08 | supported |
| P3 | Collaboration, pools (participants), lanes, message flows | palette | documentation only; each pool's process is deployed separately | C18 | supported |
| A1 | Text annotation, association | palette | association required for compensation handlers; an annotation drawn in a pool is saved, with its associations, in the pool's process (Activiti reads no artifact of a collaboration, engine finding C18.7) | C08, C18 | supported |
| X1 | Multiple processes per file | via pools | duplicate id checks | C18 | supported |

## B. Properties panel groups

The panel has one provider of its own, built on the property accessors; the Camunda and Zeebe providers of `bpmn-js-properties-panel` are not loaded ([ADR 0001](adr/0001-web-modeler-on-bpmn-io.md)). Each group lists the elements it applies to and the fields it shows.

| Group | Applies to | Fields | Writes |
|---|---|---|---|
| General | all | Name, ID (validated NCName, at most 255 characters, renames extensions keys), Executable (process, forced true and read-only), Target namespace (definitions) | XML |
| Documentation | all | Documentation (process: at most 2000 characters) | XML |
| Candidate starters | process | Candidate starter users, groups; potential starter expressions | XML |
| Process variables | process | Typed list (`boolean, string, integer, bigdecimal, json, file, folder, content, date, datetime, array`), required, default value (type-checked), description, display/displayName, analytics, ephemeral, category | ext `properties` |
| Messages / Signals / Errors | definitions (via process) | CRUD, name, signal scope, error code; reference counts | XML |
| Event listeners | process | events (multi-select of `ActivitiEventType`), entityType, implementation (class, delegateExpression, throw signal/globalSignal/message/error) | XML |
| Execution listeners | process, flow nodes, sequence flows | event (start/end/take), type (class, expression, delegateExpression), onTransaction, fields | XML |
| Start initiator / form | start event | Initiator variable (shows the host-app note: requires `Authentication.setAuthenticatedUserId`), form key | XML |
| User assignment | user task | Assignee, owner, candidate users, candidate groups (comma or expression), due date, priority, category, business calendar; standard `humanPerformer` / `potentialOwner` editors (`user(x)`, `group(y)`, expressions); `activiti:customResource` (name + expression) | XML |
| Form | user task, start event | Form key; legacy form properties (round-trip editor, marked "not executed by Activiti 9") | XML |
| Task listeners | user task | event (create, assignment, complete, delete, all), type, onTransaction (delegateExpression only), fields | XML |
| Implementation | service task | Type selector: Connector (picker from `connectors/`), Java class, Expression, Delegate expression, Mail, Shell, Decision (DMN). Type-specific fields; Result variable name (expression only) | XML (+ ext) |
| Field injection | service, send task, listeners, message definitions | name + string/expression | XML |
| Mail / Shell fields | mail, shell, send | structured editors for the known fields | XML |
| Decision | decision task | DMN file and decision picker (writes the decision ID constant), input mappings from decision inputs, output mappings from decision outputs | ext |
| Input / output mapping | service (connector, DMN), user task, call activity, catch / throw message and signal events, start event | Mapping type (none, MAP_ALL, MAP_ALL_INPUTS, MAP_ALL_OUTPUTS); inputs (target name -> VARIABLE / VALUE (+ `${expr}`)); outputs (process variable -> VARIABLE / VALUE / JSONPATCH); auto-declare targets in `properties`; ephemeral | ext `mappings` |
| Constants | same as mappings | name -> value (JSON) | ext `constants` |
| Script | script task | Format (juel, javascript), script (CodeMirror), result variable, autoStoreVariables | XML |
| Called element | call activity | Called element (process picker or expression), business key, inherit business key, inherit variables, in/out mappings (source / sourceExpression / target) | XML |
| Multi-instance | activities with loop | Sequential/parallel, cardinality, collection, element variable, element index variable, completion condition, output collection and item | XML |
| Asynchronous continuation | flow nodes | Async, exclusive | XML |
| Job execution | service tasks only (engine limitation) | Failed job retry time cycle | XML |
| Error mapping | `activiti:class` service tasks, call activities | `activiti:mapException` list | XML |
| Timer | timer events | Type (date / duration / cycle), value with live validation and preview (ISO 8601 or cron), end date, business calendar | XML |
| Message / Signal / Error / Link / Compensation / Terminate | respective event definitions | ref pickers or expressions, correlation key, message payload `activiti:field`s, **throw-message delegate** (`activiti:class` / `activiti:delegateExpression` on the definition), signal async, link name/source/target, activityRef/waitForCompletion, terminateAll/terminateMultiInstance | XML |
| Condition | sequence flow | Condition expression (JUEL editor with autocomplete of the process variables, JUEL keywords and functions), skip expression | XML |
| Data object | data object | Type (`xsd:*`), default value (`activiti:value`) | XML |
| Skip expression | user task, service task, flow | expression, plus a note on `_ACTIVITI_SKIP_EXPRESSION_ENABLED` | XML |

## C. Constructs that are hidden or rejected (lint error, with a fix)

| Construct | Why (evidence) | Modeler behaviour |
|---|---|---|
| `businessRuleTask` | NPE at deployment (R1 §0.1-2) | hidden; import -> lint error + quick fix "convert to Decision task" |
| `complexGateway` | becomes exclusive (R1 §0.1-4) | hidden; lint error, fix -> exclusive |
| `adHocSubProcess` | hangs (R1 §0.1-5) | hidden; lint error |
| Escalation, conditional, multiple, parallel event definitions | not parsed / degraded (R1 §0.1-8) | hidden; lint error |
| Signal start in event sub process; timer start in event sub process | broken / rejected (R1 §0.1-6) | replace menu omits; lint error |
| Signal end event | signal not thrown (R1 §0.1-7) | hidden; fix -> throw signal + none end |
| Link / compensate / escalation end | become none end | hidden |
| `serviceTask activiti:type` in `dmn`, `camel`, `mule` or other | skipped / class missing (R1 §0.1-3, §0.1-9) | not offered; lint error |
| Web service task (`##WebService`) | no CXF importer (R1 §0.1-9) | not offered; lint error |
| `standardLoopCharacteristics` | ignored (R1 §0.1-11) | loop marker hidden; lint error |
| `group` | dropped (R1 §0.1-11) | hidden (palette), lint warning on import |
| `camunda:*`, `zeebe:*` attributes or elements | silently ignored (R1 §0.1-1) | lint error per occurrence; Camunda importer converts |
| Groovy / other script formats | no engine on classpath (R1 §8.2) | lint error unless the project profile declares the engine |
| `sendTask` without mail | validator error (R1 §3.3) | not offered |
| Event-based gateway -> receive task | validator error | blocked by connection rules |
| Timer start / any typed start inside an embedded sub process | validator error | blocked |

## D. Lint rules (`bpmnlint-plugin-activiti` plus server validation)

1. **Client rules:** these mirror every `ProcessValidator` problem key (R1 §7), with the same severity (E/W) and the problem key shown in the message.
2. **Extra client rules:** these cover what the engine does not catch. They are L1–L20 in R1 §7.1, plus:
   - **L21:** an output-mapping target is not declared in `properties`.
   - **L22:** a mapping or constant is keyed to a missing element.
   - **L23:** the decision task references a missing DMN decision.
   - **L24:** a connector action is missing from `connectors/`, or a required connector input is unmapped.
   - **L25:** a `calledElement` key is not in the project (warning) or is not a valid key.
   - **L26:** `activiti:initiator` is used (info: host must set the authenticated user).
   - **L27:** a JUEL expression is malformed, for example `${` without its closing brace.
   - **L28:** a timer value is invalid ISO 8601 or cron.
   - **L29:** a DMN construct is not supported by the selected DMN engine profile (BKM or boxed context on Operaton).
   - **L30:** two message subscriptions with the same name can be active at the same time. Examples: an event sub process message start plus a boundary on the same message, a multi-instance message catch, or a catch without a correlation key in a process that is likely to run in parallel. `ProcessRuntime.receive` uses `singleResult()` and throws.
   - **L31:** `failedJobRetryTimeCycle` on a non-service task (ignored by the engine).
   - **L32:** `mapException` on an element other than an `activiti:class` service task or a call activity (ignored).
   - **L33:** a DMN output column without a `name` (no outbound variable).
   - **L34:** process keys and message-start names must be unique within the project.
   - **L35:** an MI `loopDataInputRef` / `loopDataOutputRef` that is not a plain variable name.
   - **L36:** an element uses a connector template whose version is outdated (template-update lint).
   - **L37:** a decision task leaves a decision input unmapped. FEEL evaluates a missing input as `null`, so this shows up silently as a no-match (ADR 0004).
   - **Beyond L37:** 35 rules from `docs/engine-findings.md`, for constructs the engine silently ignores or runs differently and for file hygiene. Examples: `juel-string-concatenation`, `signal-expression-with-declared-signal`, `signal-expression-catch-stale-subscription`, `signal-throw-async-drops-payload`, `auto-store-variables-no-effect`, `message-definition-field-ignored`, `timer-end-date-before-start`, `artifact-before-flow-element` and `undeclared-qname-prefix`. The full list, with evidence and fixes, is in `docs/user-guide/lint-rules/`. In total there are 155 rules: 111 errors, 36 warnings and 8 notes ([rule index](user-guide/lint-rules/index.md)).
3. **bpmnlint `recommended`:** enabled with these changes:
   - `no-inclusive-gateway` off;
   - `no-complex-gateway` error;
   - `ad-hoc-sub-process` error;
   - `event-sub-process-typed-start-event` on.
4. **Server validation:** `POST /api/dev/validate` is the engine's authoritative check (ADR 0007). It runs, on the exported files:
   - `RepositoryService.validateProcess`, which uses the engine's own validator set including the starter's;
   - a **trial deployment** into a scratch engine, which is deleted afterwards. This catches deploy-time failures such as the businessRuleTask NPE or a missing camel class;
   - a dry load of the extensions JSON through the runtime's own reader;
   - a parse of every DMN file by the configured evaluator.

   Problems come back with element IDs and are merged into the Problems panel. Async-executor warnings are labelled when the executor is off.

## E. DMN

| # | Feature | Notes | Corpus | Status |
|---|---|---|---|---|
| DM1 | DRD editing: decision, input data, BKM, knowledge source, information / knowledge / authority requirements, text annotation | dmn-js 18 | C17 | supported |
| DM2 | Decision table editing: inputs (label, expression, type), outputs (name, label, type, allowed `outputValues`), rules, annotations, copy/paste rows | dmn-js | C16 | supported |
| DM3 | Hit policies UNIQUE, FIRST, ANY, PRIORITY, RULE ORDER, OUTPUT ORDER, COLLECT (+ SUM, MIN, MAX, COUNT) | PRIORITY / OUTPUT ORDER via the connector extension (ADR 0004) | C16 | supported |
| DM4 | Literal expression decisions | FEEL | C17 | supported |
| DM5 | Required-decision chaining | evaluate the sink decision | C17 | supported |
| DM6 | Boxed expressions, BKM invocation, decision services | KIE profile only; lint L29 on Operaton | C17-kie | supported |
| DM7 | FEEL editor with variable suggestions (from DRD inputs and process variables) | `@bpmn-io/feel-editor` | - | supported |
| DM8 | Portable DMN output (1.3 namespace, `<variable>`, FEEL type names, inputData) | enforced on save and by tests | C16, C17 | supported |
| DM9 | Import DMN 1.1 / 1.2 (Activiti Modeling App, Camunda) through `@bpmn-io/dmn-migrate` | | N01, C17-dmn-migrated | supported |
| DM10 | "Test decision": evaluate with inputs from the modeler through the server, showing matched rules | `POST /api/decisions/evaluate` | C16 | supported |
| DM11 | Decision task wiring from BPMN: pick file and decision; inputs and outputs auto-mapped | §B Decision | C16 | supported |

## F. Editor and UX

| # | Feature | Based on | Status |
|---|---|---|---|
| U1 | App shell: project explorer, tabs (BPMN / DMN / JSON / scenario), dirty markers, close prompts, reopen last, `Ctrl+Tab` | - | supported |
| U2 | New-from-template (empty process, user-task approval, connector call, decision task, DMN table, DRD) | - | supported |
| U3 | Storage: browser workspace (IndexedDB), local folder (File System Access API where available), zip import/export, server workspace (modeler server), autosave and draft recovery, recent projects | - | supported |
| U4 | Palette, context pad, replace menu restricted to §A | bpmn-js | supported |
| U5 | Create / append anything (`N`, `A`) with categories and descriptions, restricted to §A | `bpmn-js-create-append-anything` | supported |
| U6 | Editing tools: lasso, space, hand, global connect, align/distribute, auto-place, auto-resize, snapping, label editing, copy/paste (cross-tab), duplicate, undo/redo, zoom/fit, move-to-origin | bpmn-js core | supported |
| U7 | Search (`Ctrl+F`) in BPMN and DRD | bpmn-js | supported |
| U8 | Minimap, grid | `diagram-js-minimap`, `diagram-js-grid` | supported |
| U9 | Colour picker | `bpmn-js-color-picker` | supported |
| U10 | XML source view (CodeMirror 6) with apply-back, error markers, and a JSON view for the extensions file | - | supported |
| U11 | Problems panel: list, counters in the status bar, canvas overlays, click to select element and focus the field, block deploy on errors | `bpmn-js-bpmnlint` | supported |
| U12 | Keyboard shortcuts (with an `event.code` fallback) and a help modal | - | supported |
| U13 | Export SVG / PNG, copy as image | bpmn-js, `bpmn-js-copy-as-image` | supported |
| U14 | Variable outline: readers and writers, highlight on canvas; JUEL autocomplete in expression fields | `@bpmn-io/variable-resolver` with our activiti adapter | supported |
| U15 | Connector catalog editor (`connectors/*.json`: actions, typed inputs and outputs) and generated element templates with chooser, apply, unlink | - | supported |
| U16 | Token simulation (gated by lint) | `bpmn-js-token-simulation` | supported |
| U17 | Camunda 7 to Activiti importer with loss report | R1 §5 | supported |
| U18 | Auto-layout for DI-less imports | `bpmn-auto-layout` | supported |
| U19 | Settings dialog, properties panel layout persistence, resizable panels, session restore | - | supported |
| U20 | bpmn.io watermark visible and un-overlapped on every canvas (checked by an E2E test) | bpmn.io licence | supported |
| U21 | Diagram diff (against the last deployed version) | - | not supported |
| U22 | Dark theme | - | not supported |
| U23 | macOS wrapper (Tauri) with file associations | - | not supported |
| U24 | Form editor (form-js) for `formKey` forms | - | not supported |
| U25 | Import-warnings panel and a fail-safe error tab when an editor cannot open a file | - | supported |
| U26 | Drag and drop files or a project zip onto the page | - | supported |
| U27 | Save As, Save All | - | supported |
| U28 | Panel toggles (`Cmd+P` properties, `Cmd+B` bottom panel) | - | supported |
| U29 | Documentation tooltips linking to Activiti docs and lint-rule pages; i18n hooks (only part of the interface text goes through them; only English ships) | - | partly supported |
| U30 | Append indicator on dangling flows; keyboard-operable palette | - | supported |
| U31 | Move to origin on save | - | supported |
| U32 | Headless rendering (SVG / PNG thumbnails for docs) | - | not supported |
| U33 | Decision-tester inputs remembered per DMN file | - | supported |

## G. Run and test from the modeler (through the modeler server)

| # | Feature | Status |
|---|---|---|
| R1 | Connection settings (server URL, user); health and engine info | supported |
| R2 | Deploy the project (BPMN + extensions + DMN), blocked on lint errors; show engine errors mapped to elements | supported |
| R3 | Start an instance (process picker, business key, typed variables editor, user) | supported |
| R4 | Instance view: active tokens and completed path highlighted on the canvas, variables, tasks, jobs | supported |
| R5 | Act on the instance: claim and complete tasks with variables, send messages and signals, trigger receive tasks, fire timers, execute jobs | supported |
| R6 | Scenario editor (form plus JSON) and runner with step log, pass/fail per assertion, and path overlay | supported |
| R7 | Record a scenario from an interactive run | supported |
| R8 | Decision tester (DM10) | supported |

## K. Distribution (ADR 0008)

| ID | Feature | Notes | Status |
|---|---|---|---|
| K1 | Open-source licence and notices | Apache-2.0 `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md` in the repo, the jar and every bundle | supported |
| K2 | Build from source with one command, needing only git (JDK fetched, Maven wrapper, Node fetched by Maven) | `./build.sh`, `./run.sh` | supported |
| K3 | Zero-argument start: default workspace, free-port fallback, browser opens, status window with Open / Quit | double-click friendly | supported |
| K4 | Desktop bundles with a bundled Java runtime: Linux x64, macOS arm64, macOS x64, Windows x64 | `jpackage` app images, zipped; CI tests the Linux bundle, the release workflow the others | partly supported |
| K5 | Docker image | GHCR; random admin password unless `MODELER_PASSWORD` | supported |
| K6 | Browser-only modeler on GitHub Pages | static build; run features need a server | supported |
| K7 | Release workflow on `v*` tags: verify, build, smoke-test every artifact on its OS, publish release with checksums | GitHub Actions; tested only by running it (a dry run publishes nothing) | partly supported |
| K8 | Embeddable starter: the modeler in a host app's pom, over its deployed models, in `view` or `edit` mode; never the dev endpoints (ADR 0009) | `activiti-modeler-spring-boot-starter`; proposed in ADR 0009 | not supported |

## H. Java runtime modules

| Module | Purpose |
|---|---|
| `activiti-dmn-connector` | `dmn-connector.EXECUTE_TABLE` bean, Operaton evaluator, PRIORITY / OUTPUT ORDER extension, DRD, deployment-scoped DMN lookup, `DmnEvaluationService` |
| `activiti-dmn-connector-kie` | optional KIE evaluator (full DMN), used as a conformance cross-check |
| `activiti-scenario-runner` | scenario model, JSON Schema, executor, matchers, path coverage check |
| `activiti-runtime-rest-core` | REST API safe for production (ADR 0007): definitions, instances (state, path, variables), history, tasks, messages, signals, jobs, timers, variables. The principal is the acting user. No `SecurityFilterChain`, configurable base path and roles |
| `activiti-runtime-rest-dev` | Dev-only endpoints (opt-in): validate with trial deploy, arbitrary deploy, scenario run, decision evaluate, workspace files |
| `activiti-modeler-server` | Spring Boot app that serves the modeler bundle, runtime REST core and dev, a file workspace API, sample connectors and a recording connector wrapper, GreenMail. Binds to localhost by default; shell tasks are opt-in. `java -jar` launches it and opens the browser |
| `verification-harness` | JUnit 5 dynamic tests over every corpus project (generated by the modeler), with one Spring context and one H2 database per project. Also covers DMN cross-engine checks, the Spring auto-deploy test (asserting resource names and keys), `model-expect.json` checks, path coverage and round-trip tests. Runs any folder with `scenarios/` (`verify <dir>` CLI) |

## J. Verification corpus

Each corpus project has a seed written (or, for a migrated or imported file, reviewed) by hand, hand-written oracles (scenarios covering every path, `model-expect.json`) and a `build.ts` that builds the same project through the modeler ([ADR 0005](adr/0005-scenario-format.md)). N01 is hand-written only. A project holds BPMN, extensions and, where relevant, DMN.

| ID | Project | Exercises |
|---|---|---|
| C01 | user-tasks | T1 all assignment forms (incl. `humanPerformer`, `potentialOwner`, `customResource`, `owner`, `category`, `businessCalendarName`), dueDate under a fixed clock, priority, formKey, task listeners, `skipExpression` with and without `_ACTIVITI_SKIP_EXPRESSION_ENABLED`, candidate starters (asserted in `model-expect.json` and identity links); MI user task parallel/sequential with collection, element variables, completion condition; mappings to and from task-local variables |
| C02 | service-tasks | T2–T5: class + fields, expression + result variable, delegate expression, connector with VALUE / VARIABLE / JSONPATCH / MAP_ALL / constants / ephemeral (inbound asserted with `expectConnectorCall`); async with `exclusive=false` |
| C03 | script-tasks | T9 juel, javascript, result variable, script reading and writing variables |
| C04 | gateways | G1–G4, F1–F2: every branch, defaults, inclusive join, event-based (timer vs message) |
| C05 | timers | E2 (date, cycle with `endDate`, cron), E12, E21 interrupting and non-interrupting (repeat), all under a fixed clock |
| C06 | messages | E3, E6, E11 (with a custom throw delegate), E13, E20, E23, correlation keys, payload mappings; the same-name subscription case (L30), asserting the engine's actual behaviour |
| C07 | signals | E4, E14, E17 (incl. `activiti:async` signal), E24, global vs processInstance scope |
| C08 | errors-compensation | E5, E8, E18, E22, E26, `mapException` (class delegate and call activity, plus a negative case on a delegate expression), `BpmnError` from a script and from a connector, error start event sub process |
| C09 | transactions | S3, E10, E25 (with compensable work) |
| C10 | sub-processes | S1, MI sub process (with `loopDataOutputRef` aggregation and early completion condition), local data objects, E9 terminate (`terminateAll`, `terminateMultiInstance`) |
| C11 | call-activities | T14: in/out, sourceExpression, inheritVariables, businessKey, `inheritBusinessKey`, mapping, `calledElement` expression, MI call activity, child process in the same project (asserted with `expectChildInstance`) |
| C12 | misc-flow | E15/E16/E19 links, T11 receive, T12 manual, T13 task, F3 implicit split |
| C13 | listeners | execution listeners on process, nodes and flows (all impl types), task listeners (all events), event listeners (class, delegateExpression, throwEvent) |
| C14 | mail-shell | T7, T8, T10 with GreenMail; `ignoreException` path |
| C15 | data-properties | process properties of every type with defaults, required-variable rejection, type validation, data objects of every `xsd` type |
| C16 | dmn-hit-policies | one table per hit policy and aggregator; decision task in a process; no-match path |
| C17 | dmn-drd | required decisions, literal expression, inputData; KIE-only variant (C17-kie) |
| C17-dmn-migrated | dmn-migrated | DM9: a DMN 1.1 and a DMN 1.2 file, migrated by the modeler, evaluated on the engine, directly and from a decision task |
| C18 | collaboration | 2 executable pools, lanes, message flows, annotations, data store references, a **coloured** model (`bioc:`/`color:` attributes) |
| C19 | retries-incidents | failing service task with `failedJobRetryTimeCycle` (`failJobUntilDeadLetter`), a non-service async element keeping the default 3 retries, a synchronous failure rolling back (`expectFailure`), dead-letter job asserted |
| C20 | business-scenarios | three realistic projects built with the modeler's default mappings: loan origination (`C20-loan`: a call activity, a decision task, a message and a timer escalation), order fulfilment (`C20-order`: connector tasks from templates, compensation, signals) and an insurance claim (`C20-claims`: a DMN triage, a multi-instance review, an event sub process) |
| C21 | coverage-extras | the variants no other project asserts: E2 `timeDuration` start, P1 `activiti:potentialStarter`, T15 `activiti:extensionId`, `MAP_ALL_INPUTS` / `MAP_ALL_OUTPUTS` on a connector and a user task (T1, T5), T16 multi-instance on service (expression, connector) and script tasks (parallel and sequential, collection and cardinality, `loopDataOutputRef`). Hand-written seed, also generated by its `build.ts` |
| C22 | camunda-import | U17: Camunda 7 models converted by the importer and run on the engine |
| N01 | negative-and-import | every §C construct: lint error in the modeler **and** the documented engine outcome; Camunda-modeler XML imported and converted; DMN 1.1 migrated |
