# flow-element-id-too-long

**The id of an activity is longer than 255 characters**

| | |
|---|---|
| Rule | `activiti/flow-element-id-too-long` |
| Severity | error |
| Engine problem key | `FLOW_ELEMENT_ID_TOO_LONG` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti checks the id of tasks and call activities (not of events, gateways or sub processes) against the 255 character column limit.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Shorten the **ID** of the element.

## Example

Reported:

```xml
<!-- process -->
<task id="tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt"/>
```

Accepted:

```xml
<!-- process -->
<task id="ttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt"/>
```

[All lint rules](index.md)
