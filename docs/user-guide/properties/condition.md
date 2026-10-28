# Condition

The condition of a sequence flow, and the default flow.

**Shown for:** sequence flows that leave an exclusive or inclusive gateway or an activity; the default flow of those sources.

| Field | Entry id | Written to the model |
|---|---|---|
| Condition | `flow.condition` | `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">` |
| Default flow | `flow.default` | `default` attribute of the source element |

## Engine notes

- The condition is a JUEL expression (`${amount > 100}`) edited with highlighting, bracket matching and completion of the process variables; syntax errors are marked while you type.
- A gateway without a default flow and no matching condition fails the call and rolls it back ([finding 23](../../engine-findings.md)).
- The expression language has no string `+` ([finding 36](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
