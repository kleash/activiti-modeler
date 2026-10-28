# ADR 0006: The extensions JSON is edited through diagram-js commands

- Status: Accepted
- Date: 2026-10-26

## Context

Each process has a sidecar `<name>-extensions.json` (ADR 0003) that must stay consistent with the BPMN:
- **Keys:** they are element IDs and the process ID.
- **Undo/redo:** it must cover edits to both files.
- **Dirty state and save:** both files are saved and flagged dirty together.

No bpmn.io module handles a second document.

## Decision

- **The store:** an `extensionsStore` service is registered in the bpmn-js injector. It holds the parsed JSON for the open diagram.
- **Commands:** every change goes through diagram-js commands (`activiti.extensions.update`), so the command stack is the single undo/redo history.
- **ID changes:**
  - A `CommandInterceptor` renames `mappings`, `constants`, `assignments` and `templates.tasks` keys when an element ID changes, and the top-level key when the process ID changes.
  - It removes those keys when elements are deleted.
  - It copies them on copy/paste, with the new IDs.
- **Who reads it:**
  - The properties panel reads and writes through the store.
  - The variable resolver and lint rules read from it.
  - Saving serializes both documents.
- **Unknown JSON:** fields the runtime model knows but we don't edit (`templates`, `assignments`) are preserved on save. Fields the runtime model doesn't know are dropped with a warning (ADR 0003).
- **Default mappings:** without a mapping, Activiti 9 drops user-task completion variables, call-activity return variables and message payloads (R1 §0.3-17). Users coming from classic Activiti, Camunda or Flowable expect them to flow.
  - **New elements:** newly created user tasks and call activities get `mappingType: MAP_ALL` by default, and so do message catch events (intermediate, boundary and event-sub-process start). A setting can switch this to "none".
  - **Multi-instance user tasks get `MAP_ALL_OUTPUTS`** (engine finding C20.1). `MAP_ALL` hands a task all variables of its execution, including the loop variables of a multi-instance instance, and writes them back as local variables; on a parallel multi-instance user task that wedges the process instance. The completion variables of a multi-instance task stay local to the instance (the output collection collects them) whatever the mapping, so `MAP_ALL_OUTPUTS` costs nothing and behaves like no mapping on the parallel and the sequential kind. A user task that **becomes** multi-instance (the `loopCharacteristics` change) has its mapping switched in the same undo step when it is exactly the old default; turning multi-instance off puts `MAP_ALL` back only when the behaviour set the multi-instance default itself and nothing changed it since. A mapping the user chose is never overwritten.
  - **Signal catch events get no default mapping** (engine findings 37 and C20.2). The payload of a signal reaches the process without one, and Activiti applies no mapping to a signal catch event, so a `MAP_ALL` there does nothing; the lint rule `signal-catch-has-mapping` warns about one.
  - **Connector service tasks** get **no** default mapping; their template creates explicit mappings.
  - **Imported elements** are never changed. Lint rule L9 warns when one of these elements has no mapping, with a quick fix to add `MAP_ALL`. Lint also warns about `MAP_ALL` / `MAP_ALL_INPUTS` on a parallel multi-instance user task (`parallel-multi-instance-user-task-map-all`).
  - **Proof:** the C20 projects are built with the defaults and their scenarios assert, on the engine, that completion variables, call-activity outputs and message payloads reach the process; control runs without each mapping fail, apart from the signal one (C20-order).

## Consequences

- Undo, redo, dirty state and autosave behave as if there were one document.
- Lint can validate cross-document rules, such as an undeclared output-mapping target or a mapping keyed to a missing element.
