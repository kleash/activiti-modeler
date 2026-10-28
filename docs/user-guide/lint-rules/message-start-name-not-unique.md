# message-start-name-not-unique

**Two message start events listen for the same message name**

| | |
|---|---|
| Rule | `activiti/message-start-name-not-unique` |
| Severity | error |
| Kind | Extra rule L17 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

Activiti subscribes every message start event at deployment and refuses a second subscription to the same name: `there already is a message event subscription for the message start event`.

Evidence: [R1 §2.1-4](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L17](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §D L34](../../FEATURE_MATRIX.md).

## How to fix

Give each message start its own message name.

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="order"/>

<!-- process -->
<startEvent id="s"><messageEventDefinition messageRef="m"/></startEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="order"/>

<!-- process -->
<startEvent id="s"><messageEventDefinition messageRef="m"/></startEvent>
```

[All lint rules](index.md)
