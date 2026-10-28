# Script

The script of a script task.

**Shown for:** script tasks.

| Field | Entry id | Written to the model |
|---|---|---|
| Script format | `script.format` | `scriptFormat` (juel, javascript, ...) |
| Script | `script.text` | `<bpmn:script>` |
| Result variable | `script.resultVariable` | `activiti:resultVariable` |
| Auto store variables | `script.autoStoreVariables` | `activiti:autoStoreVariables` |

## Engine notes

- `autoStoreVariables` has no effect with the bundled script engines (Nashorn does not call `put` for assignments, and JUEL scripts cannot assign). Write variables with `execution.setVariable(...)`; the panel warns when the flag is on ([finding 25](../../engine-findings.md), lint rule `auto-store-variables-no-effect`).
- The expression language has no string `+` and no assignment: `${'go-' + region}` fails; use `${'go-'.concat(region)}` ([finding 36](../../engine-findings.md)).
- Scripts see the Spring beans, `execution` and the process variables; a `BpmnError` thrown by a script reaches error boundary events ([finding 38](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
