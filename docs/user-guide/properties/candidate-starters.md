# Candidate starters

Restricts who may start an instance of the process through `ProcessRuntime`. With no starters, everybody may.

**Shown for:** the process.

| Field | Entry id | Written to the model |
|---|---|---|
| Candidate starter users | `starters.users` | `activiti:candidateStarterUsers`, comma separated user ids. |
| Candidate starter groups | `starters.groups` | `activiti:candidateStarterGroups`, comma separated group ids. |
| Potential starter | `starters.potential` | `<activiti:potentialStarter><bpmn:resourceAssignmentExpression><bpmn:formalExpression>`, for example `user(ann), group(clerks)`; a bare name is a group. |

## Engine notes

- The list is evaluated against the authenticated user of the call (`Authentication.setAuthenticatedUserId`), see [start initiator](start-initiator-form.md).
- A potential starter on its own restricts nothing: everybody may start the process. Only together with candidate starter users or groups are the starters restricted, to the users and groups of both ([finding C21.1](../../engine-findings.md)).
- A user who is not a candidate cannot see the definition; the REST API answers not found rather than forbidden.

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
