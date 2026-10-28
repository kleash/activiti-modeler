# exclusive-gateway-condition-not-allowed-on-single-seq-flow

**The only outgoing flow of an exclusive gateway has a condition**

| | |
|---|---|
| Rule | `activiti/exclusive-gateway-condition-not-allowed-on-single-seq-flow` |
| Severity | error |
| Engine problem key | `EXCLUSIVE_GATEWAY_CONDITION_NOT_ALLOWED_ON_SINGLE_SEQ_FLOW` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

With a single way out the condition is meaningless and Activiti rejects it.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Remove the condition, or add the other branches.

## Example

Reported:

```xml
<!-- process -->
<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"><conditionExpression>${x}</conditionExpression></sequenceFlow>
```

Accepted:

```xml
<!-- process -->
<exclusiveGateway id="g"/><task id="t"/><sequenceFlow id="f" sourceRef="g" targetRef="t"/>
```

[All lint rules](index.md)
