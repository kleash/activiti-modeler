# seq-flow-invalid-target-different-scope

**A sequence flow connects elements of different containers**

| | |
|---|---|
| Rule | `activiti/seq-flow-invalid-target-different-scope` |
| Severity | error |
| Engine problem key | `SEQ_FLOW_INVALID_TARGET_DIFFERENT_SCOPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A sequence flow cannot cross the border of a sub process; use the sub process's own start and end events.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Move one of the elements, or end the sub process and continue after it.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><subProcess id="sp"><task id="in"/></subProcess><sequenceFlow id="f" sourceRef="t" targetRef="in"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><subProcess id="sp"><task id="in"/></subProcess><sequenceFlow id="f" sourceRef="t" targetRef="sp"/>
```

[All lint rules](index.md)
