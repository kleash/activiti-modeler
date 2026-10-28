# cancel-end-without-compensation

**A cancel end event in a transaction without compensable work before it**

| | |
|---|---|
| Rule | `activiti/cancel-end-without-compensation` |
| Severity | error |
| Kind | Extra rule L12 (FEATURE_MATRIX §D) |

## Why it matters

A cancel end event moves the transaction's compensation subscriptions into an event scope and leaves through the cancel boundary event. When no compensable activity completed before it there is no event scope, and the completion fails with `No execution found for sub process of boundary cancel event` and rolls back (the task before the cancel end stays open).

Evidence: [R1 §3.2](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L12](../../research/activiti-9-bpmn-support.md), [engine-findings C09.1](../../engine-findings.md).

## How to fix

Put an activity with a compensation boundary event and a handler (an association to a task with `isForCompensation`) before the cancel end event, or end the transaction normally.

## Example

Reported:

```xml
<!-- process -->
<transaction id="tx"><startEvent id="s"/><task id="t"/><endEvent id="c"><cancelEventDefinition/></endEvent><sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="c"/></transaction>
```

Accepted:

```xml
<!-- process -->
<transaction id="tx"><startEvent id="s"/><task id="t"/><boundaryEvent id="b" attachedToRef="t"><compensateEventDefinition/></boundaryEvent><task id="undo" isForCompensation="true"/><association id="a" sourceRef="b" targetRef="undo"/><endEvent id="c"><cancelEventDefinition/></endEvent><sequenceFlow id="f1" sourceRef="s" targetRef="t"/><sequenceFlow id="f2" sourceRef="t" targetRef="c"/></transaction>
```

[All lint rules](index.md)
