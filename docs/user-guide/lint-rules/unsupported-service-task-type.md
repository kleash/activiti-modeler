# unsupported-service-task-type

**A service or send task of type dmn, camel or mule**

| | |
|---|---|
| Rule | `activiti/unsupported-service-task-type` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

The validator knows these types, but `dmn` has no behaviour (the task is skipped silently at run time) and `camel` and `mule` fail at deployment because the modules are not shipped. Only `mail` and `shell` work. Other unknown types are reported by `service-task-invalid-type`.

Evidence: [R1 §0.1-3](../../research/activiti-9-bpmn-support.md), [R1 §0.1-9](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L3](../../research/activiti-9-bpmn-support.md), [engine runs t06 t31 t31b](../../engine-findings.md).

## How to fix

For a decision use a Decision task; for a mail use type mail; for anything else use a connector, a Java class or an expression.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="camel"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"/>
```

[All lint rules](index.md)
