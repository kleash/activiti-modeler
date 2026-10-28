# extensions-unknown-element

**A mapping or constant belongs to an element that does not exist**

| | |
|---|---|
| Rule | `activiti/extensions-unknown-element` |
| Severity | error |
| Kind | Extra rule L22 (FEATURE_MATRIX §D) |
| Quick fix | Remove the entry |
| Reads | the extensions JSON of the process |

## Why it matters

Mappings, constants, templates and assignments are keyed by BPMN element id. An entry whose key is not an element of the process is never applied (the element was deleted or renamed outside the modeler).

Evidence: [R1 §6.2.4](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L10](../../research/activiti-9-bpmn-support.md), [ADR 0006](../../adr/).

## How to fix

Remove the entry, or rename the key to the id of the element it was meant for.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "gone": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<task id="t"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "t": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
