# Event definitions

Message, signal, error, link, compensation and terminate events.

**Shown for:** events with the respective event definition.

| Field | Entry id | Written to the model |
|---|---|---|
| Message | `message.ref`, `message.expression`, `message.correlationKey` | `messageRef`, `activiti:messageExpression`, `activiti:correlationKey` |
| Throw message delegate | `message.class`, `message.delegateExpression`, `message.fields` | `activiti:class`, `activiti:delegateExpression`, `activiti:field` |
| Signal | `signal.ref`, `signal.expression`, `signal.async`, `signal.scope` | `signalRef`, `activiti:signalExpression`, `activiti:async`, scope on the declaration |
| Error | `error.ref` | `errorRef` |
| Link | `link.name`, `link.target`, `link.sources` | `name` of the link; the target is the catch event of the same name |
| Compensation | `compensate.activityRef`, `compensate.waitForCompletion` | `activityRef`, `waitForCompletion` |
| Terminate | `terminate.all`, `terminate.multiInstance` | `activiti:terminateAll`, `activiti:terminateMultiInstance` |

## Engine notes

- ### message
A throw event needs a delegate (class or delegate expression) to send anything. `activiti:field` on a message event definition is never injected ([finding 33](../../engine-findings.md)). A message start event's mapping drops the unmapped variables ([finding 30](../../engine-findings.md)). `receive` needs a correlation key when several subscriptions share a name ([finding 31](../../engine-findings.md)).
- ### signal
Naming a signal by expression: a file that declares any signal fails to parse ([finding 28](../../engine-findings.md)), the subscription of the catch event is never removed ([finding 29](../../engine-findings.md)), and `+` does not concatenate strings ([finding 36](../../engine-findings.md)). The panel warns about all three. Signal payloads are not mapped ([finding 37](../../engine-findings.md)).
- ### error
An error boundary event without an error catches every error and always interrupts, whatever `cancelActivity` says ([C08.5](../../engine-findings.md)).
- ### link
A link throw event continues at the link catch event of the same name in the same process level. The catch event lists the throw events that target it.
- ### compensation
`activityRef` must name the compensation **handler** (or the compensated sub process), not the compensated task ([C08.2](../../engine-findings.md)); the picker offers handlers first. `waitForCompletion` is parsed and ignored ([C08.3](../../engine-findings.md)).
- ### terminate
A terminate end event ends the instance; `terminateAll` also ends parent scopes of called processes.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
