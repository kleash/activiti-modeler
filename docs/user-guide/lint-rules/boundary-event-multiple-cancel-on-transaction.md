# boundary-event-multiple-cancel-on-transaction

**A transaction has more than one cancel boundary event**

| | |
|---|---|
| Rule | `activiti/boundary-event-multiple-cancel-on-transaction` |
| Severity | error |
| Engine problem key | `BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A transaction can be cancelled to one place only.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Delete the extra cancel boundary event.

## Example

Reported:

```xml
<!-- process -->
<transaction id="tx"/><boundaryEvent id="b1" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent><boundaryEvent id="b2" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>
```

Accepted:

```xml
<!-- process -->
<transaction id="tx"/><boundaryEvent id="b1" attachedToRef="tx"><cancelEventDefinition/></boundaryEvent>
```

[All lint rules](index.md)
