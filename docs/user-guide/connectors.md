# Connectors and element templates

A **connector** is a Spring bean that a service task calls by name: `implementation="<connector>.<ACTION>"`, for example `crm.LOOKUP` calls the bean `crm.LOOKUP`. A **connector definition** (`connectors/<name>.json`) describes the actions of such a connector and their typed inputs and outputs. The modeler uses the definitions for the connector picker, the autocomplete of mapping rows, the lint rules L24 and L36, and to **generate element templates**.

Activiti does not need the definition to run a task, but it **reads the file when the application starts**: every `.json` file in `activiti.connectors.dir` becomes a `ConnectorDefinition` (`id`, `name`, `description`, `actions`; an action has `id`, `name`, `description`, `inputs`, `outputs`; an input or output has `id`, `name`, `description`, `type`, `required`, `display`, `displayName`, `analytics`, `ephemeral`), using the application's `ObjectMapper`. An application without Spring Boot's lenient mapper fails on any other field. So **the file holds those fields and nothing else**. What only the modeler needs (the template version, the configuration) is kept in `project.json`, which is never deployed (see below).

## The catalog editor

Open any `connectors/*.json` file (or create one with **File > New file > Connector definition**) and it opens in the catalog editor. **Edit as JSON** switches to the text editor; the text editor offers the way back.

| Part | What it edits |
|---|---|
| Name | the connector name: `^[a-z]([-a-z0-9]{0,24}[a-z0-9])?$` (lower case letters, digits and hyphens, at most 26 characters) and **no dot**, because the dot separates the action. Unique in the project |
| Description | free text |
| Version | the version of the connector's element templates (see below); **Bump** adds one. Saved in `project.json`, not in the connector file |
| Actions | each has an **id** (the part after the dot: letters, digits, `_`, `-`, no dot; unique), a **name** and a description, and its typed **inputs** (name, type, *required*, description) and **outputs** (name, type, description) |
| Configuration | `config` entries: name, value, required, description. Saved in `project.json`, not in the connector file |

Parameter types are those of the connector schema: `string`, `integer`, `boolean`, `date`, `json`, `file`, `datetime`, `array`. Problems are listed at the top and marked on the field (name pattern, duplicate connector or action names, a dot in an action id, duplicate parameters, an unknown type). The file is saved with **Save** like any other; an edit that is not saved yet is already seen by the open diagrams (the working copy is the catalog), so a template list or an outdated-version note updates as you type.

### What goes where

| Where | What |
|---|---|
| `connectors/<name>.json` | `id`, `name`, `description`, `actions` (with `inputs` and `outputs`): exactly what the runtime's `ConnectorDefinition`, `ActionDefinition` and `VariableDefinition` classes have, and `display`, `displayName`, `analytics`, `ephemeral` of a parameter when you set them |
| `project.json`, `connectors.<name>` | the modeler's data about the connector: `version` (of the templates), `config`, and, when a descriptor from another tool had them, `template`, `events` and any other top-level field |

`<name>` is the file name without `.json`. The editor saves both together: **Save** writes the connector file and, when the version or the configuration changed, `project.json`. Renaming the file in the explorer moves its entry; deleting the file removes it; discarding the changes of a connector tab takes the entry back to what is saved. A project without `project.json` gets one when there is something to keep.

**Importing a connector file** (drop, zip, or **Import**) that carries more than the runtime reads is cleaned: the file is written with the runtime's fields, the other top-level fields move to `project.json` under `connectors.<name>` (an entry that is already there wins), and a notice lists what moved. A field *inside* an action or a parameter that the runtime does not know cannot be kept anywhere: it is dropped and reported. The same cleaning happens on **Export project** (the zip), and a file you open from a folder or the server that still carries such fields shows a note in the editor and is rewritten when you save it. The catalog and lint rule L36 read the version from `project.json` first, and from the file as before when only the file has it.

```json
// connectors/crm.json
{
  "id": "crm",
  "name": "crm",
  "description": "Customer lookups",
  "actions": {
    "LOOKUP": {
      "id": "LOOKUP",
      "name": "Look up a customer",
      "inputs": [ { "id": "customerId", "name": "customerId", "type": "string", "required": true } ],
      "outputs": [ { "id": "tier", "name": "tier", "type": "string" }, { "id": "found", "name": "found", "type": "boolean" } ]
    }
  }
}
```

```json
// project.json (excerpt)
{
  "name": "shop",
  "connectors": { "crm": { "version": "2" } }
}
```

## Element templates

Element templates are generated, never written by hand: **one per action of every connector**, plus the built-in kinds **Mail**, **Shell**, **Decision task**, **Java class**, **Expression** and **Delegate expression**. A template has a name (`crm: Look up a customer`), a description, keywords for the search, a category (Connectors, Service tasks) and an icon.

### Choosing a template

- **Panel:** the **Template** group of a task has **Apply template...**; the Implementation group has a **connector action** picker that applies the template of the action you choose.
- **Replace menu:** the wrench of a task has **Apply template...** (an abstract task becomes a service task with the same id).
- **Create / append:** the context pad of any flow node has **Append task from template**, which adds a service task after it and applies the template.
- All three open the same chooser (`@bpmn-io/element-template-chooser`): a searchable list with icons.

### What applying a connector template does

In one undo step:

1. sets `implementation="<connector>.<ACTION>"` (the other implementation attributes and fields go) and names an unnamed task after the action;
2. maps **every input** of the action (a `VARIABLE` input of the same name) and **every output** (a `VARIABLE` output into a process variable of the same name); rows the task already has are kept;
3. **declares the output targets** in the process variables, typed from the action's output types (so the engine does not drop them);
4. records the link: `activiti:templateId="<connector>.<ACTION>"` and `activiti:templateVersion="<version>"` (`1` when the connector has no version in `project.json`).

The built-ins set their implementation type (and, for the decision task, the constant `_activiti_dmn_table_`) and record the link with the id `builtin/<kind>` and version `1`. The task shows the template's icon on the canvas: a plug, an envelope, a terminal, a decision table, braces, f(x) or a hash.

### Versions: update and unlink

The template version is the connector's `version` in `project.json`. When you change the actions of a connector, **bump the version** (the editor offers it when the actions changed and the version did not). Then:

- the properties panel of a task made from the old version says so, with **Update to version N**: it records the new version and adds the inputs and outputs the new version has, keeping your mapping rows (rows of removed parameters stay; delete them by hand);
- lint rule L36 (`connector-template-outdated`) warns about every such task in the Problems panel;
- a task whose connector or action was removed shows a warning; **Unlink** forgets the template.

**Unlink** removes the two attributes and nothing else. Changing the implementation of a task by hand to something other than its template makes it forget the template too.

## Where things are written

| What | Where |
|---|---|
| Connector definitions | `connectors/<name>.json` (the runtime's fields only) |
| Template version and configuration of a connector | `project.json`, `connectors.<name>` |
| The template link of a task | `activiti:templateId`, `activiti:templateVersion` on the service task |
| Mappings, constants, declared variables | the `-extensions.json` file ([Input / output mapping](properties/input-output-mapping.md), [Process variables](properties/process-variables.md)) |

The attributes are extension attributes the engine keeps and ignores. Back to the [modeler basics](modeler-basics.md).
