# exclusive-gateway-seq-flow-without-conditions

**An exclusive gateway has outgoing flows without a condition that are not the default**

| | |
|---|---|
| Rule | `activiti/exclusive-gateway-seq-flow-without-conditions` |
| Severity | warning |
| Engine problem key | `EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti takes the first flow whose condition is true; a flow without a condition is always true, so it hides the flows after it. The engine warns about it.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Add a condition to the flow, or make it the default flow.

## Example

Reported:

```xml
<!-- process -->
<exclusiveGateway id="g"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>
```

Accepted:

```xml
<!-- process -->
<exclusiveGateway id="g" default="f1"/><task id="t"/><task id="u"/><sequenceFlow id="f1" sourceRef="g" targetRef="t"/><sequenceFlow id="f2" sourceRef="g" targetRef="u"><conditionExpression>${y}</conditionExpression></sequenceFlow>
```

[All lint rules](index.md)
