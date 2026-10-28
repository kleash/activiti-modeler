# no-instantiating-event-gateway

**An instantiating or parallel event-based gateway**

| | |
|---|---|
| Rule | `activiti/no-instantiating-event-gateway` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

Activiti has no event-based gateway that starts the process (`instantiate="true"`) and no parallel variant.

Evidence: [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

Use an exclusive event-based gateway after a start event.

## Example

Reported:

```xml
<!-- process -->
<eventBasedGateway id="g" instantiate="true"/>
```

Accepted:

```xml
<!-- process -->
<eventBasedGateway id="g"/>
```

[All lint rules](index.md)
