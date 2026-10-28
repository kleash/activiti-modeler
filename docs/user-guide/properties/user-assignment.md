# User assignment

Who works on a user task and when it is due.

**Shown for:** user tasks.

| Field | Entry id | Written to the model |
|---|---|---|
| Assignee | `user.assignee` | `activiti:assignee` |
| Owner | `user.owner` | `activiti:owner` |
| Candidate users / groups | `user.candidateUsers`, `user.candidateGroups` | `activiti:candidateUsers`, `activiti:candidateGroups` (comma separated, or an expression giving a string or a collection) |
| Due date | `user.dueDate` | `activiti:dueDate`: ISO 8601 duration, date-time or an expression |
| Priority | `user.priority` | `activiti:priority` (empty: the engine default 0) |
| Category | `user.category` | `activiti:category` |
| Business calendar | `user.businessCalendarName` | `activiti:businessCalendarName` |
| Human performer | `user.humanPerformer` | `<bpmn:humanPerformer><bpmn:resourceAssignmentExpression>` |
| Potential owner | `user.potentialOwner` | `<bpmn:potentialOwner>` with `user(ann), group(clerks)` |
| Custom resource | `user.customResource` | `<activiti:customResource activiti:name="supervisor">` with users and groups |

## Engine notes

- The default priority is 0, not 50 ([finding 2](../../engine-findings.md)).
- A `humanPerformer` becomes the assignee, a `potentialOwner` candidate users and groups; a bare name is a group ([finding 11](../../engine-findings.md)).
- A custom resource creates an identity link of that type; it does **not** make the task visible to those users through `TaskRuntime`, which shows a task only to the assignee, owner, candidate users and members of candidate groups ([finding 10](../../engine-findings.md)).
- A user who cannot see a task gets "not found" when claiming it ([finding 13](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
