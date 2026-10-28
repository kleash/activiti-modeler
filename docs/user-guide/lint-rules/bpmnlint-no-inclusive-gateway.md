# bpmnlint/no-inclusive-gateway

**An inclusive gateway (switched off)**

| | |
|---|---|
| Rule | `no-inclusive-gateway` of [bpmnlint](https://github.com/bpmn-io/bpmnlint) |
| Severity in `activiti:recommended` | off |

## What it means for Activiti

bpmnlint discourages inclusive gateways. Activiti executes them (`default` flow, join waits for the active branches), so the rule is switched off in `activiti:recommended`.



[All lint rules](index.md)
