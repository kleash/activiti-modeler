# Modeler basics

This page covers the shell of the modeler: projects and where they are stored, files and tabs, the editing tools of the diagram, the XML and JSON views, exporting, and every keyboard shortcut. The properties panel is described below, and the Problems panel (lint) after the editing tools; the run, test and simulation panels are described in [Running and testing from the modeler](running.md).

Contents: [projects](#projects-and-storage) - [files and tabs](#files-and-tabs) - [new files from templates](#new-files-from-templates) - [saving](#saving) - [editing a diagram](#editing-a-diagram) - [the properties panel](#the-properties-panel) - [problems panel](#problems-panel) - [XML and JSON views](#xml-and-extensions-json-views) - [problems with a file](#when-a-file-cannot-be-opened) - [export](#export) - [drag and drop](#drag-and-drop) - [layout](#layout-and-panels) - [shortcuts](#keyboard-shortcuts)

## Projects and storage

A **project** is a set of files in the layout of [ADR 0003](../adr/0003-model-file-contract.md). It is also the layout of the export zip, so a project can be unpacked into `src/main/resources/` of a Spring Boot app:

```
my-project/
  project.json                     name, version, Activiti target (9.0.0)
  processes/order.bpmn20.xml       a process
  processes/order-extensions.json  its variables, mappings and constants (the "extensions" sidecar)
  processes/rules.dmn              DMN decisions (next to the BPMN, not in a sub folder)
  connectors/mailer.json           connector definitions
  scenarios/happy.scenario.json    test scenarios
```

The modeler starts with the project of your last session. The first time it creates `my-project` with one empty process. Switch, create, import and delete projects in **File > Open project** (`Ctrl+O`).

Where a project lives is your choice. The status bar names it (for example `Browser workspace: my-project`).

| Storage | How | Notes |
|---|---|---|
| **Browser workspace** | the default | Files are kept in your browser's IndexedDB, so the modeler works offline. They stay in this browser profile: export a zip to back them up or move them. |
| **Local folder** | **File > Open local folder...** | The folder is the project root and files are read and written in place. Needs a browser with the File System Access API (Chrome, Edge); the menu entry is disabled elsewhere. Only text files (`.xml`, `.bpmn`, `.dmn`, `.json`, `.form`, `.md`, ...) are part of the project; hidden folders, `node_modules`, `target` and build folders are skipped. The browser asks once for permission. |
| **Server workspace** | **File > Open server workspace...** | A project folder on the disk of the modeler server, through `GET`, `PUT` and `DELETE /api/dev/workspace/...` (the dev endpoint of `activiti-runtime-rest-dev`, served by the modeler server). You enter the workspace URL, the dialog lists the projects (the top-level folders of the workspace), and you pick one or type a new name to start a project there. Files are read and written on the server; the status bar says `Server workspace: <project>`. The endpoint needs the dev API to be switched on and the server's admin login. |
| **Zip** | **File > Export project as zip**, **File > Import project zip...**, or drop a zip on the page | Export saves everything first and puts the files at the root of the zip. Import creates a new project of the browser workspace; a zip made with "compress folder" (one wrapper folder) is unwrapped, hidden and binary files are skipped, and the import tells you what it skipped. |

**Autosave and recovery.** While a file has unsaved changes the modeler keeps a draft of it in the browser a moment after each change. If the page is reloaded or the browser crashes, the project opens again with the unsaved changes in place (a notice says how many files were recovered) and the tabs are dirty until you save. Saving removes the draft; closing a tab with "Don't save" does too.

**Recent projects.** The projects dialog lists the recently opened projects, most recent first, including local folders. Reopen a folder from the list and the browser may ask for permission again. After a reload the modeler reopens the last project and the tabs that were open.

## Files and tabs

The **project explorer** on the left shows the files as a tree. Double-click a file (or press `Enter`) to open it; `F2` renames it, `Delete` deletes it, and the context menu (right-click) offers the same. A dot marks files with unsaved changes. A process and its `-extensions.json` file are one unit: renaming or deleting the process takes its extensions file along, and opening the extensions file opens the process in the JSON view.

Every open file has a **tab**. A dot in the tab marks unsaved changes. Closing a tab with unsaved changes asks: **Save**, **Don't save** or **Cancel**. `Ctrl+Shift+T` reopens the last closed tab, `Ctrl+Tab` and `Ctrl+Shift+Tab` switch tabs. Every tab keeps its own diagram, view and undo history while it is hidden.

| File | Opens in |
|---|---|
| `*.bpmn20.xml`, `*.bpmn` | the diagram editor (with the XML and extensions JSON views) |
| `*.dmn` | the [DMN editor](dmn.md) (DRD, decision tables, literal and boxed expressions, with the decision tester). A file that is not DMN at all opens in the plain XML editor. |
| `*-extensions.json`, `*.scenario.json`, `connectors/*.json`, other JSON | a JSON editor with error markers |
| anything else (`.md`, `.properties`, ...) | a plain text editor |

## New files from templates

**File > New file** (`Ctrl+N`, or the **+** in the explorer) offers templates. You type a name; ids are chosen so that everything in the project stays deployable (every process id and decision id is unique).

| Template | Creates |
|---|---|
| Empty process | an executable process with a start event, plus its extensions file |
| User task approval | start, a user task for the group `managers`, an "Approved?" exclusive gateway with a default flow, two end events; a `MAP_ALL` mapping for the task and the `approved` variable declared |
| Connector call | a service task on `mailer.SEND` with input and output mappings and declared variables, plus `connectors/mailer.json` |
| Decision task | a service task on `dmn-connector.EXECUTE_TABLE` whose `_activiti_dmn_table_` constant holds the decision id (ADR 0004), with mappings, plus a DMN decision table next to it |
| DMN decision table | one decision with a UNIQUE decision table, in the portable conventions of [DMN conventions](dmn-conventions.md) |
| DMN DRD | two decisions and two inputs, one decision requiring the other |
| Scenario file | a scenario that starts the first process of the project and expects it to complete |
| Connector definition | a connector descriptor with one action (its name must not contain a dot) |

A template never overwrites a file; a name that exists is refused in the dialog.

## Saving

- **Save** (`Ctrl+S`) writes the tab's files. For a process that is the BPMN file and its extensions file, both checked against the serializer guarantees of ADR 0003 first: if one is broken (for example a `camunda:` attribute that came in through the XML view) nothing is written and a dialog explains why.
- **Save as** (`Ctrl+Shift+S`) asks for a new project path (`processes/order.bpmn20.xml`), writes the copy and its extensions file, and the tab edits the new file from then on. The original keeps what it had on disk. If the copy has the same process id as another file, you are told, because both would deploy as versions of one process.
- **Save all** (`Ctrl+Alt+S`) saves every tab with unsaved changes.
- **Move to origin on save.** The saved diagram is shifted so that its top-left corner is at (0, 0). The canvas is not moved by saving. **View > Move diagram to origin** (`Ctrl+Shift+O`) does the same on the canvas as an undoable step.

## Editing a diagram

The palette, context pad and replace menu offer only what Activiti 9 runs (see the [feature matrix](../FEATURE_MATRIX.md) section A and C); there is a "Decision task" palette entry for the DMN connector.

| Tool | How |
|---|---|
| Hand tool | `H`, or the palette; hold `Space` to pan; the mouse wheel scrolls and `Ctrl` with the wheel zooms |
| Lasso | `L`: drag a rectangle to select |
| Space tool | `S`: drag a line to make room (elements on the far side move) |
| Global connect | `C`: click a source, then a target; the right kind of flow is chosen |
| Align and distribute | select two or more elements, then **Edit > Align elements** / **Distribute elements** |
| Auto-place | the context pad's append entries put the new element right of the source and connect it |
| Auto-resize | sub-processes grow when you move an element over their edge |
| Snapping | elements snap to a grid and to the edges of other elements; **View > Grid** switches the grid and grid snapping off and on |
| Label editing | double-click, or select and press `E` |
| Copy, cut, paste, duplicate | `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+D`. After paste or duplicate, click where the copy goes. Copy in one tab and paste in another: the elements travel through the system clipboard (allow clipboard access if the browser asks) and fall back to a clipboard shared by the tabs of the page. Mappings and constants of copied elements go with them. |
| Undo, redo | `Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z`. One history covers the diagram and the extensions JSON. |
| Zoom | `Ctrl+=`, `Ctrl+-`, `Ctrl+0` (actual size), `Ctrl+1` (fit the diagram) |
| Search | `Ctrl+F`: type part of a name or id, `Enter` selects the match |
| Minimap | **View > Minimap** or the button at the top right of the canvas; the choice is remembered |
| Replace | `R` opens the replace menu of the selected element |
| Create, append | `N` opens the [create menu](#create-and-append-menus) (a new element where you click), `A` the append menu of the selected element |
| Colours | the context pad's colour entry sets the fill and the stroke of the selection, [diagram only](#colours) |

The single-letter keys work while the canvas has the focus (click it first). They also work on non-Latin keyboard layouts, which are matched by the physical key.

### Create and append menus

`N` opens a searchable menu of every element Activiti 9 runs, grouped (Tasks, Gateways, Events, Sub-processes, Data, Participants). Each entry has a sentence about how Activiti treats the element and, where the user guide has a page, a link to it. Choose an entry and click on the canvas to place the element. `A` opens the same kind of menu for the selected element: the new element is placed after it and connected, a boundary event is attached to it. Nothing the engine does not run is offered, in the list or in the search: no complex gateway, no conditional or escalation event, no business rule task (the **Decision task** entry creates a service task on the DMN connector instead), and only what can follow the selected element (behind an event-based gateway: the catch events only). With nothing appendable selected, `A` opens the create menu.

An element at the end of a flow (a start event, a task whose flow stops, an event with no outgoing flow) shows a small **+** next to it: click it to open the append menu. The palette is one stop of the `Tab` order: move through its entries with the arrow keys, `Enter` or `Space` activates a tool or puts the new element in the middle of the visible canvas, `Escape` returns to the canvas. It announces itself as a toolbar with named buttons to screen readers.

### Colours

The context pad has a colour entry. It sets the fill and the stroke of the selected elements with a picker and a few presets, and writes only the diagram's `bioc:` and `color:` attributes on the shape; the BPMN process itself is not touched, so the colours never change what runs. The attributes are standard diagram attributes, not Camunda ones: the export and the lint accept them.

## The properties panel

Select an element (or click the empty canvas to select the process) and the **properties panel** on the right (`Ctrl+P` shows and hides it) lists the groups of that element. The panel offers only what Activiti 9 runs for the selected element: a user task has assignment, form and task listeners, a service task has the implementation, a timer event has the timer group, and so on. Every field writes the same XML as the test API and the corpus builds, one undoable step per change.

- **Groups** are collapsible. Which groups are open is remembered in this browser.
- **Typing** is applied about half a second after the last key; a value that is not valid (an id with a space, a malformed duration, an expression that does not parse) is marked under the field and not written. The model keeps the previous value.
- **Tooltips.** The `?` of a group or field explains the Activiti meaning, what the engine does with it, and links to the page of the group below.
- **Expression fields** (conditions, assignees, listeners, scripts, multi-instance) use a small editor with JUEL highlighting, bracket matching, syntax errors and completion: type `${` or press `Ctrl+Space` for the process variables of the extensions file and the diagram.
- **Lists** (listeners, fields, parameters, messages, signals, errors, data objects) have an add button and, per item, delete and move up/down. A row that is not complete yet stays in the panel and is written to the model once it is.
- **Problems** reported by the validation panel focus the field they are about (select the element, open its group, focus the entry).

| Group | Page |
|---|---|
| General, Documentation | [general](properties/general.md), [documentation](properties/documentation.md) |
| Candidate starters, Start initiator and form | [candidate starters](properties/candidate-starters.md), [start initiator](properties/start-initiator-form.md) |
| Messages, Signals, Errors | [messages, signals and errors](properties/messages-signals-errors.md) |
| Event listeners, Execution listeners, Task listeners | [event](properties/event-listeners.md), [execution](properties/execution-listeners.md), [task](properties/task-listeners.md) |
| User assignment, Form | [user assignment](properties/user-assignment.md), [form](properties/form.md) |
| Implementation, Field injection, Mail and shell fields | [implementation](properties/implementation.md), [field injection](properties/field-injection.md), [mail and shell](properties/mail-shell-fields.md) |
| Script, Called element | [script](properties/script.md), [called element](properties/called-element.md) |
| Multi-instance, Asynchronous continuation, Job execution, Error mapping | [multi-instance](properties/multi-instance.md), [asynchronous](properties/asynchronous-continuation.md), [job execution](properties/job-execution.md), [error mapping](properties/error-mapping.md) |
| Timer, Message / signal / error / link / compensation / terminate events | [timer](properties/timer.md), [event definitions](properties/event-definitions.md) |
| Process variables, Input / output mapping, Constants, Decision, Template | [process variables](properties/process-variables.md), [input / output mapping](properties/input-output-mapping.md), [constants](properties/constants.md), [decision](properties/decision.md), [template](properties/template.md) |
| Condition, Skip expression, Data object | [condition](properties/condition.md), [skip expression](properties/skip-expression.md), [data object](properties/data-object.md) |

The variables, mappings and constants of the extensions file are edited in the panel too (the groups above); the Extensions JSON view shows exactly what they write. Connector definitions have their own editor: [Connectors and element templates](connectors.md).

### The variables outline

**View > Variables** opens the **Variables** tab of the bottom panel: every variable of the process with its type, its scope (the process, or local to one task), where it is written and where it is read. Writers are declared variables, result variables, output mappings, `activiti:out`, form properties and so on; readers are all `${...}` expressions, conditions, mappings and `activiti:in` sources. A variable that nothing writes is marked as external (it comes with the start or from the caller). The chips in the *Written by* and *Read by* columns select the element; the highlight button marks the writers (green) and readers (blue) of a variable on the canvas. **Only the selected element** shows what the selection reads and writes. The same extraction feeds the variable suggestions of the JUEL editors.

## XML and extensions JSON views

Below every process are three views: **Diagram**, **XML** and **Extensions JSON**.

- **XML** shows the BPMN source in a code editor. Edit it, then press **Apply to diagram** (or switch back to the diagram, which applies pending edits). XML that does not parse is marked at its line and column and is **never applied**: the diagram stays as it was, and you can fix the source or **Revert**. Saving with an unapplied, broken source is refused with the reason. Source that parses but breaks a serializer guarantee applies, and the save then refuses it.
- **Extensions JSON** shows the process's `-extensions.json`. Valid edits are applied to the open diagram while you type (about a quarter of a second after the last key) as one undoable step; undo, redo and changes made on the diagram show up in the text. JSON that does not parse, or has the wrong shape, is marked and not applied, and blocks saving until it is fixed. Fields that Activiti 9.0.0 does not know are marked with a warning and are dropped when the file is saved.

## When a file cannot be opened

- **Import warnings.** A file that opens but has findings (a diagram shape for an element that does not exist, extensions fields that the runtime ignores) shows them in the **bottom panel** (`Ctrl+B`), under "Import warnings", grouped by file.
- **Error tab.** A file that an editor cannot open (not XML, not a BPMN document, an extensions file that is not JSON) opens as an error tab that says why, keeps the file unchanged, and offers **Open ... as text**. Fix it there, save, and use "Open it in the diagram editor". Other tabs are not affected.

## Export

- **File > Export diagram as SVG** and **as PNG** (`Ctrl+Shift+E` asks which) download the diagram of the current tab.
- **Edit > Copy selection as image** (`Ctrl+Shift+C`) puts the selected elements on the clipboard as a PNG (the browser may ask for clipboard permission).
- **File > Export project as zip** downloads the project, see [Projects and storage](#projects-and-storage).

### Using the files in a Spring Boot application

After **File > Export project as zip** a dialog says how an application uses the files (**Don't show this again** switches it off; **File > Settings** switches it on again):

- Copy `processes/`, the `.bpmn20.xml` files and their `-extensions.json` files, into `src/main/resources/processes/` of an application with `activiti-spring-boot-starter`, and `connectors/` into `src/main/resources/connectors/`.
- The `-extensions.json` files are part of Activiti, not of the modeler. Without them, the variables that a user task, a call activity, a connector or a message catch event hands back do not reach the process: a gateway that reads a variable a user task was completed with fails with `Unknown property used in expression` ([engine finding C21.9](../engine-findings.md#c21-coverage-extras)).
- `project.json` is the modeler's own project file. The application does not need it.
- Decision tasks need more, because Activiti has no DMN engine: the dependency `io.github.kleash.activiti:activiti-dmn-connector`, the `.dmn` files in the same folder as the BPMN files, and `**.dmn` in `spring.activiti.process-definition-location-suffixes`. The modeler server already includes the connector.

The [integration guide](../integration-guide.md) has the pom and the properties.

## Drag and drop

Drop files onto the page to add them to the open project, or a project zip to import it as a new project.

- A dropped `.bpmn` is stored as `.bpmn20.xml`. Files go to the folder of their kind: processes, extensions and DMN to `processes/`, `*.scenario.json` to `scenarios/`, other JSON to `connectors/`. A name that exists is kept; the new file gets the next free name (`order-2.bpmn20.xml`, with its extensions file `order-2-extensions.json`).
- The first dropped process (or DMN) opens in a tab.
- A zip replaces the open project after asking about unsaved changes. Files that are not project files (images, for example) are skipped, with a message.

## Problems panel

The modeler checks every diagram while you work, and the whole project after each change (about half a second after you stop), with the rules of [`activiti:recommended`](lint-rules/index.md): the engine's own validation rules (every problem key of the Activiti `ProcessValidator`), the constructs the modeler hides, the traps found in the engine runs, and the cross-file checks (connectors, decisions, called processes, the extensions file). Each rule has a page with the reason, the evidence and the fix.

- **Where it shows.** The **Problems** tab of the bottom panel (`Ctrl+B`) lists the problems; the status bar counts the errors and warnings of the project, and a click on the counter opens the tab; the canvas marks the elements with an icon and a list of their problems (the button at the bottom centre of the canvas switches the marks on and off).
- **Severity.** *Error*: Activiti refuses the model or runs it differently from the picture; the project cannot be deployed while an error is left ([Deploy](running.md#deploy) uses the same gate). *Warning*: it runs, probably not as you meant. *Note*: good to know. The buttons at the top of the tab show or hide each severity, and the **File** selector limits the list to one file (the open one, or any file with problems).
- **Click a problem.** The file opens, the element is selected, and the properties panel opens the group of the field the problem is about and puts the cursor in it (`activiti.lint.focus`, see the [developer guide](../developer-guide.md#lint-and-the-problems-panel)).
- **Quick fixes.** Some problems offer a button, for example *Convert to a Decision task* for a business rule task, *Replace by an exclusive gateway* for a complex gateway, *Throw the signal, then end with a none end event* for a signal end event, *Add a MAP_ALL mapping* for a user task without a mapping, *Declare the variable in the process properties* for an output mapping, and *Translate to the Activiti equivalent* (or *Remove*) for each `camunda:` attribute and element of a file made with Camunda Modeler. A fix is one change: **Undo** takes it back whole, the model and the extensions file together.
- **Importing.** A file with problems opens normally; the problems are listed at once. Constructs the modeler does not offer (business rule task, complex gateway, escalation events, group, ...) are still shown and listed, so a file keeps what it says until you decide.
- **The engine's opinion.** With a modeler server connected ([Connect to a server](running.md#connect-to-a-server)), **Validate on server** sends the project to the engine (`POST /api/dev/validate`: the Activiti validator, a trial deployment, the extensions dry load, the DMN parse). Its problems join the list, tagged *engine*, and are not repeated when a rule of the modeler already reports the same key on the same element.
- **Outside the browser.** The same rules run from the command line, for CI: `activiti-lint <project-folder>` (exit status 1 on errors; `--json`, `--max-warnings n`, `--ignore <rule>`; `--seeds` lints the `seed` folder of every project of a corpus folder). See the [rule index](lint-rules/index.md#command-line) and the [developer guide](../developer-guide.md#lint-and-the-problems-panel).

## Settings

**File > Settings...** (`Ctrl+,`) opens the settings. They are kept in this browser and change how the editor behaves, never what a file contains:

| Setting | Effect |
|---|---|
| Variables of new user tasks, call activities and message catch events | `MAP_ALL` (the Activiti default, `MAP_ALL_OUTPUTS` on a multi-instance user task, [ADR 0006](../adr/0006-extensions-store.md)) or nothing until mapped. Applies at once to elements created afterwards, and to converted Camunda files. |
| Draw a layout for a BPMN file without a diagram | A file without any diagram (written by hand, or by a tool that does not draw) gets a layout generated with `bpmn-auto-layout` when it is opened. A toast says so, the tab is marked as changed, and saving keeps the diagram. With the setting off such a file opens as an error with the XML view available. |
| Offer to convert files that use Camunda 7 extensions | See [Importing a Camunda 7 model](camunda-import.md). |
| Reopen the tabs of the last session | Tabs, their views and the active tab come back after a reload (with unsaved changes, which are kept as drafts). Off: the first process opens. |
| Explain how an application uses the files after File > Export project as zip | The dialog after an export, see [Using the files in a Spring Boot application](#using-the-files-in-a-spring-boot-application). Its **Don't show this again** switches this off. |
| Reset panel layout | Panels return to their default sizes and are shown; the minimap and the grid stay. Also in **View**. |
| Language | The texts of the interface are in one catalog; English is the only language shipped. |

## Layout and panels

The layout is: project explorer, tabs and editor, properties panel, bottom panel and status bar. The **bpmn.io watermark** at the bottom right of every canvas always stays visible: the minimap sits at the top right, panels and the status bar are separate areas, and toasts appear at the bottom left.

- `Ctrl+P` toggles the properties panel, `Ctrl+Alt+P` resets its width, `Ctrl+B` toggles the bottom panel (import warnings and the [problems](#problems-panel)), and **View > Project explorer** toggles the explorer.
- Drag the bars between panels to resize them, or focus a bar and use the arrow keys. Sizes, panel states, the minimap and the grid are remembered in the browser (`localStorage`); if it is blocked the layout lasts for the session.
- In windows narrower than 640 px the side panels are hidden to leave room for the canvas.
- The status bar shows the storage and project, whether everything is saved, the problem counters (errors and warnings, a click opens the Problems tab), the server connection (a click opens the connection dialog, see [Running](running.md#connect-to-a-server)) and the target, Activiti 9.0.0.

## Keyboard shortcuts

`Ctrl` is `Cmd` on a Mac. **Help > Keyboard shortcuts** shows the same list. Keys marked * are kept by browsers for themselves in an ordinary tab; they work in an installed app window, and every command is also in the menus.

| Group | Shortcut | Action |
|---|---|---|
| File | `Ctrl+N` * | New file |
| | `Ctrl+O` | Open project |
| | `Ctrl+S` | Save |
| | `Ctrl+Shift+S` | Save as |
| | `Ctrl+Alt+S` | Save all |
| | `Ctrl+W` * | Close tab |
| | `Ctrl+Shift+T` * | Reopen last closed tab |
| | `Ctrl+Shift+E` | Export as image |
| | `Ctrl+,` | Settings |
| Navigation | `Ctrl+Tab` *, `Ctrl+Shift+Tab` * | Next, previous tab |
| | Arrows, `Shift`+arrows | Move the selection, faster |
| | `Ctrl`+arrows | Move the canvas |
| | `Space` (held) | Pan |
| Edit | `Ctrl+Z` | Undo |
| | `Ctrl+Y`, `Ctrl+Shift+Z` | Redo |
| | `Ctrl+X`, `Ctrl+C`, `Ctrl+V` | Cut, copy, paste |
| | `Ctrl+D` | Duplicate |
| | `Ctrl+Shift+C` | Copy selection as image |
| | `Ctrl+A` | Select all |
| | `Delete`, `Backspace` | Delete the selection |
| | `Ctrl+F` | Find element |
| Tools | `H`, `L`, `S`, `C` | Hand, lasso, space, global connect |
| | `E`, `R` | Edit label, replace |
| | `N`, `A` | Create element menu, append element menu |
| View | `Ctrl+=`, `Ctrl+-` | Zoom in, out |
| | `Ctrl+0`, `Ctrl+1` | Actual size, fit the diagram |
| | `Ctrl+P`, `Ctrl+Alt+P` | Toggle, reset the properties panel |
| | `Ctrl+B` | Toggle the bottom panel |
| | `Ctrl+Shift+O` | Move the diagram to the origin |

The tool keys apply only while the canvas has the focus; while a label or a code editor is being edited the keys belong to that editor (`Ctrl+S` still saves from a code editor).

## Limits

- Search (`Ctrl+F`) finds BPMN elements on a process and elements on a DRD; it does not search inside decision tables.
- The server workspace needs the admin login of the modeler server: **Open server workspace** uses the credentials of the connection dialog (**Run > Connect to server...**) and says so when the server answers 401 or 403.
