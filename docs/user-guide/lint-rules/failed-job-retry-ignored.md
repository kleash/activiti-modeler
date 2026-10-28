# failed-job-retry-ignored

**failedJobRetryTimeCycle on an element other than a service task**

| | |
|---|---|
| Rule | `activiti/failed-job-retry-ignored` |
| Severity | warning |
| Kind | Extra rule L31 (FEATURE_MATRIX §D) |

## Why it matters

The retry cycle is honoured only for service tasks (`JobRetryCmd` reads it when the failed element is a ServiceTask). On any other element the model keeps the value and the job gets the default three attempts.

Evidence: [R1 §7.1 L31](../../research/activiti-9-bpmn-support.md), [engine-findings C19.2](../../engine-findings.md), [FEATURE_MATRIX T15a](../../FEATURE_MATRIX.md).

## How to fix

Remove it, or make the element a service task.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u" activiti:async="true"><extensionElements><activiti:failedJobRetryTimeCycle>R5/PT1S</activiti:failedJobRetryTimeCycle></extensionElements></userTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:class="a.B" activiti:async="true"><extensionElements><activiti:failedJobRetryTimeCycle>R5/PT1S</activiti:failedJobRetryTimeCycle></extensionElements></serviceTask>
```

[All lint rules](index.md)
