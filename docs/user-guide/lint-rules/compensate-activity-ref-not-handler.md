# compensate-activity-ref-not-handler

**A compensation throw event that names the compensated activity instead of its handler**

| | |
|---|---|
| Rule | `activiti/compensate-activity-ref-not-handler` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The subscription of a compensation boundary event is keyed by the id of the **handler**, and the throw event looks subscriptions up by `activityRef`. `activityRef="bookFlight"` (the task the BPMN specification means) finds nothing and the event passes silently; `activityRef="cancelFlight"` (the handler) compensates it. For a completed sub process the sub process id is right.

Evidence: [engine-findings C08.2](../../engine-findings.md).

## How to fix

Choose the compensation handler in **Compensation > Activity**.

## Example

Reported:

```xml
<!-- process -->
<task id="book"/><boundaryEvent id="b" attachedToRef="book"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><intermediateThrowEvent id="t"><compensateEventDefinition activityRef="book"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<task id="book"/><boundaryEvent id="b" attachedToRef="book"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><intermediateThrowEvent id="t"><compensateEventDefinition activityRef="undo"/></intermediateThrowEvent>
```

[All lint rules](index.md)
