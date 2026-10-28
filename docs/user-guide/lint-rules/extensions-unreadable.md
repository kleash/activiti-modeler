# extensions-unreadable

**An extensions JSON file cannot be read**

| | |
|---|---|
| Rule | `activiti/extensions-unreadable` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The runtime reads `<name>-extensions.json` with Jackson; a file it cannot read fails every process start with `Unable to read process extension` (R1 §6.2.4). The deployment does not notice.

Evidence: [R1 §6.2.4](../../research/activiti-9-bpmn-support.md).

## How to fix

Fix the JSON in the extensions view of the process.

## Example

Reported:

```xml
<!-- processes/a.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>

<!-- processes/a-extensions.json -->
{ "extensions": 
```

Accepted:

```xml
<!-- processes/a.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>

<!-- processes/a-extensions.json -->
{ "id": "a", "extensions": { "p": { "properties": {}, "mappings": {}, "constants": {} } } }
```

[All lint rules](index.md)
