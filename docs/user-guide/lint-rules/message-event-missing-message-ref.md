# message-event-missing-message-ref

**A message event names no message**

| | |
|---|---|
| Rule | `activiti/message-event-missing-message-ref` |
| Severity | error |
| Engine problem key | `MESSAGE_EVENT_MISSING_MESSAGE_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A message event needs `messageRef` (a message of the file) or an `activiti:messageExpression`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Pick or create the message in the event's **Message** group.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="m"><messageEventDefinition/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="msg" name="m"/>

<!-- process -->
<intermediateCatchEvent id="m"><messageEventDefinition messageRef="msg"/></intermediateCatchEvent>
```

[All lint rules](index.md)
