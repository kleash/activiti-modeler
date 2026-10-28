# no-camunda-extensions

**A camunda: or zeebe: attribute or element**

| | |
|---|---|
| Rule | `activiti/no-camunda-extensions` |
| Severity | error |
| Kind | Extra rule L1 (FEATURE_MATRIX §D) |
| Quick fix | Translate to the Activiti equivalent |

## Why it matters

Activiti reads only the `http://activiti.org/bpmn` namespace for its extension attributes. A `camunda:assignee` is silently ignored (the task has no assignee and nothing says so), `camunda:class` on a service task fails the deployment, and a `camunda:inputOutput` does nothing. The modeler never writes them and refuses to save a file that has them.

Evidence: [R1 §0.1-1](../../research/activiti-9-bpmn-support.md), [R1 §5 (translation table)](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L1](../../research/activiti-9-bpmn-support.md), [engine runs t01 t13d](../../engine-findings.md), [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

Use the quick fix: it translates the attribute or element to its Activiti equivalent where there is one (assignee, candidateUsers, class, expression, asyncBefore as async, listeners, fields, input/output parameters as an extensions mapping, ...) and removes it where there is not (followUpDate, historyTimeToLive, external tasks, ...). A Camunda Modeler file can also be imported with the Camunda importer, which reports what was lost.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u" camunda:assignee="kermit" camunda:candidateGroups="g"/>
```

Accepted:

```xml
<!-- process -->
<userTask id="u" activiti:assignee="kermit" activiti:candidateGroups="g"/>
```

[All lint rules](index.md)
