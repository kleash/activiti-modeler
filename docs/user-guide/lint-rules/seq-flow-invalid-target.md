# seq-flow-invalid-target

**A sequence flow has no valid target**

| | |
|---|---|
| Rule | `activiti/seq-flow-invalid-target` |
| Severity | error |
| Engine problem key | `SEQ_FLOW_INVALID_TARGET` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Delete the element |

## Why it matters

Activiti rejects a sequence flow whose `targetRef` is empty or names an element that does not exist.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Reconnect the flow, or delete it.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><sequenceFlow id="f" sourceRef="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"/>
```

[All lint rules](index.md)
