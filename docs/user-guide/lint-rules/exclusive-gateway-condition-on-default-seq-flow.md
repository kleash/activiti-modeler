# exclusive-gateway-condition-on-default-seq-flow

**The default flow of an exclusive gateway has a condition**

| | |
|---|---|
| Rule | `activiti/exclusive-gateway-condition-on-default-seq-flow` |
| Severity | error |
| Engine problem key | `EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The default flow is taken when no other condition is true, so it must not have a condition of its own.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Remove the condition from the default flow.

## Example

Reported:

```xml
<!-- process -->
<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"><conditionExpression>${x}</conditionExpression></sequenceFlow><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>
```

Accepted:

```xml
<!-- process -->
<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>
```

[All lint rules](index.md)
