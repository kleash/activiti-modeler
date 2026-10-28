# ADR 0003: Model file contract (BPMN + extensions JSON + DMN + connectors)

- Status: Accepted
- Date: 2026-10-26

## Context

Activiti 9's Spring Boot layer reads per-process data from a sidecar `<name>-extensions.json`:
- variable definitions;
- input and output mappings;
- constants.

Without a mapping, connector inputs are empty and its outputs are dropped. User-task completion variables and call-activity outputs are not propagated either. See [R1 §0.3 and §6.2](../research/activiti-9-bpmn-support.md).

The engine also has parser and serializer traps:
- `isExecutable` must be true;
- XML must be pretty-printed around `multiInstanceLoopCharacteristics`;
- XSD child order is enforced;
- only `activiti:` attributes count for the strict attribute list.

On Activiti 9.0.0 and Boot 3.5.16, `.dmn` files auto-deploy into the same Activiti deployment as the BPMN when `**.dmn` is added to `spring.activiti.process-definition-location-suffixes`, and can then be read through `RepositoryService.getResourceAsStream`. `HistoryAndDeploymentSettingsTest` (verification harness) asserts it, and that the files are left out without the suffix.

Spring auto-deployment stores **absolute file paths** as resource names (`determineResourceName`). In `deployment-mode=default`, all resources go into one deployment, all or nothing. Only `never-fail` and `fail-on-no-process` validate each model and skip invalid ones, which silently drops models.

## Decision

A **project** has this layout, which is also the export zip and can be dropped into `src/main/resources/` of a Spring Boot app:

```
<project>/
  project.json                         project descriptor: name, version, Activiti target, created/modified
  processes/<name>.bpmn20.xml          BPMN 2.0, namespace activiti = http://activiti.org/bpmn, never camunda:/zeebe:
  processes/<name>-extensions.json     { id, extensions: { <processId>: { properties, mappings, constants, templates?, assignments? } } }
  processes/<name>.dmn                 DMN 1.3, portable conventions (see ADR 0004)
  connectors/<name>.json               connector definitions (Activiti connector schema; descriptors only)
  scenarios/<name>.scenario.json       test scenarios (ADR 0005), never deployed
  forms/<key>.form                     reserved for form-js forms, referenced by activiti:formKey; kept as text, never deployed
```

Serializer guarantees, enforced by tests:
1. `isExecutable="true"` on every executable process.
2. Pretty-printed XML, with a newline and indent after `</multiInstanceLoopCharacteristics>`.
3. XSD child order: documentation, extensionElements, laneSet, flow elements, then artifacts.
4. Valid NCName IDs of at most 255 characters.
5. Only `activiti:` extension attributes. Unknown foreign attributes are preserved but trigger a lint error. The exception is an allow-list of diagram-only namespaces (`bioc:` and `color:` from the colour picker, and `bpmndi`/`dc`/`di`). A coloured model is part of the corpus, to prove the engine tolerates them.
6. Every QName prefix used in an attribute value is declared. For example, `itemSubjectRef="xsd:string"` needs `xmlns:xsd`: an undeclared prefix makes Activiti reject the **whole deployment** with `UndeclaredPrefix`. The export check code is `UNDECLARED_PREFIX`.

Extensions rules:
- **Only fields known to the Activiti 9.0.0 model classes** are written (`ProcessExtensionModel`, `Extension`, `VariableDefinition`, `ProcessVariablesMapping`, `Mapping`, `ProcessConstantsMapping`, `TemplatesDefinition`, `AssignmentDefinition`).
  - The runtime reads the file with the host's `ObjectMapper` bean. Spring Boot's JSON auto-configuration ignores unknown properties, but a host without it gets Activiti's plain mapper, which fails on them: an APA-style top-level `name` / `type`, for example, fails with `UnrecognizedPropertyException`.
  - Unknown fields in an imported file produce an import warning and are dropped on export, and the export result reports it.
- **Connector definitions (`connectors/*.json`) follow the same rule.**
  - The runtime reads every `.json` file in `activiti.connectors.dir` into `ConnectorDefinition {id, name, description, actions}`, `ActionDefinition {id, name, description, inputs, outputs}` and `VariableDefinition {id, name, description, type, required, display, displayName, analytics, ephemeral}`, using the host's `ObjectMapper`.
  - So these files hold **only those fields**. Modeler-only metadata, such as the template `version` and connector `config` from the Alfresco schema, lives in `project.json` under `connectors.<name>`. `project.json` is never deployed.
  - The harness reads every project's extensions and connector files with a **strict** mapper (`FAIL_ON_UNKNOWN_PROPERTIES`), so a lenient host cannot hide this class of bug.
- Keys are BPMN element IDs, and the store renames or deletes keys together with the elements.
- The top-level key is the process ID.
- Every output-mapping target is declared in `properties`, because the runtime skips undeclared targets.

## Consequences

- The modeler edits two documents per process as one unit, sharing one undo stack (ADR 0006).
- The Spring Boot apps of the project (the verification harness and the modeler server) set the location suffixes to `**.bpmn20.xml,**.bpmn,**.dmn`, and use `deployment-mode=default`.
- Tests assert the resource names of every deployment, including `.dmn` and `-extensions.json`, and its definition keys. They never assume a resource was picked up.
- Code that resolves resources by name compares base names, because Spring stores absolute paths.
- Spring auto-deployment patterns (`classpath*:**/processes/` + `**.dmn`) do **not** descend into sub folders of `processes/`. BPMN, extensions and DMN files must sit directly in `processes/`, which is the ADR layout above. The exporter enforces this.
