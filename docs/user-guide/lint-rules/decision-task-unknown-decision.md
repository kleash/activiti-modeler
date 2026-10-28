# decision-task-unknown-decision

**A decision task has no decision, or one that is not in the project**

| | |
|---|---|
| Rule | `activiti/decision-task-unknown-decision` |
| Severity | error |
| Kind | Extra rule L23 (FEATURE_MATRIX §D) |
| Reads | the extensions JSON of the process, the other files of the project |

## Why it matters

A Decision task is a service task for `dmn-connector.EXECUTE_TABLE`; the constant `_activiti_dmn_table_` names the decision (a decision id, a DMN file name or a definitions name). Without it, or with a name no DMN file of the deployment resolves, the connector fails when the task runs.

Evidence: [ADR 0004](../../adr/), [FEATURE_MATRIX §D L23](../../FEATURE_MATRIX.md).

## How to fix

Choose the decision in the **Decision** group.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="dt" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {},
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<serviceTask id="dt" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {},
  "constants": {
    "dt": {
      "_activiti_dmn_table_": {
        "value": "grade"
      }
    }
  }
}
```

[All lint rules](index.md)
