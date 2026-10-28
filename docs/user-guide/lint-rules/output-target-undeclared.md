# output-target-undeclared

**An output mapping writes a variable that is not declared in the process properties**

| | |
|---|---|
| Rule | `activiti/output-target-undeclared` |
| Severity | warning |
| Kind | Extra rule L21 (FEATURE_MATRIX §D) |
| Quick fix | Declare the variable in the process properties |
| Reads | the extensions JSON of the process |

## Why it matters

The runtime applies an output mapping only when its target is a declared property or an already existing variable; otherwise the output is dropped silently. The modeler declares the targets it creates.

Evidence: [R1 §6.2.4](../../research/activiti-9-bpmn-support.md), [engine-findings 16](../../engine-findings.md), [ADR 0003](../../adr/).

## How to fix

Declare the variable in **Process variables** (the quick fix does), or make sure an earlier step creates it.

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
      "outputs": {
        "tier": {
          "type": "VARIABLE",
          "value": "tier"
        }
      }
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
  "properties": {
    "t": {
      "id": "t",
      "name": "tier",
      "type": "string"
    }
  },
  "mappings": {
    "s": {
      "outputs": {
        "tier": {
          "type": "VARIABLE",
          "value": "tier"
        }
      }
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
