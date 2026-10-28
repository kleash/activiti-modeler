# Importing a Camunda 7 model

Activiti runs Camunda 7 style models, but not their Camunda extensions: a file with `camunda:` attributes cannot be saved by the modeler (the serializer checks of [ADR 0001](../adr/0001-web-modeler-on-bpmn-io.md) refuse it) and the Activiti engine ignores or rejects what it does not know. The modeler therefore offers to **convert** such a file when you open or import it, and tells you exactly what it could not carry over.

## The offer

Open a `.bpmn` file made with the Camunda Modeler (drop it on the window, import a zip, or open it from a folder). A strip above the diagram says that the file uses Camunda 7 extensions and counts the attributes and elements. The Problems tab lists the same file with the rule `activiti/no-camunda-extensions`.

- **Convert to Activiti...** converts the file in the open tab and opens the [report](#the-report). Nothing is written until you save: the tab is marked as changed, and **Undo** is not needed because the file on disk is untouched until `Ctrl+S`. Reload without saving and the original comes back.
- **Keep as is** hides the strip for this tab and leaves the file alone (it still cannot be saved while it has Camunda extensions, and the Problems tab keeps saying so).
- When you import several processes at once only one of them opens; a notice says how many of them use Camunda extensions. Open each one and convert it.
- **File > Convert Camunda 7 extensions...** converts the open file at any time, **File > Camunda 7 import report...** shows the report of this session again.
- A Camunda 8 (Zeebe) model gets a different notice: only the BPMN structure can be kept, the Zeebe extensions have no meaning for Activiti. A file that only carries metadata of the Camunda Modeler (`modeler:` attributes, `exporter`) is cleaned the same way.
- The setting **Offer to convert files that use Camunda 7 extensions** ([Settings](modeler-basics.md#settings)) switches the strip and the notice off.

## What is translated

| Camunda 7 | Activiti 9 |
|---|---|
| `camunda:assignee`, `candidateUsers`, `candidateGroups`, `dueDate`, `priority`, `formKey`, `initiator`, `candidateStarterUsers`, `candidateStarterGroups` | the same `activiti:` attributes |
| `camunda:class`, `expression`, `delegateExpression`, `resultVariable` | `activiti:class`, `activiti:expression`, `activiti:delegateExpression`, `activiti:resultVariableName` |
| `camunda:asyncBefore`, `camunda:exclusive`, `camunda:failedJobRetryTimeCycle` | `activiti:async`, `activiti:exclusive`, `activiti:failedJobRetryTimeCycle` |
| `camunda:taskListener`, `camunda:executionListener` (class, expression, delegate expression, fields) | `activiti:taskListener`, `activiti:executionListener`; events Activiti does not have are dropped |
| `camunda:field` | `activiti:field` |
| `camunda:formData` / `camunda:formField` | `activiti:formProperty` (type, default, required, enum values) |
| `camunda:in`, `camunda:out` of a call activity | `activiti:in`, `activiti:out` (source, source expression, target; `camunda:in variables="all"` becomes `inheritVariables="true"`, `camunda:out variables="all"` becomes `MAP_ALL_OUTPUTS`) |
| `camunda:inputOutput` of a connector, decision task, user task, call activity or message event | the [input / output mapping](properties/input-output-mapping.md) of the extensions file: text and expressions as `VALUE`, a plain variable name as `VARIABLE`, lists and maps as JSON values |
| Business rule task with `camunda:decisionRef`, `resultVariable`, `mapDecisionResult` | a service task on the DMN connector (`dmn-connector.EXECUTE_TABLE`), the decision id in the `_activiti_dmn_table_` constant, the decision's inputs mapped by name and its output columns mapped to the result variable |
| Script tasks | `scriptFormat` and `script`; a format without an engine on the default Activiti classpath is reported |
| Standard BPMN | kept as it is, including the diagram |

A user task and a message catch event without parameters get `MAP_ALL` as new ones do (a multi-instance user task `MAP_ALL_OUTPUTS`; a signal catch event none, as a signal needs no mapping; see the *Variables of new user tasks* setting). The conversion declares every process variable that an output mapping writes, as Activiti drops the output of an undeclared variable; the type is a guess (`json` when the source is not known) and the report says so.

## The report

The report dialog lists what happened to every Camunda construct, with the element, what it was, what became of it and why:

| Kind | Meaning |
|---|---|
| **Dropped** | Nothing like it exists in Activiti and the behaviour is gone: `asyncAfter`, job priority, history time to live, version tag, follow-up date, external tasks (`topic`), Camunda forms (`formRef`), tenants, CMMN cases, conditional events, script listeners, and an output parameter that is an expression (Activiti refuses an expression in an output mapping). |
| **Converted with differences** | Translated, but Activiti behaves differently: for example `camunda:out variables="all"` (the called process needs an entry in its own extensions file), or a script format that needs a JSR-223 engine on the classpath. |
| **Notes** | Metadata and defaults without a change in behaviour. |

**Save as Markdown** downloads `<file>.camunda-import.md` with the same tables, for a review or a ticket; **Copy as Markdown** puts it on the clipboard. The translations that were made are listed too (collapsed in the dialog).

## After the conversion

The converted file passes the same checks as any file: the export refuses a Camunda or Zeebe namespace, so what you save has none left, and the lint reports what is wrong for Activiti (for example a service task without an implementation after its `topic` was dropped). Run the process with a [scenario](scenarios.md) before you rely on it.

The conversion is a pure function (`convertCamundaBpmn` in `modeler/packages/activiti-project/src/import/camunda/`), so it can also run outside the browser; see the [developer guide](../developer-guide.md#camunda-7-importer).
