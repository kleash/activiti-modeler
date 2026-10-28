# association-invalid-target-reference

**An association has no target**

| | |
|---|---|
| Rule | `activiti/association-invalid-target-reference` |
| Severity | error |
| Engine problem key | `ASSOCIATION_INVALID_TARGET_REFERENCE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Delete the element |

## Why it matters

Activiti rejects an association without `targetRef`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Reconnect the association to an element, or delete it.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><association id="a" sourceRef="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><association id="a" sourceRef="t" targetRef="t"/>
```

[All lint rules](index.md)
