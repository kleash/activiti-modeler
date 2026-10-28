# boundary-event-cancel-only-on-transaction

**A cancel boundary event is attached to something other than a transaction**

| | |
|---|---|
| Rule | `activiti/boundary-event-cancel-only-on-transaction` |
| Severity | error |
| Engine problem key | `BOUNDARY_EVENT_CANCEL_ONLY_ON_TRANSACTION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A cancel event reacts to the cancellation of a transaction sub process.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Attach it to a transaction, or use another boundary event.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"><cancelEventDefinition/></boundaryEvent>
```

Accepted:

```xml
<!-- process -->
<transaction id="tx"/><boundaryEvent id="b" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>
```

[All lint rules](index.md)
