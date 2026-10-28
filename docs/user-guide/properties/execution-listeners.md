# Execution listeners

`<activiti:executionListener>` on the process, an activity, a gateway, an event or a sequence flow.

**Shown for:** the process, every flow node and every sequence flow.

| Field | Entry id | Written to the model |
|---|---|---|
| Event type | `listeners.execution[i].event` | `event`: `start`, `end` (flow nodes and the process) or `take` (sequence flows) |
| Listener type | `listeners.execution[i].type` | `class`, `expression` or `delegateExpression` |
| Java class / Expression / Delegate expression | `listeners.execution[i].class` / `.expression` / `.delegateExpression` | the attribute of the same name |
| Run in the transaction | `listeners.execution[i].onTransaction` | `onTransaction`: `before-commit`, `committed` or `rolled-back` |
| Custom properties resolver | `listeners.execution[i].resolverType` and `.customPropertiesResolver*` | `customPropertiesResolverClass` / `Expression` / `DelegateExpression` |
| Fields | `listeners.execution[i].fields` | `<activiti:field>` children, see [field injection](field-injection.md) |

## Engine notes

- Listeners run in the order listed. A listener that was just added may be incomplete; it stays in the panel until its implementation is filled in.
- A process-level `end` listener runs after the process instance execution was deleted: setting a variable there fails the completion ([C13.1](../../engine-findings.md)). The panel warns about `setVariable` in an end listener.
- An exclusive gateway never calls its `end` listeners ([C13.2](../../engine-findings.md)); use the `take` listener of the outgoing flow. The panel shows this note.
- An expression cannot call a method named `notify` ([C13.3](../../engine-findings.md)).
- `onTransaction` works only with a delegate expression whose bean implements `TransactionDependentExecutionListener`; a class must implement that interface, and an expression is refused ([C13.4](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
