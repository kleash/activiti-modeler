# parallel-multi-instance-user-task-map-all

**MAP_ALL on a parallel multi-instance user task**

| | |
|---|---|
| Rule | `activiti/parallel-multi-instance-user-task-map-all` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |
| Reads | the extensions JSON of the process |

## Why it matters

`MAP_ALL` and `MAP_ALL_INPUTS` hand a task every variable of its execution. On a parallel multi-instance user task those include the loop variables of the instance (`nrOfInstances`, `nrOfCompletedInstances`, `nrOfActiveInstances`, `loopCounter`) and the output collection; completing the task writes them back as local variables of the instance, and the multi-instance bookkeeping never sees the instances complete: the process instance stays active with nothing active and the flow never leaves the task. The completion variables of a multi-instance task stay local to the instance and are collected by `outputDataItem` whatever the mapping, so no mapping (or `MAP_ALL_OUTPUTS`) loses nothing. A sequential multi-instance user task is not affected.

Evidence: [engine-findings C20.1](../../engine-findings.md), C20-claims map-all-multi-instance.

## How to fix

Set the mapping type of the task to `MAP_ALL_OUTPUTS` (what the modeler gives a new multi-instance user task), or remove the mapping.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "u": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "u": {
      "mappingType": "MAP_ALL_OUTPUTS"
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
