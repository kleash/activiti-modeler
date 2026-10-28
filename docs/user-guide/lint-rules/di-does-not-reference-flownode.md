# di-does-not-reference-flownode

**A diagram shape refers to a flow element that is not a flow node**

| | |
|---|---|
| Rule | `activiti/di-does-not-reference-flownode` |
| Severity | warning |
| Engine problem key | `DI_DOES_NOT_REFERENCE_FLOWNODE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A `dataStoreReference` is a flow element but no flow node in the Activiti model (engine finding C18.2).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings C18.2](../../engine-findings.md).

## How to fix

Remove the drawn reference.

## Example

Reported:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">
  <process id="p" isExecutable="true"><dataStoreReference id="ds"/></process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p"><bpmndi:BPMNShape id="ds_di" bpmnElement="ds"><dc:Bounds x="100" y="100" width="36" height="50"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>
```

Accepted:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">
  <process id="p" isExecutable="true"><task id="t"/></process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p"><bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>
```

[All lint rules](index.md)
