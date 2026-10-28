# data-association-missing-targetref

**A data input / output association of an activity has no target**

| | |
|---|---|
| Rule | `activiti/data-association-missing-targetref` |
| Severity | error |
| Engine problem key | `DATA_ASSOCIATION_MISSING_TARGETREF` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Delete the element |

## Why it matters

Activiti checks `targetRef` of the data associations of every activity.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Reconnect or delete the data association.

## Example

Reported:

```xml
<!-- process -->
<task id="t"><dataInputAssociation id="da"><sourceRef>x</sourceRef></dataInputAssociation></task>
```

Accepted:

```xml
<!-- process -->
<task id="t"><ioSpecification id="io"><dataInput id="di1"/><inputSet><dataInputRefs>di1</dataInputRefs></inputSet><outputSet/></ioSpecification><dataInputAssociation id="da"><targetRef>di1</targetRef></dataInputAssociation></task>
```

[All lint rules](index.md)
