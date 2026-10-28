# connector-required-input-unmapped

**A required input of a connector action is not mapped**

| | |
|---|---|
| Rule | `activiti/connector-required-input-unmapped` |
| Severity | error |
| Kind | Extra rule L24 (FEATURE_MATRIX §D) |
| Reads | the other files of the project, the extensions JSON of the process |

## Why it matters

The connector gets only the inputs the mapping provides (and the constants). A required input that is missing makes the connector fail or return nothing.

Evidence: [R1 §6.2.4](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §D L24](../../FEATURE_MATRIX.md).

## How to fix

Map the input in **Input / output mapping**, or add `MAP_ALL`.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "s": {
      "inputs": {}
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "s": {
      "inputs": {
        "customerId": {
          "type": "VARIABLE",
          "value": "customerId"
        }
      }
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
