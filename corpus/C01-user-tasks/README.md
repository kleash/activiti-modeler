# C01 user-tasks

Hand-written seed for the user task (T1), the start event attributes (E1) and the user-task side of multi-instance (T16): every
assignment form, task attributes under a fixed clock, task listeners, `skipExpression`, candidate starters, multi-instance user
tasks and mappings to and from task-local variables.

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `assignmentForms` | `assignee` + `owner`, an assignee expression, `candidateUsers` / `candidateGroups`, candidates from expressions (a collection and a comma separated string), the standard `humanPerformer` and `potentialOwner`, `activiti:customResource`; visibility through `TaskRuntime`, identity links | `assignment-forms` |
| `taskAttributes` | `priority`, `category`, `formKey`, `dueDate` as literal, expression, duration and date, the `duration` and `dueDate` business calendars; the engine clock fixed and advanced | `task-attributes` |
| `taskListeners` | class, delegate expression and expression listeners, the events create, assignment, complete, delete and all, fields; the order of the calls | `task-listeners` |
| `skipEnabled`, `skipDisabled` | `skipExpression` with and without `_ACTIVITI_SKIP_EXPRESSION_ENABLED` (a property default in `skip-enabled-extensions.json`) | `skip-expression` |
| `candidateStarters` | `candidateStarterUsers` / `candidateStarterGroups`, `activiti:initiator`, a start `formKey`; who may start | `candidate-starters` |
| `reviewParallel` | Parallel multi-instance user task: collection, element variable, completion condition, `outputDataItem` / `loopDataOutputRef`, input mapping to task-local variables | `multi-instance-parallel` |
| `reviewSequential` | Sequential multi-instance: collection expression, `elementIndexVariable`, completion condition, and a loop cardinality with the default `loopCounter` | `multi-instance-sequential` |
| `taskMappings` | Input mappings (variable, value, expression, constant) to task-local variables, output mappings from completion variables, a task with no mapping, `MAP_ALL`, and the engine-provided `sys_task_assignee` | `task-mappings` |

`model-expect.json` asserts what a run cannot show: the parsed assignment attributes, the custom identity links, the literal
priority / category / form key / due date / business calendar, the task listener definitions, `skipExpression`, the candidate
starters (also through the process definition's identity links), the start event's initiator and form key and the loop
characteristics. Every flow node and sequence flow is visited (no exemptions).

Engine notes: [engine findings](../../docs/engine-findings.md) 1-3, 6, 8-15, 19.

Run: `scripts/verify-models.sh corpus --project C01`
