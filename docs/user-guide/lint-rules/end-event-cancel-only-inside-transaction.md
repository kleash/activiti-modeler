# end-event-cancel-only-inside-transaction

**A cancel end event is not directly inside a transaction**

| | |
|---|---|
| Rule | `activiti/end-event-cancel-only-inside-transaction` |
| Severity | error |
| Engine problem key | `END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A cancel end event cancels the transaction around it.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Move the event into a transaction, or use another end event.

## Example

Reported:

```xml
<!-- process -->
<endEvent id="e"><cancelEventDefinition/></endEvent>
```

Accepted:

```xml
<!-- process -->
<transaction id="tx"><endEvent id="e"><cancelEventDefinition/></endEvent></transaction>
```

[All lint rules](index.md)
