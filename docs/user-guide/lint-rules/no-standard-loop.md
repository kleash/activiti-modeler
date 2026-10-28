# no-standard-loop

**A standard loop marker**

| | |
|---|---|
| Rule | `activiti/no-standard-loop` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |
| Quick fix | Remove the loop marker |

## Why it matters

Activiti ignores `standardLoopCharacteristics`; the task runs once.

Evidence: [R1 §0.1-11](../../research/activiti-9-bpmn-support.md), [engine run t12](../../engine-findings.md).

## How to fix

Model the loop with a gateway and a sequence flow back, or use a multi-instance marker.

## Example

Reported:

```xml
<!-- process -->
<task id="t"><standardLoopCharacteristics/></task>
```

Accepted:

```xml
<!-- process -->
<task id="t"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></task>
```

[All lint rules](index.md)
