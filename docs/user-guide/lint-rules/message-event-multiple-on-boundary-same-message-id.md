# message-event-multiple-on-boundary-same-message-id

**An activity has two message boundary events for the same message**

| | |
|---|---|
| Rule | `activiti/message-event-multiple-on-boundary-same-message-id` |
| Severity | error |
| Engine problem key | `MESSAGE_EVENT_MULTIPLE_ON_BOUNDARY_SAME_MESSAGE_ID` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Two subscriptions of one activity to one message are rejected at deployment.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §3.2 (t56)](../../research/activiti-9-bpmn-support.md).

## How to fix

Keep one boundary event, or use two different messages.

## Example

Reported:

```xml
<!-- definitions -->
<message id="msg" name="m"/>

<!-- process -->
<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="msg" name="m"/><message id="msg2" name="n"/>

<!-- process -->
<task id="t"/><boundaryEvent id="b1" attachedToRef="t"><messageEventDefinition messageRef="msg"/></boundaryEvent><boundaryEvent id="b2" attachedToRef="t"><messageEventDefinition messageRef="msg2"/></boundaryEvent>
```

[All lint rules](index.md)
