# Documentation

## User documentation

### Get started

| Page | What it covers |
|---|---|
| [Install](user-guide/install.md) | The desktop app, the jar, Docker, the browser-only build and building from source; Homebrew; opening the Windows app, which is not code-signed |
| [Modeler server](user-guide/modeler-server.md) | Starting the server without arguments, its options, the security model, the properties |

### User guide

| Page | What it covers |
|---|---|
| [Modeler basics](user-guide/modeler-basics.md) | Projects and storage, files and tabs, templates, saving, the editing tools, the XML and JSON views, export, the properties panel, the Problems panel, shortcuts |
| [Properties panel](user-guide/modeler-basics.md#the-properties-panel) | One page per group of the panel, in `user-guide/properties/` |
| [Lint rules](user-guide/lint-rules/index.md) | Every rule: what it finds, why it matters on Activiti, how to fix it |
| [Connectors and element templates](user-guide/connectors.md) | Connector definitions, the catalog editor, templates generated from a connector |
| [DMN](user-guide/dmn.md) | The DMN editor, what the modeler writes on save, migration of DMN 1.1 and 1.2 files, the decision tester, decision tasks |
| [DMN conventions](user-guide/dmn-conventions.md) | Portable DMN, the semantics of each hit policy, what only the KIE engine runs |
| [Camunda 7 import](user-guide/camunda-import.md) | Converting a Camunda 7 model: what is translated, the loss report |
| [Running and testing](user-guide/running.md) | Connecting to a server, deploying, starting instances, the instance view, scenarios, token simulation |
| [Scenario reference](user-guide/scenarios.md) | The scenario file format: steps, assertions, decision cases |
| [Feature matrix](FEATURE_MATRIX.md) | What the modeler supports on Activiti, and how each row is proven |

### Integration and API

| Page | What it covers |
|---|---|
| [Integration guide](integration-guide.md) | Embedding the libraries in a Spring Boot application: pom snippets, properties, the DMN connector |
| [Runtime REST API](api/runtime-rest.md) | The core and the dev API; the OpenAPI descriptions are [`openapi-core.json`](api/openapi-core.json), [`openapi-dev.json`](api/openapi-dev.json) and [`openapi-server.json`](api/openapi-server.json) |
| [Security policy](../SECURITY.md) | Supported versions, reporting a vulnerability, what the scans cover, the open advisories and why they are accepted |
| [Security statements](security/README.md) | The OpenVEX statement, the rules for an exception, running the OSV scan |

## Project internals

For contributors: how the project is built, tested and verified, and why it is built this way.

| Page | What it covers |
|---|---|
| [Developer guide](developer-guide.md) | Build and test commands, the layout, conventions, adding a module, the release workflow |
| [Verification index](verification-index.md) | The named tests behind every row of the feature matrix, and the known limitations |
| [Engine findings](engine-findings.md) | Behaviour of Activiti 9.0.0 and 8.8.1 that the corpus and the scenario runner established |
| [Activiti 9.0.0 BPMN reference](research/activiti-9-bpmn-support.md) | What the engine parses and executes, with the exact `activiti:` spellings and the validator problem keys (cited as R1) |
| [Corpus support library](corpus-support.md) | The beans, delegates and listeners the corpus models can use |
| [Compatibility check](../compat-check/README.md) | Where Activiti is published, the supported Activiti and Spring Boot combinations; `compat-check/run-matrix.sh` runs it again |
| [Contributing](../CONTRIBUTING.md) | How to propose a change |
| [Changelog](../CHANGELOG.md) | Notable changes per release |

### Architecture decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-web-modeler-on-bpmn-io.md) | A web modeler on the bpmn.io toolkit |
| [0002](adr/0002-runtime-target.md) | Runtime target: Activiti 9.0.0, Spring Boot 3.5.x, JDK 25; Activiti 8.8.1 on JDK 21 as a second target |
| [0003](adr/0003-model-file-contract.md) | The model file contract: BPMN, extensions JSON, DMN, connectors |
| [0004](adr/0004-dmn-execution.md) | DMN execution through an Activiti connector backed by Operaton DMN |
| [0005](adr/0005-scenario-format.md) | Executable test scenarios as data |
| [0006](adr/0006-extensions-store.md) | The extensions JSON is edited through diagram-js commands |
| [0007](adr/0007-runtime-rest-split-and-security.md) | The runtime REST API in a core and a dev part; libraries never own security |
| [0008](adr/0008-distribution.md) | Distribution: desktop bundles, the jar, Docker, a browser-only build, building from source |
| [0009](adr/0009-embeddable-starter.md) | Proposed: an embeddable starter next to the standalone server; publishing to Maven Central |
