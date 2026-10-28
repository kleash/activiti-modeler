# association-invalid-source-reference

**An association has no source**

| | |
|---|---|
| Rule | `activiti/association-invalid-source-reference` |
| Severity | error |
| Engine problem key | `ASSOCIATION_INVALID_SOURCE_REFERENCE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Delete the element |

## Why it matters

Associations attach compensation handlers and annotations; Activiti rejects one without `sourceRef`.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Reconnect the association to an element, or delete it.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><association id="a" targetRef="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><association id="a" sourceRef="t" targetRef="t"/>
```

[All lint rules](index.md)
