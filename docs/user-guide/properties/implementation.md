# Implementation

What a service task (or send task) does. Changing the type removes the settings of the previous type.

**Shown for:** service tasks and send tasks (mail only).

| Field | Entry id | Written to the model |
|---|---|---|
| Type | `impl.type` | none, Java class, expression, delegate expression, connector, mail, shell, decision (DMN connector) |
| Java class | `impl.class` | `activiti:class` |
| Expression | `impl.expression` | `activiti:expression` |
| Delegate expression | `impl.delegateExpression` | `activiti:delegateExpression` |
| Result variable | `impl.resultVariable` | `activiti:resultVariable` (expressions only) |
| Connector action of the project | `impl.connector.pick` | applies the template of the chosen action: `implementation`, the mapping, the declared variables and the template link, see [Template](template.md) |
| Connector | `impl.connector` | `implementation="<connector>.<ACTION>"` (the connector name is the bean name, e.g. `mailer.SEND`); typing here changes only the attribute and drops a template link |
| Decision | [Decision group](decision.md) | constant `_activiti_dmn_table_` of the DMN connector, see [DMN conventions](../dmn-conventions.md) |
| Mail / shell | `impl.type` = mail / shell | `activiti:type="mail"` / `"shell"`; the fields are in [mail and shell fields](mail-shell-fields.md) |

## Engine notes

- A class or delegate expression with a result variable is a validation error: only expressions can store a result.
- Shell tasks are refused at deployment by the modeler server unless `modeler.server.allow-shell-tasks=true`.
- Inputs and outputs of connectors and decisions are mapped in the extensions file: see [Input / output mapping](input-output-mapping.md). The picker lists the actions of `connectors/` ([Connectors and element templates](../connectors.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
