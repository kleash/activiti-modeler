# di-invalid-reference

**A diagram shape or edge refers to an element the Activiti model does not contain**

| | |
|---|---|
| Rule | `activiti/di-invalid-reference` |
| Severity | warning |
| Engine problem key | `DI_INVALID_REFERENCE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti 9 has no model element for a `dataObjectReference`, a data association or a `group`, so a drawn one makes the engine warn (engine finding C18.2). The process still deploys and runs; the data object itself is edited without a shape (**Data objects** in the process properties) to keep deployments warning-free.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings C18.2](../../engine-findings.md).

## How to fix

Remove the shape (the data object stays declared in the properties), or accept the warning.

## Example

Reported:

```xml
<!-- process -->
<dataObjectReference id="dor" dataObjectRef="d1"/><dataObject id="d1" name="d1"/>

<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">
  <process id="p" isExecutable="true"><dataObjectReference id="dor" dataObjectRef="d1"/><dataObject id="d1" name="d1"/></process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p"><bpmndi:BPMNShape id="dor_di" bpmnElement="dor"><dc:Bounds x="100" y="100" width="36" height="50"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
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
