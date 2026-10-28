# decision-input-unmapped

**A decision input is not mapped**

| | |
|---|---|
| Rule | `activiti/decision-input-unmapped` |
| Severity | warning |
| Kind | Extra rule L37 (FEATURE_MATRIX §D) |
| Reads | the extensions JSON of the process, the other files of the project |

## Why it matters

A decision input that the task does not provide is `null` in FEEL, and a comparison with `null` never matches: the mistake shows up as "no rule matched", not as an error.

Evidence: [ADR 0004](../../adr/), [docs/user-guide/dmn-conventions.md (Inputs and null)](../dmn-conventions.md), [FEATURE_MATRIX §D L37](../../FEATURE_MATRIX.md).

## How to fix

Map every input name the decision reads (the Decision group offers them), or use `MAP_ALL_INPUTS`.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="dt" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "dt": {
      "inputs": {
        "age": {
          "type": "VARIABLE",
          "value": "age"
        }
      }
    }
  },
  "constants": {
    "dt": {
      "_activiti_dmn_table_": {
        "value": "grade"
      }
    }
  }
}
```

Accepted:

```xml
<!-- process -->
<serviceTask id="dt" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "dt": {
      "inputs": {
        "age": {
          "type": "VARIABLE",
          "value": "age"
        },
        "region": {
          "type": "VARIABLE",
          "value": "region"
        }
      }
    }
  },
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
