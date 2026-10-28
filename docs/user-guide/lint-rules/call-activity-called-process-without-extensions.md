# call-activity-called-process-without-extensions

**Inputs are mapped into a called process that has no extensions entry**

| | |
|---|---|
| Rule | `activiti/call-activity-called-process-without-extensions` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |
| Reads | the other files of the project, the extensions JSON of the process |

## Why it matters

The mapped inputs of a call activity reach the child only when the child has an entry in an extensions file (possibly empty); otherwise the child starts without them, silently. `activiti:in` is not affected.

Evidence: [engine-findings C11.2](../../engine-findings.md).

## How to fix

Give the called process an extensions file (the modeler writes one for every process).

## Example

Reported:

```xml
<!-- process -->
<callActivity id="c" calledElement="other"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "c": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<callActivity id="c" calledElement="other"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "c": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
