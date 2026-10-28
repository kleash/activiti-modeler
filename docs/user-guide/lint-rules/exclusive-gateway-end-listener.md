# exclusive-gateway-end-listener

**An end execution listener on an exclusive gateway**

| | |
|---|---|
| Rule | `activiti/exclusive-gateway-end-listener` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

An exclusive gateway moves the execution onto the chosen flow itself, so its `end` listeners never run (its `start` listeners and the `take` listeners of the flows do).

Evidence: [engine-findings C13.2](../../engine-findings.md).

## How to fix

Use a `take` listener on the outgoing flows, or a `start` listener on the gateway.

## Example

Reported:

```xml
<!-- process -->
<exclusiveGateway id="g"><extensionElements><activiti:executionListener event="end" class="a.B"/></extensionElements></exclusiveGateway>
```

Accepted:

```xml
<!-- process -->
<exclusiveGateway id="g"><extensionElements><activiti:executionListener event="start" class="a.B"/></extensionElements></exclusiveGateway>
```

[All lint rules](index.md)
