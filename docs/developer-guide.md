# Developer guide

How to build, test and extend the project.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| JDK | 25 | Activiti 9.x is Java 25 bytecode. `scripts/setup-jdk.sh` installs Temurin 25 into `.tools/jdk-25` when `java` is older |
| Maven | 3.9+ | The enforcer plugin fails the build on a JDK older than 25 |
| Node | 22+ | npm 10+ |
| Chromium for Playwright | matching `@playwright/test` 1.63.0 | `cd modeler && npx playwright install chromium` (CI uses `--with-deps`) |

To only build and run the modeler you need none of this: `./build.sh` fetches the JDK, and Maven downloads Maven and Node (see [Distribution](#distribution)). The table is for working on the code.

Set up the shell with `source scripts/env.sh`; it puts `.tools/jdk-25` on `JAVA_HOME` and `PATH` when present. Every command below assumes the repository root as the working directory.

## Everything at once

```bash
scripts/verify-all.sh
```

It stops at the first failing section and names it. The sections are:

1. toolchain versions
2. `mvn -B -f java/pom.xml verify`
3. `compat-check/run-matrix.sh` (skip with `SKIP_COMPAT_CHECK=1`)
4. `npm ci` in `modeler/`
5. typecheck and lint
6. Vitest unit tests
7. production build of the app
8. Playwright UI tests

CI (`.github/workflows/ci.yml`) installs JDK 25, Node 22 and Chromium, then runs this script. A second job, `verify-activiti8`, installs JDK 21 and Node 22 and runs it as `ACTIVITI_LINE=8 scripts/verify-all.sh` on Spring Boot 3.5.16 (what ships) and on `BOOT_VERSION=3.5.7` (Activiti 8.8.1's own baseline, a compatibility run): the second target, Activiti 8.8.1 on JDK 21 ([ADR 0002](adr/0002-runtime-target.md)).

**The second target, locally.** `ACTIVITI_LINE=8 scripts/setup-jdk.sh` installs Temurin 21 into `.tools/jdk-21` (`REQUIRED_MAJOR=21` or `scripts/setup-jdk.sh 21` do the same); `ACTIVITI_LINE=8 source scripts/env.sh` selects it (without `ACTIVITI_LINE`, `env.sh` selects JDK 25 as before). `ACTIVITI_LINE=8 scripts/verify-all.sh` (Spring Boot 3.5.16; add `BOOT_VERSION=3.5.7` for the baseline) then adds `-Pactiviti8` to every Maven call and asks the toolchain check for JDK 21 or newer. The npm sections are the same, except Playwright (section 8), which is skipped: it tests the modeler app and the modeler server, which ship on 9.0.0. In `compat-check`, `ACTIVITI_LINE=8` runs only the 8.8.1 row.

## Java (`java/`)

```bash
mvn -B -f java/pom.xml verify                                   # build and test all modules
mvn -B -f java/pom.xml -pl activiti-modeler-server -am test     # one module and what it depends on
mvn -B -f java/pom.xml verify -Dactiviti.version=9.0.0 -Dspring-boot.version=3.5.7   # another version combination
```

### Layout

| Module | Package | Contents |
|---|---|---|
| `activiti-dmn-connector` | `io.github.kleash.activiti.dmn` | the `dmn-connector.EXECUTE_TABLE` connector bean, the Operaton evaluator, the PRIORITY / OUTPUT ORDER extension, DRD evaluation, the deployment-scoped DMN lookup, `DmnEvaluationService` ([ADR 0004](adr/0004-dmn-execution.md)) |
| `activiti-dmn-connector-kie` | `io.github.kleash.activiti.dmn.kie` | the optional KIE evaluator (full DMN), also used for the conformance cross-check |
| `activiti-scenario-runner` | `io.github.kleash.activiti.scenario` | the scenario model, its loader and JSON Schema, the runner, matchers, the job drivers, the path coverage check ([ADR 0005](adr/0005-scenario-format.md)) |
| `activiti-runtime-rest-core` | `io.github.kleash.activiti.rest.core` | the production-safe REST API: definitions, instances, history, tasks, messages, signals, jobs, timers, variables ([ADR 0007](adr/0007-runtime-rest-split-and-security.md)) |
| `activiti-runtime-rest-dev` | `io.github.kleash.activiti.rest.dev` | the opt-in dev endpoints (`activiti.rest.dev.enabled`): validate with a trial deployment, deploy, scenario run, decision evaluation, workspace files |
| `activiti-modeler-server` | `io.github.kleash.activiti.modeler` | the Spring Boot app that serves the modeler, both REST parts, the file workspace, sample connectors and GreenMail; dev security, binds 127.0.0.1. The runnable jar is `target/activiti-modeler-server-<version>-exec.jar` (the classifier `exec`), next to the plain jar |
| `verification-harness` | `io.github.kleash.activiti.harness` | the JUnit 5 dynamic tests over every corpus project, the N01 engine oracle, the `verify <dir>` command |

### Parent pom (`java/pom.xml`)

- Group `io.github.kleash.activiti`, version `0.1.0-SNAPSHOT`.
- `java.release` 21 (every module compiles to Java 21 bytecode, so the jars run on both Activiti lines; not `java.version`, a JVM property the enforcer reads), `spring-boot.version` 3.5.16, `activiti.version` 9.0.0, all overridable on the command line.
- Profile `activiti8`: `activiti.version` 8.8.1 and a JDK 21 minimum for the build (`mvn -Pactiviti8 verify`, on Spring Boot 3.5.16 like the default build; `-Dspring-boot.version=3.5.7` is the baseline compatibility run; the scripts take `ACTIVITI_LINE=8`). Surefire hands `expected.activiti.version` to the tests that check the engine report.
- The Alfresco repository is the only source of Activiti 8.x/9.x (Maven Central stops at 7.1.0.M6). Snapshots are off.
- `dependencyManagement` imports `jackson-bom` and `log4j-bom` first (security overrides), then `spring-boot-dependencies`, then `activiti-dependencies`, so Spring Boot's versions win over Activiti's and the two security BOMs win over Spring Boot's. Direct entries for Tomcat, `commons-lang3`, `jakarta.mail` and `assertj-core` follow; each says which advisory it fixes and when to delete it (the OSV scan, below, is what proves them).
- `spring-boot-starter-test` (JUnit 5, AssertJ) is a test dependency of every module.
- The enforcer plugin requires JDK 25 or newer (21 or newer with `-Pactiviti8`): the range is the property `enforcer.java.range`.

### Embedding Activiti: what a host app needs

Proven by `compat-check/` and `verification-harness`:

- `activiti-spring-boot-starter` plus `spring-boot-starter-security`, `-jdbc`, `-json` or `-web`, and a database driver (H2 here). The starter declares them optional.
- A `UserDetailsService` bean. `ProcessRuntime` and `TaskRuntime` need an authenticated user with `ROLE_ACTIVITI_USER`; groups are `GROUP_<name>` authorities.
- `spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn,**.dmn`, `spring.activiti.deployment-mode=default`, `spring.activiti.history-level=full` and `spring.activiti.db-history-used=true`. The harness and the server set all four.
- `ProcessRuntime` does not copy the Spring Security user into the engine: call `org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(...)` for `activiti:initiator`.
- `ProcessEngine.VERSION` is stale in 9.0.0 (it says 8.1.4). Read the version from `META-INF/maven/org.activiti/activiti-engine/pom.properties`, as `EngineInfo` does.

### Add a Java module

1. Create `java/<name>/` with `pom.xml` whose parent is `io.github.kleash.activiti:activiti-modeler-parent:0.1.0-SNAPSHOT` (copy a small module's pom).
2. Add `<module><name></module>` to `java/pom.xml`.
3. Put code under `io.github.kleash.activiti.<area>` and tests in `src/test/java`.
4. Depend on sibling modules with `${project.version}`. Take third-party versions from the BOMs; add a version only when neither BOM manages the artifact.
5. Document it in the table above.

## Modeler (`modeler/`)

```bash
cd modeler
npm ci                  # install exactly what package-lock.json says
npm run dev             # app on http://localhost:5173
npm run typecheck       # tsc in every workspace and in e2e/
npm run lint            # ESLint
npm test                # Vitest in every workspace
npm run build           # production build of the app (modeler/app/dist)
npm run e2e             # Playwright: builds, serves with `vite preview`, runs e2e/*.spec.ts
npm run corpus:build    # drives the modeler to generate the corpus projects (see "Corpus builds" below)
npm run verify          # all of the above, in order
npm test -w @activiti-modeler/activiti-project              # one workspace
npx playwright test --headed                                # watch the UI tests
```

### Layout

| Path | Contents |
|---|---|
| `packages/activiti-moddle` | `activiti:` namespace constants and moddle descriptor |
| `packages/bpmn-js-activiti` | bpmn-js `moddleExtensions` and the Activiti module: support matrix, behaviours, extensions store, property accessors, `DiagramBuilder`, export pipeline |
| `packages/bpmnlint-plugin-activiti` | the lint: 155 bpmnlint rules (`activiti/...`), the `activiti:recommended` config, the project lint (`lintProject`), the bpmn-js module with the quick fixes, the server-validation merge and the `activiti-lint` command |
| `packages/activiti-variable-resolver` | the variables a process defines and uses, and those a JUEL expression reads |
| `packages/activiti-project` | project files: layout, extensions sidecars and their runtime-known field list (`runtime-model.ts`), serializer checks (`verify.ts`), semantic diff of seed and generated models (`semantic-diff.ts`); the project model and workspace (`project/`: paths, dirty state, templates, drafts) and the storage adapters (`storage/`: IndexedDB, File System Access, server workspace, memory, zip) |
| `packages/activiti-diagram-viewer` | the read-only BPMN and DMN viewers of the run views, with token and path overlays |
| `packages/runtime-client` | the typed client of the runtime REST API, with pluggable authentication |
| `app/` | Vite + React 18 shell: `state/` (the `AppController`, layout, shortcuts, the editor registry), `components/` (explorer, tabs, menus, dialogs, panels), `editors/` (the BPMN editor with XML and JSON views, the text editor, the error view), `properties/` (the Activiti properties panel, below) |
| `e2e/`, `playwright.config.ts` | Playwright tests against the production build |
| `e2e/corpus/`, `playwright.corpus.config.ts`, `scripts/corpus-build.mjs` | the corpus build runner (`npm run corpus:build`) |

Packages are named `@activiti-modeler/<name>` and consumed **from source**: their `exports` point at `src/index.ts`, and Vite compiles them. There is no per-package build step.

### Corpus builds

`corpus/<id>/build.ts` models the hand-written seed of `corpus/<id>/seed` through the real modeler: Playwright opens the production bundle (built with `VITE_MODELER_TEST_API=true`), the build calls `window.__modelerTestApi` through the typed `ModelerApi` wrapper (`modeler/e2e/support/modelerApi.ts`), and every call goes through the same property accessors and diagram-js commands as the UI. The runner then exports with the real export pipeline and compares the result with the seed.

```bash
cd modeler
npm run corpus:build                 # every corpus/<id>/build.ts
npm run corpus:build -- C04          # one project (id prefix); C04,C10 for several
CORPUS_OUT=/tmp/generated npm run corpus:build -- C12    # another output folder
```

Each project is written to `java/verification-harness/target/corpus/<id>/` (`project.json`, `processes/`, `connectors/`), where the harness finds it: `ProjectDiscovery.generated` pairs it with the hand-written oracles in `corpus/<id>/` (`scenarios/`, `model-expect.json`). The build never generates oracles.

**Through the real UI.** A build that exports `uiDriven = true` (C01, C02, C04, C08, C11, C16, C20-loan) runs a second time through `UiModeler` (`modeler/e2e/support/uiModeler.ts`), with Playwright's mouse and keyboard: File > New project, the Settings dialog (no default mappings), File > New file (empty process, DMN decision table), the explorer (delete a file), the palette and its create menu, the context pad (connect, replace, delete), the resize handle, the properties panel (ids in the General group), the DRD palette, context pad and panel, and the decision table (hit policy, column editors, rules and cells). Connector descriptors are dropped on the page as files. Such a build calls only `CorpusModeler`, the methods both drivers have. The project is exported with File > Export project as zip into `java/verification-harness/target/corpus-ui/<id>/` (next to `CORPUS_OUT` when it is set), compared with the seed like the other build and run by the harness as `C04-gateways [ui]` (`ProjectDiscovery.ui`). What the panel or the table has no field for is typed into the XML tab of the editor (search and replace of the code editor): the ids of DMN rules (dmn-js has none) and the output collection of a multi-instance call activity (not offered on purpose, engine finding C11.1). An exception mapping on a delegate expression task (C08, lint L32) is added while the task is a Java class for a moment, and an event sub process is the palette's expanded sub process with its start event, both changed in the replace menu (no start event can be created in an event sub process). `npm run corpus:build -- C04 --grep='\[ui\]'` runs only the UI build of C04, `--grep-invert='\[ui\]'` leaves the UI builds out.

Run the harness on the generated projects with the seeds next to them:

```bash
source scripts/env.sh
mvn -B -f java/pom.xml -pl activiti-scenario-runner,verification-harness -am verify -Dharness.projects=C04,C10,C12
```

The summary prints `C04-gateways [generated] / auto-deploy` and `/ programmatic` lines beside the `[seed]` ones, and `[ui]` lines for the projects built through the UI. (`scripts/verify-models.sh <dir>` takes a folder that holds its own `scenarios/`, so it does not apply to a generated project, whose oracles live in `corpus/<id>/`.)

A build file default-exports `async (api: ModelerApi) => void`. It starts with `api.createProject(name, { defaultMappings: 'none' })` when the seed lists exactly the mappings it needs (new user tasks, call activities and catch events otherwise get `MAP_ALL`, ADR 0006), creates each process with `api.newProcess(id, name, { file })` (`file` is the seed's file name without `.bpmn20.xml`), and models it with `createShape`, `connect`, `setProperty(elementId, accessorKey, value)` and `setExtensions`. Positions come from `corpus/support/layout.ts`; the seeds carry no layout. Data objects are declared on their container with `setProperty(processOrSubProcessId, 'data.objects', [{ id, name, type, value }])` and have no shape: Activiti 9 reports the diagram shape of a drawn data object reference as `DI_INVALID_REFERENCE`, and the harness accepts no validator warnings (the export warns about a drawn one). A build may also export `semanticDiff = { ignoreElements, allow: [{ pattern, reason }] }` to declare differences from the seed that are intended; they are reported but do not fail the run. A build may export `exportWarnings = [{ pattern, reason }]` for export warnings it expects (C18 draws a data object reference on purpose). Collaborations: the first `participant` created in an open process takes that process over (bpmn-js turns the diagram into a collaboration), later pools bring their own with `process: { id, name, documentation }`, `blackBox: true` makes a pool without a process; `createLane(pool, { id, name, first })`, `removeElements`, `addRootElement('dataStore', ...)`, `setModdleProperty(id, 'messageRef' | 'dataStoreRef' | 'id', value)` (`<pool>#laneSet` addresses the lane set), `setColor` and `addExtensionElement` cover what the properties panel has no accessor for. (bpmn-js keeps the text annotations of a collaboration and their associations in the collaboration, also those drawn in a pool; Activiti reads the artifacts of a process only, so the export writes an annotation that lies inside a pool into the process of the pool: `exportProcess`, engine finding C18.7.) `importXml(xml, extensionsJson, { file })` opens a hand-written BPMN file as the editor would (C21 `mi-standard-form`).

After exporting, the runner compares every generated process with its seed (`diffBpmn`, `diffExtensions` in `packages/activiti-project/src/semantic-diff.ts`): ignored are the diagram, attribute order, namespace prefixes, `incoming`/`outgoing`, the ids of event definitions the seed leaves out, defaults (`isSequential="false"`, `required: false`) and the generated ids of process variables, which are compared by name. Kept are element ids, names, attributes, conditions, listeners, the order of the flows that leave a source (it decides which condition wins), message and link references and the whole extensions semantics. A difference fails the run with its element path.

### The extensions JSON and the Activiti 9.0.0 model classes

Activiti reads `<name>-extensions.json` with the host's `ObjectMapper`; a host without Spring Boot's JSON auto-configuration rejects unknown fields. The modeler therefore writes only the fields of `ProcessExtensionModel`, `Extension`, `VariableDefinition`, `ProcessVariablesMapping`, `Mapping`, `ProcessConstantsMapping`/`ConstantDefinition`, `TemplatesDefinition`, `TaskTemplateDefinition`, `TemplateDefinition` and `AssignmentDefinition`, listed with their Java classes in `packages/activiti-project/src/runtime-model.ts`. Fields of an imported file that are not on the list (the APA-style top-level `name` and `type`) give an import warning, are kept in memory, are dropped on export and reported in the export warnings. The list is checked on every test run against `packages/activiti-project/support/activiti-model-fields.json`, a snapshot of the JavaBean properties of those classes. Regenerate or verify the snapshot with the unpacked 9.0.0 source jars of `activiti-spring-process-extensions` and `activiti-connector-model` (one folder each below one root): `npm run generate:model-snapshot -w @activiti-modeler/activiti-project -- --sources <root>` (add `--check` to only compare). With `ACTIVITI_MODEL_SOURCES=<root>` set, `npm test` also proves the committed snapshot against the sources.

`activiti:field` (field injection) is read by Activiti 9.0.0 both inside `extensionElements` and as a direct child of a service task, send task or message event definition. The moddle imports both forms without a warning; the editor moves direct children into `extensionElements` on import, and that is the form it exports. The checklist entries for `field` say so (regenerate with `npm run generate:checklist -w @activiti-modeler/activiti-moddle`; it needs the converter and engine sources).

### The properties panel (`app/src/properties/`)

The panel is `BpmnPropertiesPanelModule` (the host that renders groups) plus one provider of ours, `ActivitiPropertiesProvider` (`provider.ts`). The generic BPMN provider and the Camunda and Zeebe providers of `bpmn-js-properties-panel` are not loaded (ADR 0001): they write the model directly. Nothing in the panel touches the model: every entry reads and writes through the `propertyAccessors` service (`PanelEnv.get` / `PanelEnv.write`), so what a user types goes through the code that `window.__modelerTestApi` and the corpus builds use, with the same validation and one undo step per change. An accessor that refuses a value throws `AccessorError`; the panel shows its message under the field (through `propertiesPanel.setDiagnostics`) until the next change.

- `groups/*.ts` build the groups from the accessors that apply to the element (`env.has(element, key)`), so a group appears exactly where the support matrix and the accessors allow it. `provider.ts` `groupsFor` lists them in display order.
- `builders.ts` makes entries (`text`, `select`, `checkbox`, `juel`, `rows`, `info`, ...) from an accessor key; the `*Raw` variants take a value and a commit function for list items.
- `components/` has the Preact components that the library does not have (JUEL editor `JuelEntry`, `RowsEntry` for field and parameter tables, `ItemTools`, `EventTypesEntry`). Files that contain JSX start with `/** @jsxImportSource @bpmn-io/properties-panel/preact */` because the panel is Preact and the app is React; hooks come from `@bpmn-io/properties-panel/preact/hooks`.
- A row that is not complete yet (a field without a value, a parameter without a target) is kept in the entry and written when it is complete; listeners may exist with an empty implementation while they are filled in.
- `help.tsx` holds the tooltips (`HELP`: group id or entry id to text, engine note and the page of `docs/user-guide/properties/`). A test checks that each page exists.
- `layoutStore.ts` persists which groups are open in `localStorage` (`activiti-modeler.properties-layout.v1`).

**Entry ids.** Every entry has a stable `data-entry-id`; the ids are the contract with the tests and with lint:

| Id | Meaning |
|---|---|
| `<accessor key>` | an entry backed by that accessor: `user.assignee`, `flow.condition`, `timer.definition.value`, `impl.class` |
| `<accessor key>.<part>` | a part of a structured value of that accessor: `timer.definition.type`, `timer.definition.endDate` |
| `<list key>[<i>]` | a list item (`listeners.execution[0]`, `definitions.messages[1]`, `data.objects[0]`) |
| `<list key>[<i>].<field>` | a field of a list item: `listeners.execution[0].class`, `definitions.signals[0].scope`, `listeners.task[2].fields` |
| `<key>.hint`, `.preview`, `.usage` | read-only notes (engine caveats, timer preview, reference counts) |
| `mail.<name>`, `shell.<name>` | the fields of mail and shell tasks |

Group ids are listed in `help.tsx` (`general`, `documentation`, `starters`, `messages`, `signals`, `errors`, `eventListeners`, `executionListeners`, `taskListeners`, `startInitiator`, `userAssignment`, `form`, `implementation`, `fields`, `mail`, `shell`, `script`, `calledElement`, `multiInstance`, `async`, `job`, `errorMapping`, `timer`, `message`, `signal`, `error`, `link`, `compensation`, `terminate`, `condition`, `skip`, `dataObjects`, `dataObject`).

**The extensions groups.** `groups/variables.ts`, `mapping.ts` (mapping and constants), `decision.ts` and `template.ts` render the groups of FEATURE_MATRIX §B that write the extensions JSON; they use the same accessors (`variables.list`, `variables.usage`, `mapping.*`, `constants.values`, `decision.pick` / `decision.info`, `template.*`). Their entry ids follow the scheme: `variables.list[0].name`, `mapping.inputs[1].value`, `constants.values[0].name`, `decision.pick`, `decision.pick.actions` (buttons `decision.pick.actions.inputs` and so on), `template.info` (buttons `template.info.choose`, `.update`, `.unlink`), `impl.connector.pick`. `RowsEntry` takes `suggest` (a `datalist`, `data-suggestions-for="<cell id>"`), an `area` cell, `advanced` columns behind "More fields" and `confirmRemove` (the "Delete anyway" step); a row that is not complete keeps its last complete version in the model (each row has an internal `_k`). A change of the extensions file alone changes no diagram element, so the provider re-renders the panel on `activiti.extensions.changed` and `activiti.project.changed`.

**The project catalog and element templates.** The `projectCatalog` service of a modeler (`bpmn-js-activiti`) holds the connector definitions, the DMN decisions (with inputs, outputs, hit policy) and the process ids of the project; the host fills it: `app/src/catalog.ts` (`CatalogBuilder`, cached per file text) from the workspace working copies in the BPMN editor, and `window.__modelerTestApi.addConnector` / `setConnector` / `removeConnector` / `addDmn` in tests. The `elementTemplates` service (`getLatest`, `applyTemplate`) and `elementTemplatesLoader` implement the contract of `@bpmn-io/element-template-chooser`, which `editors/modeler.ts` loads; everything they write goes through the `template.*` accessors. Templates are generated by `buildTemplates(connectors)` (`modules/templates/templates.ts`); the id is `<connector>.<ACTION>` or `builtin/<kind>`, the version the connector's version (`project.json`, `connectors.<name>.version`; `CatalogBuilder` merges it into the connector model with `parseConnectorModel(file, name, meta)`), and the link on the task is `activiti:templateId` / `activiti:templateVersion` (extension attributes, read by lint rule L36). The connector file model and its validation are `activiti-project/src/connectors.ts`: `serializeConnector` writes only the fields of the runtime's `ConnectorDefinition` / `ActionDefinition` / `VariableDefinition` (ADR 0003), `connectorMetaOf` / `readConnectorMeta` / `writeConnectorMeta` move the rest to `project.json`, and `splitConnectorFile` / `normalizeConnectorFiles` do that for imported files (zip import, dropped files, `assembleProject`, the zip export); the catalog editor is `app/src/editors/ConnectorEditor.tsx`. `ModelerApi.newProcess(..., { omitExtensions: true })` exports a process without its sidecar (the bare called process of C11).

**Focusing an entry from lint.** The Problems list dispatches a window event; the app selects the element, opens the groups around the entry and focuses it:

```ts
window.dispatchEvent(new CustomEvent('activiti.lint.focus', { detail: { elementId: 'review', entryId: 'user.assignee' } }));
```

`entryId` is optional (without it the element is only selected). The handler is `PropertiesFocus` in `app/src/components/PropertiesSlot.tsx` over `focusPanelEntry` (`focus.ts`), which waits for the panel to draw the entry.

**Expression sources.** The JUEL editor completes the process variables of the extensions store and of the diagram, the JUEL keywords and functions. Other completions plug in with `registerExpressionSource({ id, suggest({ kind, owner, prefix, element }) })` (`sources.ts`): `kind: 'identifier'` asks for names at the start of an operand (Spring bean names), `kind: 'member'` with `owner: 'vars'` for `${vars.X}`. No such source ships with the modeler; a source that throws is skipped.

**Tests.** `provider.test.ts` (Vitest, jsdom) checks the groups per element type, the entry id scheme and the help pages; `juel/syntax.test.ts` and `validation/timer.test.ts` cover the expression parser and the timer validation. `e2e/properties/*.spec.ts` drive the real panel with Playwright: every test title starts with the FEATURE_MATRIX section B group name, types or selects in the panel, asserts the exported XML and checks that undo restores it (`e2e/properties/support.ts` has the helpers).

### Lint and the Problems panel

Package `packages/bpmnlint-plugin-activiti`; the user's view is [Problems panel](user-guide/modeler-basics.md#problems-panel), the rules are in [`docs/user-guide/lint-rules/`](user-guide/lint-rules/index.md) (generated from the rule catalog by `npm run docs:generate -w @activiti-modeler/bpmnlint-plugin-activiti`; a test fails when a page differs from the catalog).

**Rules.** `defineRule({ id, tag, key?, severity, title, why, evidence, howToFix, quickFix?, entry?, serverKeys?, check, bad, good })` (`src/define.ts`) builds a bpmnlint rule from one record that also feeds the documentation and the tests: `rules.test.ts` runs the `bad` fixtures (each must report exactly the listed element ids at the rule's severity, with the engine key in the message) and the `good` ones (nothing) for every rule. The rules are in `src/rules/`: `validator-*.ts` (one rule per `ProcessValidator` problem key, the same severity, the key in the message, `ENGINE_PROBLEM_KEYS` is the list from the jar), `hidden.ts` (what the support matrix hides, derived from it), `foreign.ts`, `expressions.ts`, `extensions.ts` (the cross-document rules), `traps.ts` (engine findings), `file-rules.ts` (DMN and sidecar files). A rule's `entry` is an accessor key: the field of the properties panel the problem is about (`catalog.test.ts` checks it). The bpmnlint core rules are bundled statically (`core-rules.ts`) with the tuning of `activiti:recommended` in `linter.ts` (`CORE_TUNING`: the four of the feature matrix plus the style rules downgraded to warnings, because an error blocks a deployment).

**Cross-document rules** read the lint context, not the files: `ctx.extensions` (the extensions file of the document), `ctx.project` (`ProjectIndex`: the processes, connectors, DMN decisions, message catches of all files), `ctx.unresolved` / `ctx.duplicateIds` (moddle's import warnings), `ctx.text` (the file text, for the rules about what the parser normalises), `ctx.asyncExecutorActive`, `ctx.scriptEngines`. `setLintContext(definitions, ctx)` attaches it to the parsed definitions; `lintProject` and the bpmn-js module do that.

**The project lint.** `lintProject(files, options?)` is the public entry point, and the gate a deployment passes (the deployment calls it through `lintService.checkDeployable()` and does not deploy when `deployable` is false):

```ts
import { lintProject } from '@activiti-modeler/bpmnlint-plugin-activiti';

const { problems, byFile, counts, deployable } = await lintProject(files /* ProjectFile[]: processes/*.bpmn20.xml, *-extensions.json, *.dmn, connectors/*.json */, {
  asyncExecutorActive: true,   // false: the async-executor warnings apply
  scriptEngines: ['groovy'],   // JSR-223 engines the application provides
  dmnProfile: 'operaton',      // or 'kie'
  only: ['processes/a.bpmn20.xml'], // lint just these paths (the others still count as context)
});
```

A `Problem` is `{ id, path, elementId?, rule: 'activiti/<id>' | 'bpmnlint/<name>', key?, severity: 'error' | 'warning' | 'info', message, source: 'client' | 'engine', entryId?, fix?: { id, label }, documentationUrl?, data? }`. `deployable` is `counts.error === 0`. A file the parser cannot read is the error `activiti/bpmn-unreadable`; a process without a sidecar is linted as if it had an empty extensions file.

**The editor module** (`@activiti-modeler/bpmnlint-plugin-activiti/editor`, `ActivitiLintModule`, depends on `bpmn-js-bpmnlint`): replaces the lint run of `bpmn-js-bpmnlint` by the Activiti rules over the live definitions and the live extensions store, debounced (`activitiLint.delay`, 350 ms) after `commandStack.changed`, `activiti.extensions.changed` and the import. Events on the bpmn-js event bus: `activiti.lint.completed { problems }` after every run, and `activiti.lint.focus { elementId, entryId?, rule? }` when the user clicks a problem on the canvas or in the panel (the elements are selected first). The app (`app/src/lint/LintService.ts`) forwards the second as the window `CustomEvent` that the properties panel handles (see above): `entryId` is an accessor key, and a key that the panel has no entry for only selects the element. `LintService` is the one object the UI talks to: it lints the open diagrams through their editors and the other files through `lintProject`, keeps a merged snapshot (`useLint()`), opens a file for a click, and applies a fix in the editor of the file.

**Quick fixes** (`src/editor/fixes.ts`): a rule names a fix (`quickFix`, labels in `fix-ids.ts`); `applyFix(injector, problem)` runs it as one `activiti.batch` command, so the diagram and the extensions store change together and one Undo takes it back. A fix that fails is undone. Nothing is selected while a fix replaces shapes.

**Server validation** (`src/server.ts`): `ServerValidator { validate(files) }`, adapted from `RuntimeClient.devValidate` by `runtimeClientValidator(client)`; `lintService.setServerValidator(...)` connects one (the mock in `window.__modelerLint.connectMockServer` for the tests). `mergeServerProblems` tags the server's problems `engine` and drops one that has the same key (or a key in the rule's `serverKeys`) on the same element as a client problem.

**Command line.** `activiti-lint <folder>` (`bin/activiti-lint.mjs`, built from `src/cli.ts` by `npm run build:cli`, a single bundle with the workspace packages inlined): see the [rule index](user-guide/lint-rules/index.md#command-line). `npm run lint:corpus` lints every corpus seed and fails on any error except the four intended ones (`scripts/lint-corpus.mjs`): the harness connector `bpmnerror.EXECUTE` of C08 is in no catalog, and C17-dmn-drd-kie is KIE-only DMN. Warnings are listed, not judged: the hand-written seeds leave events and flows unlabeled and some user tasks without a mapping.

**Negative corpus** `corpus/N01-negative/`: `models/*.bpmn20.xml` are small hand-written models, one per hidden construct and engine trap; `expected-lint.json` is the oracle (file to expected `rule@elementId`, the context files and the problems that remain after the quick fixes); its README says what the engine does with each. `src/n01.test.ts` (rules), `src/editor/n01-fixes.test.ts` (fixes in a jsdom modeler), `src/cli.test.ts` and `e2e/n01.spec.ts` (import through drag and drop, the Problems panel, quick fixes, export and re-import) all read the same oracle.

**Tests.** Vitest in the plugin package (rules, catalog invariants, docs freshness, server merge, editor module, quick fixes, N01, CLI) and `e2e/problems.spec.ts` (U11: the tab, counters, overlays, click to focus, filters, project-wide lint, live lint, an undoable fix, the server merge and the deploy gate).

### Editing features

| Feature | Where | Notes |
|---|---|---|
| Create / append menus (U5) | `packages/bpmn-js-activiti/src/modules/popup-menu/` | `bpmn-js-create-append-anything` 2.1.0 supplies the `N` and `A` menus; `ActivitiPopupMenuProviders` registers a provider that removes every entry the support matrix judges `hidden` or not allowed at the selected element (`judge(spec, placement)`), also from the search (`rank < 0` entries), and adds the Decision task. `entryInfo.ts` is the table of descriptions and user guide links of the entries. |
| Append indicator, keyboard palette (U30) | `src/modules/canvas/` | `AppendIndicator` puts an overlay on elements that end a flow; `KeyboardPalette` makes the palette a toolbar with a roving tab stop. |
| Colour picker (U9) | `bpmn-js-color-picker` 0.7.2 in `app/src/editors/modeler.ts` | writes `bioc:` / `color:` on the DI only (`modeling.setColor`); `app/src/editors/colors.test.ts` exports the coloured diagram and runs the lint on it. |
| Variables (U14) | `packages/activiti-variable-resolver` (`extractOutline`, pure), `app/src/variables/` | `ActivitiVariableResolver` extends the base class of `@bpmn-io/variable-resolver` 3.3.0 and answers from `extractOutline`; `VariablesPanel` is the tab of the bottom panel with the writer / reader highlight (canvas markers `activiti-var-writer`, `activiti-var-reader`). The JUEL completion keeps reading `variableSuggestions`. |
| Camunda 7 importer (U17) | `packages/activiti-project/src/import/camunda/` | see below |
| Auto-layout (U18) | `app/src/editors/autoLayout.ts` | `layoutWhenMissing(xml)`: a file with a process and no `BPMNShape` is completed with `bpmn-auto-layout` 1.3.0 (after the `incoming` / `outgoing` references the library reads were added from the sequence flows) before bpmn-js imports it; several processes or participants are not laid out. `BpmnEditor` calls it when the `autoLayout` setting is on, marks the tab changed and writes a draft. |
| Settings (U19) | `app/src/state/settings.ts`, `Dialogs.tsx` (`SettingsDialog`) | `Settings` live in `localStorage` (`activiti-modeler.settings.v1`), the controller applies them (`setSettings`, `restoreDefaultSettings`); editors read them through `host.settings()` and are told of a change by `settingsChanged`. The panel layout is `state/layout.ts` (`activiti-modeler.layout.v1`, sizes clamped). |
| i18n hooks (U29) | `app/src/i18n/` | `t(key, params)` and one catalog `en.ts`; `registerCatalog(code, partialCatalog)` and `setLocale` add a language, a missing key falls back to English. `i18n.test.ts` fails when the code asks for a key the catalog lacks or the catalog holds a key nothing uses. The help tooltips of the properties panel are the table `HELP` in `properties/help.tsx`, with user guide pages that `provider.test.ts` checks exist. |
| DRD properties panel | `app/src/editors/dmn/dmnPanel.ts` | `dmn-js-properties-panel` 3.13.0 in the DRD viewer (`drd.additionalModules`), the generic provider only, a filter at lower priority drops the question and the allowed answers. The visible DMN tab announces its panel with `setDmnPanel`; `PropertiesSlot` attaches it to the shell's slot. |

The bundle guard (`app/src/bundle.test.ts`) allows the importer folder to name the Camunda namespaces, like the lint plugin, and accepts the one `zeebe:modelerTemplate` string of `bpmn-js-create-append-anything` (its element template helper, not loaded).

### Camunda 7 importer

`convertCamundaBpmn(xml, options)` (`packages/activiti-project/src/import/camunda/convert.ts`) is a pure function over the DOM (`DOMParser`, `XMLSerializer`): it returns `{ xml, extensionsJson, report }`. `detectCamunda(xml)` says whether the file uses Camunda 7 extensions (and counts them) and is also what the editor's offer strip uses. Pieces: `parameters.ts` (input / output parameters to mapping values), `forms.ts` (`camunda:formData` to `activiti:formProperty`), `recorder.ts` (the report: `dropped`, `approximated`, `info` entries with element, item, what and why, plus the list of translations) and `report.ts` (`lossReportMarkdown`). Options: the existing extensions of the file, a lookup of the project's DMN decisions (`decision(ref)`, for business rule tasks) and the default mapping type. The app calls it from `BpmnEditor.convertCamunda`, imports the result into the open modeler (one history, the tab is unsaved) and shows `LossReportDialog`. `test/fixtures/camunda/` holds the fixtures (`order-approval.bpmn` and `invoice-processing.bpmn` exercise most rules); `camunda.test.ts` asserts the converted XML, the extensions, the report and that the output passes `verifyProject` with no Camunda or Zeebe name left. The engine proof is `corpus/C22-camunda-import/`: `camunda/*.bpmn` are the sources, `build.ts` converts them through the test API (`importCamunda`) and exports, `seed/` is the hand-reviewed result that the semantic diff compares with, and the scenarios run it on Activiti 9.

### Pinned versions

All dependencies are exact. The bpmn.io set: `bpmn-js` 18.31.1, `dmn-js` 18.0.0, `bpmn-js-properties-panel` 5.65.3, `@bpmn-io/properties-panel` 3.58.0 (`dmn-js` is the DMN editor, with `@bpmn-io/dmn-migrate` 0.7.1, `@bpmn-io/feel-editor` 2.8.0 and `dmn-js-properties-panel` 3.13.0). Editor modules: `diagram-js-minimap` 5.6.0, `diagram-js-grid` 2.1.0, `@bpmn-io/align-to-origin` 0.7.0, `bpmn-js-native-copy-paste` 0.3.0, `bpmn-js-copy-as-image` 0.4.1, `@bpmn-io/svg-to-image` 1.0.1. Storage: `idb` 8.0.4, `fflate` 0.8.3 (zip), `fake-indexeddb` 6.2.6 (tests). Code editors: `codemirror` 6.0.2 with the `@codemirror/*` packages that `@bpmn-io/properties-panel` already uses. Tooling: TypeScript 5.9.3, Vite 8.3.5, Vitest 5.0.5, React 18.3.1, `@playwright/test` 1.63.0 (it must match the installed Chromium revision). Vitest 4.1.x is avoided: `npm install` crashes on its optional peer dependencies with npm 10.9.

### Conventions

- TypeScript is `strict` (plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); the base config is `tsconfig.base.json`.
- Tests are `*.test.ts` next to the code. Library code needs no DOM; app code that needs a browser is covered by Playwright.
- Install with `npm install <pkg>@<exact version> -w <workspace>`; `.npmrc` saves exact versions. Commit `package-lock.json`.
- Never load `camunda`/`zeebe` moddle, providers or behaviours (ADR 0001).
- Do not put UI over the bpmn.io watermark. `e2e/watermark.spec.ts` (with `e2e/support/watermark.ts`) checks that `.bjs-powered-by` is visible, not dimmed and that the elements at its centre and corners are the watermark, for every canvas and layout state: panels open and closed, minimap open, other tabs, toasts, small windows. A new overlay, panel or popup must pass it.
- Editors plug into the tab system through `app/src/state/editorRegistry.ts`: `registerEditor({ id, label, accepts(path), Component })`, the highest `accepts` priority wins. The DMN editor (`app/src/editors/dmn/`) replaces the raw XML editor (`dmn-source`) by registering `*.dmn` with a higher priority; a `.dmn` that has no DMN namespace goes to `dmn-source` through `host.openWith`. The pure parts (normalizer, `describeDmn`, `diffDmn`) live in `activiti-project/src/dmn/`; the decision tester is `app/src/decision-tester/`; the test API for DMN is `app/src/dmnTestApi.ts`. An editor receives `{ tab, host, active }`; through `host` it reports `setDirty`, `setHandle({ serialize, ... })` (what Save writes), warnings and failure (which shows the fail-safe error view).
- Playwright tests of the shell run against the production bundle and read the browser workspace straight from IndexedDB (`e2e/support/app.ts`). The File System Access API is exercised with a folder of the origin private file system behind a stub `showDirectoryPicker`.

### Add an npm package

1. Create `modeler/packages/<name>/` with a `package.json` (copy a small package: `name` `@activiti-modeler/<name>`, `version` `0.1.0`, `main`/`types`/`exports` pointing at `./src/index.ts`, `typecheck` and `test` scripts), a `tsconfig.json` extending `../../tsconfig.base.json`, and `src/index.ts` with a test.
2. List it in the dependencies of the packages or the app that use it (`"@activiti-modeler/<name>": "0.1.0"`), run `npm install` in `modeler/`, and commit the lockfile.

## Distribution

[ADR 0008](adr/0008-distribution.md) is the design; [the install guide](user-guide/install.md) is what users read. What is where:

| Feature | Files | Notes |
|---|---|---|
| K1 licences | `LICENSE` (Apache-2.0), `NOTICE`, `THIRD-PARTY-NOTICES.md`, `scripts/generate-notices.py` | The notices are **generated** from what ships: the libraries inside the built jar (`BOOT-INF/lib`, licences read from the poms in `~/.m2` and the jars) and `npm ls --omit=dev`. Run `python3 -I scripts/generate-notices.py` after a dependency change; `--check` (CI and the release) fails when the file is stale. A library whose pom names no licence needs an entry in `JAVA_LICENSE_OVERRIDES` / `NPM_LICENSE_OVERRIDES` in the script. The three files go into the jar under `META-INF/` (server `pom.xml`, `<resources>`), into every bundle and the image |
| K2 build from source | `build.sh`, `build.cmd`, `run.sh`, `run.cmd`, `java/mvnw`, `java/mvnw.cmd`, `java/.mvn/wrapper`, `scripts/setup-jdk.sh` / `.ps1` | `./build.sh` = JDK 25 (`setup-jdk`) + `./java/mvnw -Pbundle-modeler -pl activiti-modeler-server -am package -DskipTests`. In the server pom the profile `bundle-modeler` runs `frontend-maven-plugin` 1.15.4 (Node `v22.22.0` into `.tools/node`, `npm ci`, `npm run build` in `modeler/`), then copies `modeler/app/dist` into the jar. `-Dmodeler.skipFrontend=true` skips the Node steps (`scripts/build-server.sh`, which the e2e suite calls, builds the app itself and passes it). The Maven version is pinned in `java/.mvn/wrapper/maven-wrapper.properties`; keep the Node version in step with the `node-version: '22'` of the workflows |
| K3 start without arguments | `launch/StartupDefaults`, `PortSelection`, `StatusWindow`, `StatusWindowListener`, `BrowserOpener`, `ModelerServerApplication.main` | The defaults are **Spring default properties** computed by `main` (lowest precedence: an argument, variable, profile file or `application.properties` wins). They are not in `application.properties`, and tests (`@SpringBootTest`) do not run `main`, so tests never open a browser or window or touch `~/ActivitiModeler`; surefire also sets `-Dmodeler.home=target/test-home`. `StartupIsolationTest` pins this. `LaunchEnvironment` is the seam (system properties, variables, home) tests fake. `StatusWindowTest` presses **Open in browser** and **Quit** headless: the window's content is built without its frame, and the browser is a constructor argument |
| K4 desktop bundle | `scripts/package-desktop.sh` / `.ps1`, `scripts/smoke-bundle.sh` | `jdeps` over the app classes and every library in the jar finds the Java modules, a fixed list is added (`java.desktop` for the window and others loaded by name), `jlink` builds the runtime (about 66 MB), `jpackage --type app-image` makes `Activiti Modeler` with the jar as the only input, and the result is zipped as `activiti-modeler-<version>-<os>-<arch>.zip` in `dist-desktop/`. It must run on each OS (no cross-building). New library that needs a Java module nobody names (a `ClassNotFoundException` in the bundle only): add the module to `extra` in the script |
| K5 Docker | `Dockerfile`, `.dockerignore`, `docker/Healthcheck.java`, `docker/jdk-alpine.env`, `scripts/build-runtime.sh`, `scripts/update-jdk-alpine.sh`, `application-container.properties`, `launch/ContainerCredentials`, `scripts/smoke-docker.sh` | Three stages: a JDK builds the jar with the wrapper; an Alpine stage of the target platform downloads the Alpine (musl) build of Temurin 25 named in `docker/jdk-alpine.env` (version and SHA-256 per CPU, the Dockerfile picks the archive with `TARGETARCH`; `scripts/update-jdk-alpine.sh --write` moves the pin) and links the same trimmed runtime as the desktop bundles with it (`scripts/build-runtime.sh`: `jdeps` and `jlink`); the final image is `FROM scratch` and holds only the musl C library (plus its package-database entry, so that scanners list it), the runtime, the jar, the health check and the licence files (no shell, no `apk`, user 65532, the Alpine and build JDK images pinned by digest) and runs it with the profile `container`. The `HEALTHCHECK` is `docker/Healthcheck.java`, run by the image's own Java. `ContainerCredentials` is an `EnvironmentPostProcessor` (`META-INF/spring.factories`) that replaces every demo password with `MODELER_PASSWORD` or a printed random one. `scripts/smoke-docker.sh` checks from outside (`docker inspect`, `docker top`, `docker cp`) because there is nothing to `exec`; it runs the container three times (password set, generated password, and hardened with `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`) with the checks of `scripts/smoke-lib.sh`, which include a DMN evaluation and a scenario run with a JavaScript script task and a mail task |
| K6 Pages | `.github/workflows/pages.yml`, `scripts/build-pages.sh`, `scripts/smoke-pages.sh`, `modeler/scripts/smoke-pages.mjs` | The same app with `--base=/<repo>/` (the Vite CLI option; `vite.config.ts` is untouched). The smoke script serves it with `vite preview --base=...` and loads it in Chromium |
| K7 release | `.github/workflows/release.yml`, `scripts/release-notes.sh` | See below |

### Try the distribution locally

```bash
./build.sh                                          # the jar (with the web app inside)
scripts/smoke-server.sh                             # start it on a free port, check it, stop it
scripts/package-desktop.sh                          # the bundle for this machine
scripts/smoke-bundle.sh dist-desktop/*.zip          # unzip, start with no arguments, check, stop
scripts/smoke-docker.sh                             # build the image (or pass an image name), run it twice, check, remove it
scripts/smoke-pages.sh --base=/activiti-modeler/    # the browser-only build under a sub-path (needs npm ci and a Chromium)
python3 -I scripts/generate-notices.py --check      # THIRD-PARTY-NOTICES.md is current
```

`scripts/smoke-lib.sh` holds the checks that every way of running must pass (health, engine report, 401 without a user, the app and its script, a workspace round trip, a process validated on the engine, a decision evaluated, no reachability beyond the loopback address); `smoke-server.sh`, `smoke-bundle.sh` and `smoke-docker.sh` call it. `scripts/smoke/*.json` are its request bodies.

### Repository settings (once)

The release and Pages workflows need these settings once, in the repository on GitHub. They cannot be set by a workflow.

1. **Pages.** Settings > Pages > Build and deployment > **Source: GitHub Actions**. The workflow `pages.yml` then deploys the browser-only build on every push to `main`, to `https://<owner>.github.io/<repository>/`. If the first deploy is refused, check Settings > Environments > `github-pages` > Deployment branches: it must allow `main`. For a custom domain served from its root, set the repository variable `PAGES_BASE` to `/`.
2. **The container package.** The first release pushes `ghcr.io/<owner>/activiti-modeler`; a new package is **private** by default. Open the package (your profile or organisation > Packages > `activiti-modeler` > Package settings), set **Change visibility** to **Public**, and under **Manage Actions access** or **Connect repository** link it to this repository, so that the workflow's `GITHUB_TOKEN` may push new tags later.
3. **Actions.** Settings > Actions > General > Workflow permissions can stay on "Read repository contents": every job of the release workflow asks for exactly the permissions it needs (`contents: write` to publish the release, `packages: write` for GHCR). Allow GitHub's and the actions the workflows use (all are pinned to a commit).
4. **Tags.** Optionally protect `v*` tags (Settings > Rules) so that only maintainers can release.

### The workflows

- `ci.yml`: `verify` (Spring Boot 3.5.16 and 3.5.7, plus the notices check), `verify-activiti8` (Activiti 8.8.1 on JDK 21, both Boot versions), `distribution` (`./build.sh` with only a JDK, the jar smoke test, the Linux bundle and its smoke test), `docker` (build and smoke test) and `pages` (the build under `/activiti-modeler/` in Chromium).
- `pages.yml`: on `main`: build, smoke test, deploy with `actions/deploy-pages`.
- `release.yml`: on a `v*` tag or by hand with **dry run**: `verify` (`scripts/verify-all.sh`) and `security` (the OSV gate and the SBOMs), then `jar`, then `bundle` on `ubuntu-latest`, `macos-14` (arm64), `macos-15-intel` (x64; GitHub retired `macos-13`) and `windows-latest`, each **smoke-testing its own bundle**, and `docker` (smoke test, the OSV gate on the image, then push `linux/amd64` and `linux/arm64` to GHCR), then `release` (`SHA256SUMS`, the SBOMs and the OpenVEX statement, notes from the `CHANGELOG.md` section of the tag plus the open exceptions and the Java runtime versions, `gh release create`), which also waits for `maven-central` (the Maven artifacts signed and bundled; uploaded only by a run of its own, [below](#maven-central-adr-0009)). The version comes from the tag (`v0.1.0` becomes `0.1.0`) and is set in the poms of the build with `versions:set`, nothing is committed. Every action is pinned to a commit SHA with the version in a comment; `.github/dependabot.yml` proposes the new SHAs once a month (or look them up with `git ls-remote --tags https://github.com/<owner>/<action>`); keep the permissions per job as small as they are.
- The macOS and Windows jobs run `scripts/package-desktop.sh` and `scripts/smoke-bundle.sh` (in Git Bash on Windows). A dry run (**Actions > Release > Run workflow**) tries them without publishing anything.

### Maven Central (ADR 0009)

**A release, in this order:**

1. **Dry run:** **Actions > Release > Run workflow** with `dry_run` on (the default). Everything is built and smoke-tested, and the Maven artifacts are signed and bundled. Nothing is published.
2. **Tag:** rename `## [Unreleased]` in `CHANGELOG.md` to the version, then push the tag `v<version>`. This makes the GitHub Release and pushes the image. The Maven artifacts are signed and bundled again, but not uploaded.
3. **Maven Central, last, and only by hand:** once the GitHub Release exists, **Run workflow** on the tag with `dry_run` off and `publish_maven_central` on. Then publish the deployment in the Portal (below). A version on Central can never be changed or removed, so no run uploads to it implicitly.

**What is published**, under the group `io.github.kleash.activiti`:
- the parent pom `activiti-modeler-parent`, because every published pom inherits from it;
- the libraries `activiti-dmn-connector`, `activiti-dmn-connector-kie`, `activiti-scenario-runner`, `activiti-runtime-rest-core` and `activiti-runtime-rest-dev`. `activiti-dmn-connector` also has a `tests` jar: the test fixtures that the KIE module's tests use;
- `activiti-modeler-server`: its plain jar, and its runnable jar with the web app as the classifier `exec`. That jar is the one in the downloads.

Every jar module has its `-sources.jar` and `-javadoc.jar`, and every file has a GPG signature. `verification-harness` is not published.

**The build:** the profile `release` of `java/pom.xml`. Without `-Prelease` the build is as before and needs no key.
- **Plugins:**
  - `maven-source-plugin` 3.4.0 and `maven-javadoc-plugin` 3.12.0 make the sources and javadoc jars;
  - `maven-gpg-plugin` 3.2.8 signs every file;
  - `central-publishing-maven-plugin` 0.12.0 replaces `maven-deploy-plugin`. It uploads one bundle for all modules at the end of the build, then waits until Central has validated it, and fails if Central refuses it. `autoPublish` stays off, so the maintainer publishes by hand.
- **The Alfresco repository stays in the published parent pom.** Central discourages `<repositories>` in a pom but accepts them, and Alfresco is the only place where Activiti 8.x and 9.x exist. Maven needs the `activiti-dependencies` BOM, which the parent imports, to read any module's pom. With the repository in the parent, a host resolves `activiti-dmn-connector` from Central without declaring any repository of its own. The host still needs the Alfresco repository for Activiti itself.
- **Try it locally**, with no key:
  - `./java/mvnw -B -f java/pom.xml -Prelease -DskipTests -Dgpg.skip verify` makes the sources and javadoc jars.
  - `deploy -DskipUpload` in place of `verify` also writes the bundle, `java/target/central-publishing/central-bundle.zip`. It needs a release version: set a throwaway one with `versions:set -DnewVersion=0.0.0-local` and undo it with `versions:revert`. Not a real version: `deploy` also installs it into `~/.m2`. A `-SNAPSHOT` version is staged but not bundled.

**The job `maven-central`** has two modes:

| Mode | When | What it does |
|---|---|---|
| `bundle` | a `v*` tag push, a dry run, any other run | Builds, signs with the release key and bundles. Uploads nothing. The GitHub Release waits for it, so a release whose Maven artifacts cannot be signed or bundled is not made. Without the signing secrets (a fork) it bundles unsigned and says so. |
| `upload` | **Run workflow** on a `v*` tag with `dry_run` off and `publish_maven_central` on | `prepare` refuses a dry run, a branch, or missing secrets, and the job refuses a tag without a GitHub Release. The run then does only two things: the OSV gate (`security`) runs again, and the job builds, signs, uploads and waits for Central's validation. The tests, the downloads, the image and the GitHub Release are not redone. |

After an upload, the deployment waits on https://central.sonatype.com/publishing/deployments. Check its files there, then press **Publish**, or **Drop** to discard it. Central refuses a version that is already published, so if a run fails after the upload, look at that page before running it again.

**How the job protects the secrets:**
- `./build.sh` builds the web app in a step with no secret in its environment. The signing step runs Maven with `-Dmodeler.skipFrontend=true`, so the install scripts of the npm packages never see the key or the token.
- The Bouncy Castle signer (`-Dgpg.signer=bc`) reads the key from `MAVEN_GPG_KEY` and its passphrase from `MAVEN_GPG_PASSPHRASE`, which are set for that step only. It needs no `gpg` and no keyring.
- The Portal token is passed only in `upload` mode.

**Secrets** (repository **Settings > Secrets and variables > Actions**). The workflow uses exactly these four:

| Secret | Value |
|---|---|
| `MAVEN_CENTRAL_USERNAME` | the username part of a Central Portal user token |
| `MAVEN_CENTRAL_PASSWORD` | the password part of the same token |
| `MAVEN_GPG_PRIVATE_KEY` | the ASCII-armored secret signing key: `gpg --armor --export-secret-keys <key id>`, the whole block |
| `MAVEN_GPG_PASSPHRASE` | the key's passphrase |

**One-time setup: done for this repository.**
- The namespace `io.github.kleash` is set up on the Central Portal, and the four secrets are set.
- The signing key is `86B07E0A07D6BFAE`, fingerprint `4D40 5980 71E2 EB02 FB51 46DE 86B0 7E0A 07D6 BFAE`. Its public key is on `keyserver.ubuntu.com` and `keys.openpgp.org`.
- To check a file from Central: `gpg --recv-keys 4D40598071E2EB02FB5146DE86B07E0A07D6BFAE`, then `gpg --verify <file>.asc <file>`.

**A fork, or a new maintainer with their own accounts, redoes the setup:**
1. **Account and namespace.** Sign in at https://central.sonatype.com with the GitHub account that owns the repository. The Portal then creates and verifies the namespace `io.github.<account>`, and the group `io.github.<account>.activiti` falls under it.
   - With another kind of sign-in, add the namespace on the Portal's Namespaces page. To prove you own the GitHub account, create a temporary public repository named after the verification key, and delete it once the namespace is verified.
   - A fork under another account first changes the `groupId` in every pom, and in these docs.
2. **User token.** Open https://central.sonatype.com/usertoken, press **Generate User Token** and give it an expiry. The token is shown only once: its username and password parts are the first two secrets. Renew it before it expires.
3. **Signing key.**
   - Create it with `gpg --full-generate-key`: RSA, 4096 bits, an expiry and a passphrase.
   - Let the primary key sign, and do not add a separate signing subkey. Sonatype's guide says Central checks signatures against the primary key, and the workflow's signer uses the primary key.
   - Publish the public key: `gpg --keyserver keyserver.ubuntu.com --send-keys <key id>` and `gpg --keyserver keys.openpgp.org --send-keys <key id>`.
   - Before the key expires, run `gpg --edit-key <key id>`, then `expire` and `save`, and send it to both keyservers again.
4. **Secrets.** Add the four secrets of the table above.

## Security scanning

The rule is **no known vulnerability in anything the project ships**, and it is a gate, not a report: [SECURITY.md](../SECURITY.md) says what is scanned and what is accepted; this section says how it works.

| What | Where | When | Result |
|---|---|---|---|
| **OSV scan** (the required check) | `.github/workflows/osv-scan.yml`, which runs `scripts/cve-scan.sh`; job `source` (Maven, both Activiti lines, the built jar, npm) and job `image` (the Docker image) | pull requests, pushes to `main`, Mondays 03:47 UTC, by hand | Builds CycloneDX SBOMs and scans them with OSV-Scanner. **Fails** on any known vulnerability that `osv-scanner.toml` does not except, on an expired or unused exception, and on an exception that breaks the rules of `scripts/cve-scan-check.py`. SBOMs and results are workflow artifacts. Branch protection makes it required |
| Dependency review | `.github/workflows/dependency-review.yml` (`actions/dependency-review-action`, pinned) | pull requests | Fails a pull request that adds or changes a dependency to a version with a known vulnerability, severity low and up, except the two advisories of the documented exception (`allow-ghsas`); comments the summary when it fails |
| CodeQL | `.github/workflows/codeql.yml` | pull requests, pushes to `main`, Mondays, by hand | Code scanning of `java-kotlin` (manual build: `java/mvnw -DskipTests compile` on JDK 25) and `javascript-typescript`; results under Security > Code scanning |
| Dependabot | `.github/dependabot.yml`, plus the repository's "Dependabot alerts" and "Dependabot security updates" | monthly for the action pins, weekly for the two Docker base image digests; on each advisory for Maven and npm | Updates the pinned actions and the base images; opens a fix pull request for a vulnerable Maven or npm dependency |
| Release gate | `.github/workflows/release.yml`, job `security` (the same `scripts/cve-scan.sh`, on the release build) and the OSV gate in job `docker` (before the image is pushed) | on a `v*` tag and on a dry run | No release without a clean scan. The release attaches the SBOMs (jar, web app, image), `activiti-modeler.openvex.json` and `SHA256SUMS`, and prints the open exceptions and the Java runtime versions in its notes |

**Run it locally** (needs network access; about 3 minutes for both Activiti lines):

```bash
scripts/cve-scan.sh                          # Maven (9.0.0 and 8.8.1), the jar, npm; writes target/cve-scan/{sbom,results,summary.md}
scripts/cve-scan.sh --lines 9 --skip-npm     # one line, quicker
scripts/cve-scan.sh --skip-java --skip-npm --image activiti-modeler:smoke    # an image (build it with scripts/smoke-docker.sh)
python3 -I scripts/cve-scan-check.py config  # only the rules for exceptions: instant, offline
```

- **What it scans.** The CycloneDX SBOM of the runtime scope (no test, no provided scope, no build plugins) of `activiti-modeler-server` and the three libraries, made with the pinned `org.cyclonedx:cyclonedx-maven-plugin:2.9.3`; the built server jar itself (`scan source --x-plugins java/archive`), which sees libraries that are repackaged into another jar (MyBatis embeds OGNL) and so are in no SBOM; `npm sbom --omit=dev` of `modeler/`; and `osv-scanner scan image`. The two Activiti lines are both scanned **on Spring Boot 3.5.16**, which is what ships; the Boot 3.5.7 compatibility entries of CI are tests, not releases, and are never scanned.
- **The scanner is pinned** by version and by SHA-256: `scripts/install-osv-scanner.sh` downloads OSV-Scanner v2.7.0 into `.tools/` and refuses it unless the checksum equals the line in `scripts/osv-scanner.sha256` (the release's own checksum file, reviewed in the pull request). To update: change `VERSION` in the script, replace the checksum file with the new release's `osv-scanner_SHA256SUMS`, run `scripts/cve-scan.sh`.
- **When it fails on a new advisory.** First look for a fix: a patch or minor version inside the line Spring Boot 3.5 manages. Put it in `java/pom.xml` `dependencyManagement` (the entries there say which advisory each fixes and when to delete it), re-run `scripts/verify-all.sh` and `ACTIVITI_LINE=8 scripts/verify-all.sh`, and prefer the newest patch of the line over the first version OSV accepts (OSV lags the vendors). Only when no fix exists, add an exception to `osv-scanner.toml` and a statement to `docs/security/vex.openvex.json` ([the rules](security/README.md)); keep `allow-ghsas` in `dependency-review.yml` equal.
- **What is not scanned.** Test and build-time dependencies; the Java runtime inside the bundles and the image (OSV does not cover a JDK: the release uses the newest Temurin 25 and prints its version; the image pins the Alpine build in `docker/jdk-alpine.env`, and the release workflow warns when a newer one exists); code the scans cannot see (that is what review and CodeQL are for).
- **Adding a workflow or an action.** Pin it to a commit SHA with the version in a comment, give each job its own `permissions:`, lint it (`actionlint`) and parse it as YAML before pushing.

## Troubleshooting

- `JDK 25 or newer is required`: run `scripts/setup-jdk.sh`, then `source scripts/env.sh`.
- Playwright cannot find a browser: `cd modeler && npx playwright install chromium`. In an environment with a preinstalled browser set `PLAYWRIGHT_BROWSERS_PATH` to its folder; the `@playwright/test` version must match it.
- Maven Central rate limits show up as download failures: retry.
