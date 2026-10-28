# General

Name and identity of the selected element. The group is open by default.

**Shown for:** every element, and the process.

| Field | Entry id | Written to the model |
|---|---|---|
| ID | `general.id` | `id` attribute. Letters, digits, `_`, `-`, `.`; not starting with a digit (NCName). The process id is the process definition key. Renaming an id renames the entries of the extensions file as well, as one undo step. |
| Name | `general.name` | `name` attribute; also the label on the canvas. |
| Executable | `general.executable` | `isExecutable` of the process. |
| Target namespace | `general.targetNamespace` | `targetNamespace` of the definitions. |

## Engine notes

- Activiti runs only processes with `isExecutable="true"`; a file whose processes are all non-executable deploys nothing (lint rule `all-process-definitions-not-executable`).
- The target namespace becomes the category of the process definition. Activiti rejects a namespace longer than 255 characters.
- Invalid ids are refused with a message under the field; the model keeps the old id.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
