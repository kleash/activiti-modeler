# message-event-subprocess-multi-instance

**An interrupting message event sub process in a process with a multi-instance activity**

| | |
|---|---|
| Rule | `activiti/message-event-subprocess-multi-instance` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

When the message of an interrupting event sub process arrives while a multi-instance activity (a user task, a call activity or a sub process, parallel or sequential) is active, cancelling its executions fails with `PersistenceException ... ACT_FK_EXE_PARENT` (a referential integrity violation), the whole delivery is rolled back and the message is not consumed. Without an active multi-instance activity the same event sub process works, and so does an interrupting message boundary event on the multi-instance activity. Only event sub processes directly under the process are armed by Activiti 9.0.0 at all.

Evidence: [engine-findings C20.3](../../engine-findings.md), C20-claims interrupt-multi-instance.

## How to fix

Use an interrupting message boundary event on the multi-instance activity (or its sub process) instead, or make the event sub process non-interrupting.

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="stop"/>

<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><subProcess id="esp" triggeredByEvent="true"><startEvent id="es"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="stop"/>

<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><subProcess id="esp" triggeredByEvent="true"><startEvent id="es" isInterrupting="false"><messageEventDefinition messageRef="m"/></startEvent><endEvent id="ee"/></subProcess>
```

[All lint rules](index.md)
