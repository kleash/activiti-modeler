# Documentation

Free text stored with the element as `<bpmn:documentation>`.

**Shown for:** every element and the process.

| Field | Entry id | Written to the model |
|---|---|---|
| Documentation | `documentation.text` | One `<bpmn:documentation>` child. Clearing the text removes the element. |

## Engine notes

- The documentation of a process becomes the description of its process definition; Activiti stores at most 2000 characters of it.
- Task documentation is read as the description of the task.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
