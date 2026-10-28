# message-invalid-item-ref

**A message refers to an item definition that does not exist**

| | |
|---|---|
| Rule | `activiti/message-invalid-item-ref` |
| Severity | error |
| Engine problem key | `MESSAGE_INVALID_ITEM_REF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The validator resolves `itemRef` among the item definitions of the file. The parser registers an item definition only when it has a `structureRef`, so one without it does not exist for the engine.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [engine-findings V.2](../../engine-findings.md).

## How to fix

Remove the item reference, or define the item (with a structureRef).

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="m" itemRef="missing"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<itemDefinition id="item" structureRef="xsd:string"/><message id="m" name="m" itemRef="item"/>

<!-- process -->

```

[All lint rules](index.md)
