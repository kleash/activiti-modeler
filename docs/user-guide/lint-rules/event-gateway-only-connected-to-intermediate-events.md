# event-gateway-only-connected-to-intermediate-events

**An event-based gateway leads to something other than an intermediate catch event**

| | |
|---|---|
| Rule | `activiti/event-gateway-only-connected-to-intermediate-events` |
| Severity | error |
| Engine problem key | `EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti waits for the first of the events behind an event-based gateway. A receive task is rejected (L19), so is any other target.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L19](../../research/activiti-9-bpmn-support.md).

## How to fix

Put an intermediate catch event (message, signal or timer) after the gateway; use a receive task after the event if you need one.

## Example

Reported:

```xml
<!-- process -->
<eventBasedGateway id="g"/><receiveTask id="r"/><sequenceFlow id="f" sourceRef="g" targetRef="r"/>
```

Accepted:

```xml
<!-- process -->
<eventBasedGateway id="g"/><intermediateCatchEvent id="c"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent><sequenceFlow id="f" sourceRef="g" targetRef="c"/>
```

[All lint rules](index.md)
