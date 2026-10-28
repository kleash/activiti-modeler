# juel-string-concatenation

**A string joined with "+" in an expression**

| | |
|---|---|
| Rule | `activiti/juel-string-concatenation` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The expression language (EL 2.2) has no string `+`: `${'go-' + region}` converts both sides to numbers and fails with `Cannot coerce 'go-' of class java.lang.String to class java.lang.Double`. Inside a signal name, a condition or a listener it fails when the element is reached, not at deployment.

Evidence: [engine-findings 36](../../engine-findings.md), [R1 §7.1 L27](../../research/activiti-9-bpmn-support.md).

## How to fix

Use `${'go-'.concat(region)}`, or write the parts as separate segments: `go-${region}`.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${'go-' + region}"/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<userTask id="u" activiti:assignee="${'go-'.concat(region)}" activiti:dueDate="${a + 1}"/>
```

[All lint rules](index.md)
