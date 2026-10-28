# skip-expression-needs-enable-variable

**A skip expression without the _ACTIVITI_SKIP_EXPRESSION_ENABLED variable**

| | |
|---|---|
| Rule | `activiti/skip-expression-needs-enable-variable` |
| Severity | warning |
| Kind | Extra rule L20 (FEATURE_MATRIX §D) |
| Reads | the extensions JSON of the process |

## Why it matters

Activiti evaluates `activiti:skipExpression` only when the process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` is `true`; otherwise the expression is ignored and the task runs. The process runtime rejects start variables whose name starts with an underscore, so declare the variable as a process property with the default `true`.

Evidence: [R1 §3.3](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L20](../../research/activiti-9-bpmn-support.md), [engine-findings 6](../../engine-findings.md).

## How to fix

Add a boolean process variable `_ACTIVITI_SKIP_EXPRESSION_ENABLED` with the default `true` in **Process variables**.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u" activiti:skipExpression="${skip}"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {},
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<userTask id="u" activiti:skipExpression="${skip}"/>

<!-- extensions -->
{
  "properties": {
    "s": {
      "id": "s",
      "name": "_ACTIVITI_SKIP_EXPRESSION_ENABLED",
      "type": "boolean",
      "value": true
    }
  },
  "mappings": {},
  "constants": {}
}
```

[All lint rules](index.md)
