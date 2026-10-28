# property-type-invalid

**A process variable has a type the runtime does not know**

| | |
|---|---|
| Rule | `activiti/property-type-invalid` |
| Severity | error |
| Kind | Extra rule L11 (FEATURE_MATRIX §D) |
| Reads | the extensions JSON of the process |

## Why it matters

The runtime knows boolean, string, integer, bigdecimal, json, file, folder, content, date, datetime and array. A property of another type with a default value throws a NullPointerException when the process starts; without a default its validation falls back to json.

Evidence: [R1 §6.2.3](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L11](../../research/activiti-9-bpmn-support.md), [engine run t17v](../../engine-findings.md).

## How to fix

Pick one of the listed types in **Process variables**.

## Example

Reported:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {
    "a": {
      "id": "a",
      "name": "amount",
      "type": "number",
      "value": 1
    }
  },
  "mappings": {},
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {
    "a": {
      "id": "a",
      "name": "amount",
      "type": "integer",
      "value": 1
    }
  },
  "mappings": {},
  "constants": {}
}
```

[All lint rules](index.md)
