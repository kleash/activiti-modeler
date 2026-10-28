# extensions-unknown-process

**The extensions file configures a process that is not in this file**

| | |
|---|---|
| Rule | `activiti/extensions-unknown-process` |
| Severity | error |
| Kind | Extra rule L10 (FEATURE_MATRIX §D) |
| Quick fix | Remove the entry of the unknown process |
| Reads | the extensions JSON of the process |

## Why it matters

Activiti looks the extension up by the process key (`extensions.<processId>`). An entry for a key that is not a process of the file is never read: its mappings and properties are silently inert.

Evidence: [R1 §6.2.1](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L10](../../research/activiti-9-bpmn-support.md).

## How to fix

Rename the key to the process id, or delete the entry (the quick fix does). The modeler renames it together with the process.

## Example

Reported:

```xml
<!-- process -->


<!-- extensions -->
{
  "extensions": {
    "ghost": {
      "properties": {},
      "mappings": {},
      "constants": {}
    }
  },
  "id": "x"
}
```

Accepted:

```xml
<!-- process -->


<!-- extensions -->
{
  "properties": {},
  "mappings": {},
  "constants": {}
}
```

[All lint rules](index.md)
