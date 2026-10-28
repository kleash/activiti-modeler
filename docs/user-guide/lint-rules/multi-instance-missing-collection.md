# multi-instance-missing-collection

**A multi-instance activity has neither a cardinality nor a collection**

| | |
|---|---|
| Rule | `activiti/multi-instance-missing-collection` |
| Severity | error |
| Engine problem key | `MULTI_INSTANCE_MISSING_COLLECTION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti cannot tell how many instances to create. The validator does not check the multi-instance sub process itself, only tasks and call activities.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §3.6](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Loop cardinality** or **Collection** in the multi-instance group.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics/></userTask>
```

Accepted:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>3</loopCardinality></multiInstanceLoopCharacteristics></userTask>
```

[All lint rules](index.md)
