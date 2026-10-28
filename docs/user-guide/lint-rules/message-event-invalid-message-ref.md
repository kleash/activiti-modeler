# message-event-invalid-message-ref

**A message event refers to a message that is not defined**

| | |
|---|---|
| Rule | `activiti/message-event-invalid-message-ref` |
| Severity | error |
| Engine problem key | `MESSAGE_EVENT_INVALID_MESSAGE_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The message must be a `<message>` of the file.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Pick the message again, or define it.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="m"><messageEventDefinition messageRef="ghost"/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="msg" name="m"/>

<!-- process -->
<intermediateCatchEvent id="m"><messageEventDefinition messageRef="msg"/></intermediateCatchEvent>
```

[All lint rules](index.md)
