# message-throw-without-delegate

**A message throw event without a delegate**

| | |
|---|---|
| Rule | `activiti/message-throw-without-delegate` |
| Severity | warning |
| Kind | Extra rule L18 (FEATURE_MATRIX §D) |

## Why it matters

Intermediate and end message events do not send anything by default: the default `ThrowMessageDelegate` is a no-op that returns true. A real send needs a delegate (`activiti:class` or `activiti:delegateExpression` on the message definition) that implements `ThrowMessageDelegate`.

Evidence: [R1 §0.1-13](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L18](../../research/activiti-9-bpmn-support.md), [engine run t21](../../engine-findings.md).

## How to fix

Set the **Throw delegate** in the Message group, or accept that nothing is sent (the mapping inputs still reach the delegate as the payload).

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="m"/>

<!-- process -->
<intermediateThrowEvent id="t"><messageEventDefinition messageRef="m"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="m"/>

<!-- process -->
<intermediateThrowEvent id="t"><messageEventDefinition messageRef="m" activiti:delegateExpression="${sender}"/></intermediateThrowEvent>
```

[All lint rules](index.md)
