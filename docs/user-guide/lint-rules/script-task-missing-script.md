# script-task-missing-script

**A script task has no script**

| | |
|---|---|
| Rule | `activiti/script-task-missing-script` |
| Severity | error |
| Engine problem key | `SCRIPT_TASK_MISSING_SCRIPT` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

An empty script is rejected.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Write the script in the **Script** group.

## Example

Reported:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="javascript"/>
```

Accepted:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="javascript"><script>execution.setVariable("a", 1)</script></scriptTask>
```

[All lint rules](index.md)
