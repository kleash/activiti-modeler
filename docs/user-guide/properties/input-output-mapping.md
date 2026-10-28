# Input / output mapping

Which variables a task receives and which of its results reach the process. Written to `mappings.<elementId>` in the `-extensions.json` file, so the entries follow the element when its id changes or it is copied.

**Shown for:**

| Element | Inputs | Outputs | Constants |
|---|---|---|---|
| Service task with a connector action or a decision | yes | yes | yes |
| User task | task-local variables | completion variables | yes |
| Call activity | variables of the called process | variables on return | yes |
| Start event (none, message) | no | yes: an output mapping on the start payload | no |
| Message catch event (intermediate, boundary, event sub process start) | no | yes: the payload | no |
| Message throw event (intermediate, end) | yes: the payload | no | yes |
| Signal events | no mapping: the group only says so | | |

A service task that calls a Java class, an expression or a delegate expression, a timer event and the other elements have no mapping group: the engine reads none there.

| Field | Entry id | Written to the model |
|---|---|---|
| Mapping type | `mapping.type` | `mappingType`: `MAP_ALL`, `MAP_ALL_INPUTS`, `MAP_ALL_OUTPUTS` (or none) |
| Inputs | `mapping.inputs[i].target`, `.type`, `.value` | `inputs.<name>` = `{ type: VARIABLE or VALUE, value }` |
| Outputs | `mapping.outputs[i].target`, `.type`, `.value` | `outputs.<process variable>` = `{ type: VARIABLE, VALUE or JSONPATCH, value }` |
| Ephemeral | `mapping.ephemeral` | `ephemeral` (connector and decision tasks) |

## Inputs

An input has a name (the connector input, the decision input, the task variable) and where its value comes from:

- **A process variable** (`VARIABLE`): the value of the variable whose name you give. The engine applies it only when the variable is declared or exists ([finding 15](../../engine-findings.md)).
- **A value** (`VALUE`): text, a number, `true`, `false`, `null`, a list or an object. Text is stored as it is; anything that reads as JSON is stored as JSON, so write `"42"` in quotes for the text 42. `${...}` is resolved against the process variables when the task runs: a value that is exactly `${...}` keeps the type of the expression, embedded in text it becomes text, and an expression that cannot be resolved gives null or an empty text with a warning in the log.

## Outputs

An output sets one process variable:

- **A variable of the result** (`VARIABLE`): copies the named result variable (a connector output, a decision output, a task-completion variable). A result that is null is **skipped**: the process variable keeps its previous value.
- **A value** (`VALUE`): a fixed value, always applied. An expression is not allowed here.
- **A JSON patch** (`JSONPATCH`): an RFC 6902 array applied to the **current value of the process variable**; the task's result is ignored. Missing intermediate objects are created and a path may contain `${name}` (a text or integer variable). The target is declared as `json`.

The target must be a **declared** variable, or the engine silently drops the output ([finding 16](../../engine-findings.md)). Adding an output declares its target in the [process variables](process-variables.md), typed from the connector action's output type, the decision's FEEL type, or the literal for a value output; the panel flags targets that are not declared. A name can have one row; a row that is incomplete (or invalid) stays in the panel as a draft and keeps its last complete version in the file.

## Autocomplete

The name and value fields offer: the **inputs of the connector action** (or the **decision's inputs**) as input names, the declared **process variables** (and what the diagram writes) as variable names, the **outputs of the connector action** (the decision's output columns, `_activiti_dmn_matched_`, `_activiti_dmn_matched_rules_`; `sys_task_assignee` and the input-mapped variables on a user task) as result variables.

## Engine notes (shown under the fields)

- **User task:** without a mapping the task has no task-local variables and its completion variables never reach the process. The output mapping runs on **every** completion, also without variables, and can read the input-mapped variables and `sys_task_assignee` (the assignee). `MAP_ALL` and `MAP_ALL_OUTPUTS` also copy `sys_task_assignee` and every input-mapped variable into the process ([finding 1](../../engine-findings.md)).
- **Connector:** the connector gets only the mapped inputs and the constants (`MAP_ALL` / `MAP_ALL_INPUTS` pass every process variable plus the constants); its outputs reach the process only through the output mapping ([finding 15, 16](../../engine-findings.md)). `ephemeral` is only a flag the connector can read ([finding 17](../../engine-findings.md)).
- **Decision:** see [Decision](decision.md).
- **Call activity:** mapped inputs reach the called process only when it has an entry in its own `-extensions.json` (its `properties` may be empty); a child without an entry drops them silently while the outputs still come back. The child's property defaults fill missing inputs and a missing required property fails the call ([finding C11.2, C11.3](../../engine-findings.md)). A **multi-instance** call activity gets nothing back from its children ([finding C11.1](../../engine-findings.md)).
- **Start event:** the mapping is an output mapping on the start payload; once it yields a variable, only the mapped variables reach the process, a `VALUE` output is always added, and a start event without a mapping passes the payload on ([finding 30, C15.5](../../engine-findings.md)).
- **Catch event:** the mapping is an output mapping of the payload; without it the payload is dropped.
- **Throw event:** the inputs and constants become the payload of the message (`ThrowMessage.payload`) that a throw delegate of the application receives.
- **Signal events:** signal payloads are not mapped; the signal hands every variable of the throwing execution to the catching one ([finding 37](../../engine-findings.md)).
- New user tasks, call activities and message catch events get `MAP_ALL` by default ([ADR 0006](../../adr/0006-extensions-store.md)); the project setting can switch that off. A **multi-instance** user task gets `MAP_ALL_OUTPUTS` instead (`MAP_ALL` makes a parallel multi-instance user task hang, see [the lint rule](../lint-rules/parallel-multi-instance-user-task-map-all.md)), and the mapping follows when you switch multi-instance on or off. A **signal** catch event gets no mapping: the payload of a signal reaches the process without one.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
