# Data object

Typed process variables created when the process or sub process starts.

**Shown for:** processes and sub processes (list of data objects), and drawn data object references.

| Field | Entry id | Written to the model |
|---|---|---|
| Name | `data.objects[i].name`, `data.name` | `<bpmn:dataObject name>`: the variable name |
| ID | `data.objects[i].id`, `data.id` | `<bpmn:dataObject id>` |
| Type | `data.objects[i].type`, `data.type` | `itemSubjectRef`: `xsd:string`, `xsd:int`, `xsd:long`, `xsd:double`, `xsd:boolean`, `xsd:datetime` |
| Default value | `data.objects[i].value`, `data.value` | `<activiti:value>` in the extension elements |

## Engine notes

- Data objects are created before the start variables and are typed; one without a value is a variable holding null; a data object of a sub process is local to it ([C15.6](../../engine-findings.md)).
- A data object has no diagram shape in the modeler: the shape of a data object reference draws a `DI_INVALID_REFERENCE` warning in the engine's validator ([C18.2](../../engine-findings.md)). Edit data objects in the list on the process; a reference that was drawn in an imported file is edited through the same fields.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
