# Form

The form key of a user task or start event, and the legacy form properties.

**Shown for:** user tasks and start events.

| Field | Entry id | Written to the model |
|---|---|---|
| Form key | `form.key` | `activiti:formKey` |
| Form properties | `form.properties` | `<activiti:formProperty id name type required readable writable variable expression datePattern default>` with `<activiti:value>` children for enum types |

## Engine notes

- The legacy `formProperty` entries are kept so that older models round-trip. The panel marks them **not executed by Activiti 9**: the engine parses them and the form key into the model but never acts on them; a start without a "required" form property succeeds ([C15.7](../../engine-findings.md)).
- The application decides what a form key means.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
