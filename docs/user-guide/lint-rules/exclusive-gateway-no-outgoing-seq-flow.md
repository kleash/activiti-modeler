# exclusive-gateway-no-outgoing-seq-flow

**An exclusive gateway has no outgoing sequence flow**

| | |
|---|---|
| Rule | `activiti/exclusive-gateway-no-outgoing-seq-flow` |
| Severity | error |
| Engine problem key | `EXCLUSIVE_GATEWAY_NO_OUTGOING_SEQ_FLOW` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A token that reaches the gateway could not leave.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Connect the gateway to the next step.

## Example

Reported:

```xml
<!-- process -->
<exclusiveGateway id="g"/>
```

Accepted:

```xml
<!-- process -->
<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"/>
```

[All lint rules](index.md)
