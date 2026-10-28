# seq-flow-invalid-src

**A sequence flow has no valid source**

| | |
|---|---|
| Rule | `activiti/seq-flow-invalid-src` |
| Severity | error |
| Engine problem key | `SEQ_FLOW_INVALID_SRC` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Delete the element |

## Why it matters

Activiti rejects a sequence flow whose `sourceRef` is empty or names an element that does not exist.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Reconnect the flow, or delete it.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><sequenceFlow id="f" targetRef="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"/>
```

[All lint rules](index.md)
