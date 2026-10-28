# Start initiator and start form

The start event can name a process variable that receives the user who started the instance, and a form key.

**Shown for:** none-typed start events (and, for the form key, every start event).

| Field | Entry id | Written to the model |
|---|---|---|
| Initiator | `start.initiator` | `activiti:initiator`: the variable name |
| Form key | `form.key` | `activiti:formKey` |
| Form properties | `form.properties` | `<activiti:formProperty>` children, see [form](form.md) |

## Engine notes

- The variable is set only when the host application calls `Authentication.setAuthenticatedUserId` before starting. `ProcessRuntime` does not copy the Spring Security user by itself, so without that call the variable stays empty ([C15.7](../../engine-findings.md)). The modeler server does it for you.
- Use the variable in assignment: `${initiator}` as an assignee.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
