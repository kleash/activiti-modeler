# Called element

The call activity: which process it starts and which variables travel.

**Shown for:** call activities.

| Field | Entry id | Written to the model |
|---|---|---|
| Called element | `call.calledElement` | `calledElement` (a process key or an expression) |
| Business key | `call.businessKey` | `activiti:businessKey` |
| Inherit business key | `call.inheritBusinessKey` | `activiti:inheritBusinessKey` |
| Inherit variables | `call.inheritVariables` | `activiti:inheritVariables` |
| In parameters | `call.in` | `<activiti:in source|sourceExpression target>` |
| Out parameters | `call.out` | `<activiti:out source|sourceExpression target>` |

## Engine notes

- `activiti:in` and `out` need no extensions file; `sourceExpression` of an `out` parameter is evaluated on the child instance ([C11.4](../../engine-findings.md)).
- A multi-instance call activity gets nothing back from its children: `out` parameters and output mappings are skipped ([C11.1](../../engine-findings.md)). The panel says so.
- Mapped inputs reach a child only when the called process has an entry in the extensions file ([C11.2](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
