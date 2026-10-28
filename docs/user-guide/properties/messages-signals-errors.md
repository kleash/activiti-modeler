# Messages, signals and errors

Messages, signals and errors are declared once, as children of `<bpmn:definitions>`, and events refer to them. The three list groups sit on the process (select the empty canvas); each item has a name, an id and the number of elements that use it.

**Shown for:** the process (root element).

| Field | Entry id | Written to the model |
|---|---|---|
| Message name | `definitions.messages[i].name` | `<bpmn:message name>` |
| Message ID | `definitions.messages[i].id` | `<bpmn:message id>`. Changing it keeps every reference to the message. |
| Signal name | `definitions.signals[i].name` | `<bpmn:signal name>` |
| Signal scope | `definitions.signals[i].scope` | `activiti:scope`: `global` (default) or `processInstance` |
| Error code | `definitions.errors[i].errorCode` | `<bpmn:error errorCode>`; the error is identified by its code |
| Error name | `definitions.errors[i].name` | `<bpmn:error name>` |
| IDs of signals and errors | `definitions.signals[i].id`, `definitions.errors[i].id` | the `id` attributes |

## Engine notes

- **Create** from the group (Add) or from the event picker ("Create a new message..."). **Rename** here or in the event: it renames the declaration for every event that uses it. **Delete** clears the references to the declaration in the same undo step; the count "Used by n elements" tells you what will be cleared.
- A signal with `activiti:scope="processInstance"` reaches only the instance that throws it ([finding 28](../../engine-findings.md): a file that declares any signal cannot also use `signalExpression`).
- Two messages with the same name and the same correlation key cannot be subscribed at once: the second subscription fails and rolls back the call ([finding 31](../../engine-findings.md), lint L30).
- An error boundary event without an error reference catches every error.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
