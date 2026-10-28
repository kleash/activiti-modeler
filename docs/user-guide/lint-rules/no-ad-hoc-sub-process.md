# no-ad-hoc-sub-process

**An ad-hoc sub process**

| | |
|---|---|
| Rule | `activiti/no-ad-hoc-sub-process` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

Activiti deploys an ad-hoc sub process, enters a wait state with no way to start its inner activities, and never completes: `ordering`, `cancelRemainingInstances` and `completionCondition` are read, but nothing activates a task. (bpmnlint's own `ad-hoc-sub-process` rule only reports start and end events inside one.)

Evidence: [R1 §0.1-5](../../research/activiti-9-bpmn-support.md), [engine run t10](../../engine-findings.md), [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

There is no replacement. Model the choice with an exclusive or inclusive gateway and sequence flows, or call the activities from a multi-instance call activity.

## Example

Reported:

```xml
<!-- process -->
<adHocSubProcess id="a"><task id="t"/></adHocSubProcess>
```

Accepted:

```xml
<!-- process -->
<subProcess id="a"><startEvent id="s"/><task id="t"/><endEvent id="e"/></subProcess>
```

[All lint rules](index.md)
