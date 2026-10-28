# extensions-invalid-structure

**The extensions file has a mapping the runtime cannot read**

| | |
|---|---|
| Rule | `activiti/extensions-invalid-structure` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |
| Reads | the extensions JSON of the process |

## Why it matters

The runtime reads the extensions with Jackson and fails the first process start with `Unable to read process extension` when a mapping type is not MAP_ALL / MAP_ALL_INPUTS / MAP_ALL_OUTPUTS, an input or output type is not VARIABLE / VALUE / JSONPATCH, or a constant is a bare value instead of `{ "value": ... }`. Deployment does not notice.

Evidence: [R1 §6.2.4](../../research/activiti-9-bpmn-support.md), [engine run (constants given as a bare string)](../../engine-findings.md).

## How to fix

Fix the entry in the extensions JSON view, or re-enter it in the **Input / output mapping** group.

## Example

Reported:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "t": {
      "mappingType": "ALL"
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "t": {
      "mappingType": "MAP_ALL",
      "inputs": {
        "a": {
          "type": "variable",
          "value": "a"
        }
      }
    }
  },
  "constants": {
    "t": {
      "greeting": {
        "value": "hello"
      }
    }
  }
}
```

[All lint rules](index.md)
