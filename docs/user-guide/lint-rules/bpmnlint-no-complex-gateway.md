# bpmnlint/no-complex-gateway

**A complex gateway**

| | |
|---|---|
| Rule | `no-complex-gateway` of [bpmnlint](https://github.com/bpmn-io/bpmnlint) |
| Severity in `activiti:recommended` | error |

## What it means for Activiti

bpmnlint reports every complex gateway. Activiti has no complex gateway behaviour: `ComplexGatewayXMLConverter` builds an **exclusive gateway**, so the activation condition you modelled is ignored and the first true flow wins (R1 §0.1-4). The quick fix replaces the gateway by an exclusive gateway, which is what runs anyway.

Message note: Activiti runs a complex gateway as an exclusive gateway (R1 §0.1-4).

[All lint rules](index.md)
