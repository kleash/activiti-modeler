# json-property-without-default

**A json (or unknown type) property without a default value**

| | |
|---|---|
| Rule | `activiti/json-property-without-default` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |
| Reads | the extensions JSON of the process |

## Why it matters

Such a property creates a process variable holding JSON null when the process starts; it then travels with `MAP_ALL` and shows up in every connector call (engine finding 4).

Evidence: [engine-findings 4](../../engine-findings.md).

## How to fix

Give the property an explicit default, for example `{}`.

## Example

Reported:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {
    "a": {
      "id": "a",
      "name": "profile",
      "type": "json"
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
      "name": "profile",
      "type": "json",
      "value": {}
    }
  },
  "mappings": {},
  "constants": {}
}
```

[All lint rules](index.md)
