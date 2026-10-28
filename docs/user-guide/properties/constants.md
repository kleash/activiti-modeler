# Constants

Fixed values that arrive as inputs of the task next to the mapped inputs. Written to `constants.<elementId>.<name>.value` in the `-extensions.json` file.

**Shown for:** the elements that take inputs: connector and decision tasks, user tasks, call activities and message throw events.

| Field | Entry id | Written to the model |
|---|---|---|
| Name | `constants.values[i].name` | the key under the element |
| Value | `constants.values[i].value` | `value`: text, or JSON |

The value is read as JSON when it is JSON (`42`, `true`, `null`, a list, an object, `"quoted text"`) and as plain text otherwise (`EU`, `${tier}`). A text that would read as JSON is shown with quotes: `"42"` is the text 42. Names are unique; the order is kept.

## Engine notes

- Constants are added to the inputs after the mapped inputs, with or without `MAP_ALL_INPUTS`, and need no process variable ([finding 15](../../engine-findings.md)). For a call activity a constant is added after the mapped inputs and overrides a child default ([finding C11.3](../../engine-findings.md)).
- The constant `_activiti_dmn_table_` of a decision task is not listed here: it is the decision id, edited in the [Decision](decision.md) group, and is kept when you edit the other constants. `_activiti_*` constants are removed before the DMN evaluates ([ADR 0004](../../adr/0004-dmn-execution.md)).
- A constant given as a bare string instead of `{ "value": ... }` is not detected at deployment and fails the first start with `Unable to read process extension`; the modeler always writes the `{ "value": ... }` form.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
