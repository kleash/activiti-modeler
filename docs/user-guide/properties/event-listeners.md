# Event listeners

Engine event listeners of the process (`<activiti:eventListener>`): called for the engine events you list, or for all events.

**Shown for:** the process.

| Field | Entry id | Written to the model |
|---|---|---|
| Events | `listeners.event[i].events` | `events` attribute, comma separated engine event names (ENTITY_CREATED, TASK_COMPLETED, PROCESS_COMPLETED, ...); empty = all |
| Entity type | `listeners.event[i].entityType` | `entityType` filter |
| Listener type | `listeners.event[i].type` | switches between `class`, `delegateExpression` and the throwing forms |
| Java class / Delegate expression | `listeners.event[i].class`, `listeners.event[i].delegateExpression` | `class` or `delegateExpression` |
| Throw a signal / message / error | `listeners.event[i].signalName`, `.messageName`, `.errorCode` | `signalName`, `messageName`, `errorCode` with `throwEvent` |

## Engine notes

- `expression` is not a valid event listener implementation; the editor offers only class, delegate expression and the throwing forms.
- `throwEvent="signal"` signals the subscriptions of the instance of the event, `globalSignal` all subscriptions of that name, `message` the message subscriptions of the instance, `error` propagates the BPMN error from the event's execution ([C13.6](../../engine-findings.md)).
- Items can be moved up and down; listeners are called in the order listed.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
