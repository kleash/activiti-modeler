# message-subscription-clash

**Two message subscriptions of the same name can be active at the same time**

| | |
|---|---|
| Rule | `activiti/message-subscription-clash` |
| Severity | warning |
| Kind | Extra rule L30 (FEATURE_MATRIX §D) |

## Why it matters

`ProcessRuntime.receive` finds the subscription by name (and correlation key) with a single-result query and throws `Query return 2 results instead of max 1` when two exist. That happens with an event sub process message start next to another catch of the same message, a message catch inside a multi-instance scope (every instance subscribes), and message catches without a correlation key that exist in more than one place. Two subscriptions with the same name and the same key cannot even be created. A message boundary event on a multi-instance activity is not a clash: it subscribes once for the whole multi-instance scope, not once per instance (engine findings C20.4).

Evidence: [engine-findings 31](../../engine-findings.md), [engine-findings 32](../../engine-findings.md), [engine-findings C20.4](../../engine-findings.md), [FEATURE_MATRIX §D L30](../../FEATURE_MATRIX.md).

## How to fix

Use distinct message names, or set an `activiti:correlationKey` on the catch events so a message selects one subscription.

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="note"/>

<!-- process -->
<subProcess id="esp" triggeredByEvent="true"><startEvent id="es" isInterrupting="false"><messageEventDefinition messageRef="m"/></startEvent></subProcess><userTask id="u"/><boundaryEvent id="b" attachedToRef="u"><messageEventDefinition messageRef="m"/></boundaryEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="note"/>

<!-- process -->
<intermediateCatchEvent id="c"><messageEventDefinition messageRef="m" activiti:correlationKey="${key}"/></intermediateCatchEvent>
```

[All lint rules](index.md)
