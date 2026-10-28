# invalid-juel-expression

**An expression that is not valid JUEL**

| | |
|---|---|
| Rule | `activiti/invalid-juel-expression` |
| Severity | error |
| Kind | Extra rule L27 (FEATURE_MATRIX §D) |

## Why it matters

Every expression attribute (assignee, due date, skip expression, delegate expression, called element, multi-instance cardinality and completion condition, message and signal expressions, timers, field expressions, listeners) is parsed by the JUEL expression factory when it is used, and a malformed one fails at that moment, not at deployment. The most frequent mistakes: `${` without `}`, `=` for comparison or assignment (`${x = 5}` is a parse error), and `;`. Conditions of sequence flows are checked by `seq-flow-invalid-conditional-expression`.

Evidence: [R1 §8.1](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L27](../../research/activiti-9-bpmn-support.md), [engine-findings 25 (EL 2.2)](../../engine-findings.md).

## How to fix

Fix the expression in the field named in the message.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u" activiti:assignee="${user"/>
```

Accepted:

```xml
<!-- process -->
<userTask id="u" activiti:assignee="${initiator}" activiti:dueDate="P1D" activiti:candidateGroups="a,b"/><serviceTask id="s" activiti:expression="${bean.run(execution, 'x')}"/>
```

[All lint rules](index.md)
