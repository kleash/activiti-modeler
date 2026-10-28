# Field injection

`<activiti:field>` children that the engine injects into the fields of a Java class or delegate bean.

**Shown for:** service tasks (class or delegate expression), execution, task and event listeners, and throw message events with a delegate.

| Field | Entry id | Written to the model |
|---|---|---|
| Fields | `fields.list`, `listeners.*[i].fields` | `<activiti:field name><activiti:string>` or `<activiti:expression>` per row. Name, kind (text or expression) and value. |

## Engine notes

- A text value is injected as a literal, an expression is evaluated when the task runs. The target field of the Java class must be a `Expression` (or a `String` for plain text).
- `activiti:field` on a `messageEventDefinition` is parsed but **never injected**: the throw delegate is created with an empty field list ([finding 33](../../engine-findings.md)). The panel says so; pass data through the input mapping of the throw event instead.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
