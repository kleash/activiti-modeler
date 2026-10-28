# missing-mapping

**A user task, call activity, message catch event or connector task without an input / output mapping**

| | |
|---|---|
| Rule | `activiti/missing-mapping` |
| Severity | warning |
| Kind | Extra rule L9 (FEATURE_MATRIX §D) |
| Quick fix | Add a MAP_ALL mapping |
| Reads | the extensions JSON of the process |

## Why it matters

Variables flow in and out of these elements only through the extensions mapping: a connector gets no inputs and its outputs are dropped, a user task has no task-local variables and the variables it is completed with never reach the process, a call activity gets nothing back from its child, a message payload is dropped. A task works without one only when it needs no variables.

Evidence: [R1 §0.3-17](../../research/activiti-9-bpmn-support.md), [R1 §6.2.4](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L8 L9](../../research/activiti-9-bpmn-support.md), [engine-findings 1](../../engine-findings.md).

## How to fix

Add a mapping in the **Input / output mapping** group; `MAP_ALL` passes everything (the quick fix adds it).

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"/>

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
<userTask id="u"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "u": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
