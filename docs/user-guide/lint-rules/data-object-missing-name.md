# data-object-missing-name

**A data object has no name**

| | |
|---|---|
| Rule | `activiti/data-object-missing-name` |
| Severity | error |
| Engine problem key | `DATA_OBJECT_MISSING_NAME` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A data object becomes a process variable named after it.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Name the data object.

## Example

Reported:

```xml
<!-- process -->
<dataObject id="d1"/>
```

Accepted:

```xml
<!-- process -->
<dataObject id="d1" name="amount"/>
```

[All lint rules](index.md)
