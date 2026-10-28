# operation-invalid-in-message-reference

**An operation with an implementation refers to an input message that does not exist**

| | |
|---|---|
| Rule | `activiti/operation-invalid-in-message-reference` |
| Severity | error |
| Engine problem key | `OPERATION_INVALID_IN_MESSAGE_REFERENCE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Operations only matter for web service tasks, which Activiti 9 cannot run, but the validator still checks the `<inMessageRef>` child element of every operation. Only an operation that has an `implementationRef` is read at all (the parser drops the others), so only those are checked.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings V.1](../../engine-findings.md).

## How to fix

Delete the interface or define the message it refers to.

## Example

Reported:

```xml
<!-- definitions -->
<interface id="i" name="I"><operation id="o" name="op" implementationRef="impl"><inMessageRef>nomsg</inMessageRef></operation></interface>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="m"/><interface id="i" name="I"><operation id="o" name="op" implementationRef="impl"><inMessageRef>m</inMessageRef></operation></interface>

<!-- process -->

```

[All lint rules](index.md)
