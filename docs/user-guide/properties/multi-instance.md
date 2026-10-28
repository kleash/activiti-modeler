# Multi-instance

Runs an activity once per item of a collection or a fixed number of times.

**Shown for:** tasks, call activities and sub processes.

| Field | Entry id | Written to the model |
|---|---|---|
| Type | `mi.type` | `<bpmn:multiInstanceLoopCharacteristics isSequential>`; none removes it |
| Cardinality | `mi.cardinality` | `<bpmn:loopCardinality>` |
| Collection | `mi.collection` | `activiti:collection` |
| Element variable | `mi.elementVariable` | `activiti:elementVariable` |
| Element index variable | `mi.elementIndexVariable` | `activiti:elementIndexVariable` |
| Completion condition | `mi.completionCondition` | `<bpmn:completionCondition>` |
| Output collection / item | `mi.outputCollection`, `mi.outputItem` | `<bpmn:loopDataOutputRef>`, `<bpmn:outputDataItem>` (not for call activities) |

## Engine notes

- `activiti:collection` is parsed into `inputDataItem` ([finding 3](../../engine-findings.md)).
- For user tasks, the completion variables of an instance are local to the instance and `outputDataItem` collects them; a parallel completion condition cancels the open instances ([finding 19](../../engine-findings.md)).
- The output collection is not offered for call activities ([C11.1](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
