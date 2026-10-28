# Timer

When a timer start, intermediate catch or boundary event fires.

**Shown for:** events with a timer definition.

| Field | Entry id | Written to the model |
|---|---|---|
| Type | `timer.definition.type` | `timeDate`, `timeDuration` or `timeCycle` |
| Value | `timer.definition.value` | the body of that element (`PT30M`, `2030-01-01T12:00:00Z`, `R3/PT1H`, `0 0 12 * * ?`) |
| End date | `timer.definition.endDate` | `activiti:endDate` of a cycle |
| Business calendar | `timer.businessCalendarName` | `activiti:businessCalendarName` |

## Engine notes

- The value is checked while you type (ISO 8601 date, duration, repeat; Quartz cron with 6 or 7 fields) and a preview sentence says when the timer fires. Expressions (`${...}`) are accepted.
- A cycle on an intermediate catch event fires only once, and a boundary timer never repeats unless it is non-interrupting; the panel says so.
- A start timer whose end date is before its due date is dropped silently when it fires ([finding 26](../../engine-findings.md)); a repeating timer that fires late computes the next occurrence from the clock ([finding 27](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
