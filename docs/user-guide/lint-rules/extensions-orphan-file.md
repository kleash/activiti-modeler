# extensions-orphan-file

**An extensions file has no process file next to it**

| | |
|---|---|
| Rule | `activiti/extensions-orphan-file` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

Activiti reads `<name>-extensions.json` only for the process deployed from `<name>.bpmn20.xml` in the same deployment; a sidecar on its own is never used.

Evidence: [R1 §6.2.1](../../research/activiti-9-bpmn-support.md).

## How to fix

Rename the file after its process, or delete it.

## Example

Reported:

```xml
<!-- processes/ghost-extensions.json -->
{ "id": "g", "extensions": {} }
```

Accepted:

```xml
<!-- processes/a.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>

<!-- processes/a-extensions.json -->
{ "id": "a", "extensions": {} }
```

[All lint rules](index.md)
