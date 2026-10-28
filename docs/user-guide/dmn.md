# DMN editor and decision tester

A `.dmn` file opens in the DMN editor (dmn-js 18). This page covers the views, what the modeler does to a DMN file when it saves, how older DMN files are migrated, the decision tester, and how the decisions of a file reach the decision tasks of a process. The rules a portable DMN file follows are in [Portable DMN conventions](dmn-conventions.md); the editor writes them for you.

## The editor

Above the canvas there is one chip per view of the file:

| View | What it edits |
|---|---|
| **DRD** | the Decision Requirements Diagram: decisions, input data, business knowledge models, knowledge sources, text annotations and the requirements between them. |
| a **decision table** chip per decision table | rules as rows. Click a cell to edit it. The hit policy (all seven: UNIQUE, FIRST, PRIORITY, ANY, COLLECT, RULE ORDER, OUTPUT ORDER) and the COLLECT aggregator (none, SUM, MIN, MAX, COUNT) are chosen in the top left cell of the table. Input and output columns are added, removed and edited from their header; allowed values (`inputValues`, `outputValues`) are edited in the column dialog. |
| a **literal expression** chip per literal expression | the FEEL text and the variable (name and type) of the decision. |
| a **boxed expression** chip per business knowledge model | function definitions with a literal expression body. |

To make a decision a table or a literal expression, put a decision on the DRD, open its context pad (the wrench) and choose **Edit decision table** or **Edit literal expression** (the "replace" menu). Replacing creates a new element with the id and the name of the old one. Double-click a decision (or a click on its table icon) to open its view; the DRD chip goes back.

Below the canvas, **Model** and **XML** switch between the editors and the XML source. In the XML view **Apply** parses the text and replaces the model; **Revert** discards the changes. The bpmn.io watermark is visible on every view.

### Properties of the DRD

While the DRD is open, the properties panel on the right (`Ctrl+P`) shows the selected element, or the definitions when nothing is selected: **General** (name and ID), **Documentation** (the description, written as `<description>` in the file) and **Variable** (the FEEL type of the decision or input data variable). It works for the definitions, decisions, input data, business knowledge models, knowledge sources and text annotations. An ID that is taken or has a space is refused with a message under the field; a rename of the ID or the name is one undo step of the DRD. The panel is dmn-js's generic one (`dmn-js-properties-panel`): the question and the allowed answers of a decision, which Activiti does not read, are not offered, and there are no Camunda or Zeebe groups. In a decision table or an expression view the panel says that its properties are shown while the DRD is open.

### FEEL editing

Input expressions, rule entries and literal expressions are FEEL. The editor offers FEEL completion with **variable suggestions**:

- the inputs of the DRD (the input data elements the decision requires, and the outputs of the decisions it requires);
- the **process variables of the project**: the variables that the processes calling this DMN file (by decision id, file name or model name) can provide, read from their extensions files.

The data type list (`common.dataTypes`) holds the FEEL types: `string`, `number`, `boolean`, `date`, `time`, `date and time`, `days and time duration`, `years and months duration`, `Any`. The editor waits 250 ms after typing before it records a change, so one undo step covers a word, not a letter.

Only FEEL is offered as expression language. Boxed contexts and invocations cannot be authored in the dmn-js 18 boxed editor (they open read-only in XML); they are KIE-only anyway (see the conventions).

### Search and keys

`Ctrl+F` on the DRD opens the search pad (U7): type a decision, input or requirement name; the matching element is selected and centered. The other keys of the shell apply: `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo in the **active view** (each view has its own history; switching to another view starts that view's history again), `Ctrl+S` saves, the zoom keys zoom the DRD. The DRD can be exported as an image (**File > Export diagram as SVG / PNG**).

### Dirty, save, undo

The tab shows the dot when the model differs from what was last saved. **Save** writes the *normalized* file (below), and lists what it changed under "Import warnings" in the bottom panel (`Ctrl+B`). The working copy is also updated about a second after the last edit, so the lint, the catalog and the decision task pickers see the new decisions of the file before you save.

## What the modeler writes: the normalizer

`normalizeDmn` (a pure function of the `activiti-project` package, with tests) is applied on save and on import. It brings any DMN file to the conventions, reports every change, and leaves a file that already follows them **byte for byte untouched**. Running it twice changes nothing.

| Rule | What it does |
|---|---|
| Namespace | DMN 1.2 (`.../20180521/MODEL/`) is moved to 1.3 (`.../20191111/MODEL/`). DMN 1.1 is migrated (below). The definitions get an `id`, a `name` and a `namespace` if missing. |
| Foreign attributes | attributes and namespaces of other engines (`camunda:`, `zeebe:`, `modeler:` and the like) are removed. |
| Variables | every decision, input data, business knowledge model and decision service has a `<variable>` named like the element. dmn-js does not write them. |
| FEEL type names | `integer`, `long`, `double`, `float` become `number`; `dateTime` becomes `date and time`; and so on. |
| Input data | an input column whose expression is a plain variable name (`age`) gets an `inputData` element named `age`, an `informationRequirement` to it, and its diagram shape and edge. |
| Empty input entries | an empty cell becomes `-` (a null entry would never match). |
| Output names | the single output of a table is named like the decision variable; a table with several outputs must name each (a note is reported otherwise). |
| Rule ids | rules get `<decisionId>_rule<n>` when they have none; existing rule ids are never changed. |
| Warnings | PRIORITY and OUTPUT ORDER without literal `outputValues` (the order cannot be known). |

Rule ids and decision ids are a contract: scenarios assert `matchedRules` by rule id, and a decision task names a decision by id. The editor never renames them on its own.

### Opening DMN 1.1 and 1.2 files

DMN 1.1 files go through `@bpmn-io/dmn-migrate` when they open. The tab is marked as changed (the file on disk is not touched until you save) and the editor lists what the migration did under "Import warnings" in the bottom panel. For example `corpus/N01-negative/seed/processes/legacy-discount.dmn` opens migrated to 1.3; the lint rule `activiti/dmn-legacy-version` reports the file until you save it. A `.dmn` file that is not DMN at all (no DMN namespace) opens in the XML text editor instead of the error view.

## The decision tester

**Test decision** (top right of the DMN editor) opens the tester under the canvas. It evaluates a decision on the modeler server (`POST /api/dev/decisions/evaluate`, see [modeler server](modeler-server.md)) with the engine selected there (Operaton or KIE).

1. **Decision.** Choose the decision of the file. A DRD asks for the inputs of the whole chain (input data and table inputs of the required decisions).
2. **Inputs.** One typed field per input: text for `string`, a number field, a true/false select for `boolean`, a dropdown when the column lists allowed values, date and time fields in ISO form. Leaving a field empty sends `null`.
3. **Evaluate.** The result is shown as rows (one per matched rule for multi results, the single value otherwise), the decision's variables and the evaluation steps. In the table view the **matched rules are highlighted**; in the DRD, the evaluated decisions are marked.
4. **Source.** *This file* sends the open (possibly unsaved) text; *A deployment* evaluates a DMN that is deployed on the server.

The inputs are remembered **per file and project** in the browser (`localStorage`), so the next test of the same file starts with them. Nothing leaves the browser except the evaluation request.

The tester uses the **one connection of the modeler** ([Run > Connect to server](running.md#connect-to-a-server)); under the form it shows the server and a **Connect...** button. Without a connection **Evaluate** sends nothing, says so and opens the connection dialog; with a server that refuses the user, the message says what to do (a 401 names the user, a 403 asks for a user with the admin role).

## Decision tasks and DMN changes

A decision task (a service task on `dmn-connector.EXECUTE_TABLE`) names a decision by id, and its mapping lists the inputs and outputs of that decision (see [the Decision group](properties/decision.md)). When the DMN file changes after the task was wired:

- the Decision group of the properties panel shows **"The mapping is stale"** when the task reads an output the decision does not return any more, or maps an input the decision does not read any more; the hint names the missing variables and offers **Map the inputs / Map the outputs** to rewrite the rows;
- lint rules L23 (the decision does not exist) and L37 (an output of the mapping does not exist) report the same on the Problems panel.

Because the editor updates the working copy while you edit, the hint appears as soon as you rename an output column or change an input expression, before the DMN file is saved.

## For tests and the corpus

`window.__modelerTestApi` (test and corpus builds only, `VITE_MODELER_TEST_API=true`) can create DMN files through the dmn-js modeling APIs, the same as the UI does: `createDmn`, `addDecisionTable`, `addLiteralDecision`, `addContextDecision`, `addInputData`, `addBusinessKnowledgeModel`, `addKnowledgeSource`, `addTextAnnotation`, `addRequirement`, `setHitPolicy`, `addTableInput`, `addTableOutput`, `addTableRule`, `renameDmnElement`, `undoDmn`, `currentDmnXml` and `diffDmn`. The corpus builds `corpus/C16-dmn-hit-policies/build.ts`, `C17-dmn-drd/build.ts` and `C17-dmn-drd-kie/build.ts` model the seeds with them, and the corpus spec compares each generated `.dmn` with its seed by `diffDmn`: decisions, input data, BKMs, rules and their ids, names, type references, expressions, hit policies and entries have to be equal; the diagram, namespace, id of other elements and the order of requirements are ignored.
