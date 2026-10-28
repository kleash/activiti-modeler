# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-29

The first release: a BPMN and DMN modeler for Activiti 9.0.0, the modeler server that deploys and tests models on an embedded engine, and the Java libraries behind it.

### Modeling BPMN

- Diagram editor on bpmn-js 18. The palette, the context pad, the replace menu and the create and append menus (`N`, `A`) offer only what Activiti 9 executes. A **Decision task** entry creates a service task that calls a DMN decision.
- Editing tools: lasso, space, hand and connect tools, align and distribute, snapping, label editing, copy and paste (also between tabs), duplicate, undo and redo, search, minimap, grid, colours, move to origin, SVG and PNG export, copy as image, and keyboard shortcuts modelled on Camunda Modeler's.
- An XML view that applies your edits back to the diagram, and a JSON view of the extensions file.
- A process file without a diagram is laid out when it is opened.
- A variables view lists every variable with its type, scope, writers and readers, and marks them on the canvas.
- Projects in the browser (IndexedDB, works offline), in a local folder (in browsers with the File System Access API), in the modeler server's workspace, or as a zip that unpacks into `src/main/resources` of a Spring Boot application. Unsaved changes survive a reload or a browser crash.
- After **File > Export project as zip** a dialog says how a Spring Boot application uses the files: `processes/` with the `-extensions.json` files, `connectors/`, and for decision tasks the `activiti-dmn-connector` dependency. Decision tasks carry the same reminder in the properties panel and as a lint note.
- Templates for an empty process, a user task approval, a connector call, a decision task, a DMN decision table, a DRD, a scenario and a connector.
- Camunda 7 import: `camunda:` attributes, listeners, fields, form data, `in` and `out` parameters, input and output parameters and business rule tasks are translated to Activiti, with a report of what was dropped and why. From a Camunda 8 file only the BPMN structure is kept.

### Properties panel and extensions file

- A group for every `activiti:` setting Activiti 9 executes, shown only where it applies: assignment, forms, execution, task and event listeners, implementations (Java class, expression, delegate expression, connector, mail, shell, decision), field injection, scripts, called elements, multi-instance, asynchronous continuation and job retries, error mapping, timers, event definitions, conditions, skip expressions and data objects. Every change is one undo step.
- Expression fields with a JUEL editor: highlighting, syntax errors and completion of process variables. Timers are checked as you type and described in words.
- Notes under the fields where Activiti behaves differently from what you would expect, each linked to a page of the user guide.
- The extensions file `<process>-extensions.json`: process variables of the eleven Activiti types, input and output mappings (`VARIABLE`, `VALUE`, `JSONPATCH`, `MAP_ALL` and its variants) and constants, edited in the panel in one undo history with the diagram. New user tasks, call activities and message catch events get a default mapping, so their variables reach the process.
- Connectors: an editor for `connectors/*.json`, and element templates generated from it, with update and unlink.
- Decision tasks: pick a DMN file and a decision, and its inputs and outputs are mapped. The panel warns when the DMN changes afterwards.

### DMN

- Editor on dmn-js 18: requirements diagrams, decision tables with all seven hit policies and the COLLECT aggregators, literal expressions and boxed expressions, a FEEL editor with variable suggestions, and a properties panel for the DRD.
- DMN 1.1 and 1.2 files are migrated when they are opened. Saving writes portable DMN 1.3.
- Decision tester: evaluates a decision on the server's engine with typed inputs, shows the result rows and highlights the matched rules. The inputs are remembered per file.

### Lint

- 156 rules for what Activiti executes (111 errors, 36 warnings, 9 notes), next to bpmnlint's recommended rules tuned for Activiti. 78 of them mirror Activiti's `ProcessValidator`: one rule per problem key, with the engine's severity and key.
- Rules across files: the extensions file, connectors, DMN decisions, called processes and message subscriptions.
- A Problems panel with severity and file filters, overlays on the canvas, a click that opens the field in the properties panel, and quick fixes as undoable steps (for example a business rule task to a decision task, or a `camunda:` attribute to its Activiti equivalent).
- With a server connected, the engine's own validation joins the list. Errors block a deployment.
- A page per rule in `docs/user-guide/lint-rules/`, and the same lint on the command line (`activiti-lint`) for CI.

### Running and testing

- The **Run** menu connects to a modeler server, deploys the project after the lint and a trial deployment on the engine, and starts instances with a business key and typed variables, or by a message.
- The instance view shows the active and completed steps and the flows taken on the diagram. From it you claim, assign and complete tasks, edit variables, fire timers, execute and retry jobs, send messages and signals, and trigger receive tasks.
- Scenarios: JSON files with the start, the steps and the expected path, variables, tasks and connector calls. A form and JSON editor, a runner with a report per step and the path on the diagram, and a recorder that turns a run you click through into a scenario.
- Token simulation on a copy of the diagram. It is refused for a diagram with constructs Activiti does not run.

### Distribution

- Desktop bundles with their own Java runtime for Windows x64, macOS arm64, macOS x64 and Linux x64: unzip and open. A small window shows the address and has **Open in browser** and **Quit**.
- An executable jar for Java 25 that starts the same way.
- A Docker image for `linux/amd64` and `linux/arm64`, built `FROM scratch` (the Java runtime and the musl C library, no shell, no package manager). It runs as user 65532 and generates a password unless `MODELER_PASSWORD` is set.
- The modeler alone on GitHub Pages: modeling, lint, Camunda import and export in the browser, with no server.
- Build from source with `./build.sh` (Windows: `build.cmd`); it needs only git and a shell.
- The server starts with no arguments: projects in `~/ActivitiModeler/workspace`, port 8080 or a free one, and the browser opens. It listens on `127.0.0.1` only. Options: `--workspace`, `--port`, `--no-open`, `--no-window`.
- Inside the server: Activiti 9.0.0 on an in-memory H2 database with the async executor on, the DMN connector, an SMTP server for mail tasks and three sample connectors.

### On Maven Central

Published under the group `io.github.kleash.activiti`, version 1.0.0, with sources, javadoc and GPG signatures.

- `activiti-modeler-server`: the modeler server. The classifier `exec` is the runnable jar of the downloads (Java 25).
- `activiti-dmn-connector`: DMN support for your own application, needed only for decision tasks. Runs them on Operaton DMN 2.2.0, including the PRIORITY and OUTPUT ORDER hit policies; decisions are looked up in the deployment of the process.
- Also published, for embedding and testing (Java 21 bytecode, for Activiti 9.0.0 and 8.8.1 on Spring Boot 3.5):
  - `activiti-dmn-connector-kie`: the KIE DMN 10.2.0 engine instead, for business knowledge models and boxed expressions.
  - `activiti-scenario-runner`: runs the modeler's scenario files against an embedded engine, in your own JUnit tests.
  - `activiti-runtime-rest-core`: a REST API over the engine (definitions, instances and their path, tasks, messages, signals, jobs, timers) that brings no security of its own.
  - `activiti-runtime-rest-dev`: the development endpoints of the modeler server (validate, deploy, run scenarios, evaluate decisions, workspace files). They are off unless switched on, and not for production.

### Security

- An OSV scan of everything the release ships: the server jar on both Activiti lines, the libraries, the web app and the Docker image. It runs on every pull request, on every push to `main`, every Monday and before every release, and fails on any known vulnerability without a documented exception. CodeQL and dependency review run on pull requests.
- The parent pom overrides versions that Spring Boot 3.5.16 manages, to fix known advisories: Jackson 2.21.8, Log4j 2.25.5, Tomcat 10.1.61, commons-lang3 3.18.0 and Jakarta Mail 2.0.2. The integration guide lists them for your own application.
- Three advisories are open. They are documented in `SECURITY.md` and stated as `not_affected` in the OpenVEX file, and their exception expires on 2027-01-25:
  - GHSA-pc63-qcmh-9cmg (CVE-2026-47884) and GHSA-j9f9-w8pj-32f8 (CVE-2026-47890) in `spring-webmvc` 6.2.19. The server has no XSLT views, no Server-Sent Events and no view fragments. The fixes are only in Spring Framework 6.2.20 (Enterprise Support only) and Spring Framework 7 (Spring Boot 4).
  - GHSA-crwc-vw2r-qr6m (CVE-2026-113730) in the OGNL 3.4.4 inside MyBatis 3.5.19. MyBatis evaluates only the expressions of the engine's own mapper files. The fix is in MyBatis 3.6.0, on which Activiti 9.0.0 and 8.8.1 do not start.

### Known limitations

- The Windows bundle is not code-signed: Windows warns on the first start. The install guide (`docs/user-guide/install.md`) says how to open it. The macOS apps are signed with a Developer ID and notarized, and Homebrew installs them: `brew install kleash/tap/activiti-modeler`.
- The modeler server runs the models you deploy, so anyone who can sign in can run code on the machine. It listens on `127.0.0.1` with demo users; it is a development tool, not a production server.
- The browser-only version cannot deploy or run models; that needs a modeler server.
- The modeler server, the desktop bundles and the Docker image run Activiti 9.0.0. Activiti 8.8.1 is for applications that embed the libraries.
- Activiti 9.0.0 cannot open a database that Activiti 8.8.1 has created or opened. Keep one database per engine line.
- Activiti 9.0.0 returns wrong tasks for a `TaskQuery` that filters by a process variable value together with another filter (8.8.1 is correct). Nothing in this project runs such a query; an application on 9.0.0 must not run one either.
- The BPMN files alone are not enough: deploy each `-extensions.json` file with its process. Without it Activiti drops the variables a user task is completed with (start variables still arrive), so a gateway that reads one fails.
- Only what Activiti executes can be drawn: no business rule task (use a decision task), complex gateway, ad-hoc sub-process, escalation or conditional event, signal end event or standard loop. An imported file that has them gets lint errors, with a quick fix where Activiti has an equivalent.
- Boxed expressions and business knowledge models run only on the KIE engine (`activiti-dmn-connector-kie`).
- Token simulation follows BPMN only: expressions, delegates, connectors and decisions do not run in it.
- The user interface is in English.
