# seq-flow-invalid-conditional-expression

**The condition of a sequence flow is not a valid JUEL expression**

| | |
|---|---|
| Rule | `activiti/seq-flow-invalid-conditional-expression` |
| Severity | error |
| Engine problem key | `SEQ_FLOW_INVALID_CONDITIONAL_EXPRESSION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti parses every condition with its expression factory when the process is deployed and rejects the file if one does not parse. Conditions are JUEL (`${amount > 100}`), not scripts: there is no assignment and no `;`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §8.1](../../research/activiti-9-bpmn-support.md).

## How to fix

Fix the expression in the **Condition** field of the flow.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"><conditionExpression>${amount &gt; }</conditionExpression></sequenceFlow>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><task id="u"/><sequenceFlow id="f" sourceRef="t" targetRef="u"><conditionExpression xsi:type="tFormalExpression">${amount &gt; 100 &amp;&amp; !empty(name)}</conditionExpression></sequenceFlow>
```

[All lint rules](index.md)
