# signal-catch-has-mapping

**A signal catch event has a mapping**

| | |
|---|---|
| Rule | `activiti/signal-catch-has-mapping` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |
| Quick fix | Remove the entry |
| Reads | the extensions JSON of the process |

## Why it matters

A caught signal sets the throwing execution's variables on the catcher as process variables, with or without a mapping (the modeler does not give a signal catch event a default mapping for that reason). Unlike messages there is no mapping on a signal catch event, so an entry for it is never applied: a renaming output mapping, for example, renames nothing and the signal's own variable names arrive as they are.

Evidence: [engine-findings 37](../../engine-findings.md), [engine-findings C20.2](../../engine-findings.md).

## How to fix

Remove the mapping; read the signal variables directly.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>

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
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>

<!-- extensions -->
{
  "properties": {},
  "mappings": {},
  "constants": {}
}
```

[All lint rules](index.md)
