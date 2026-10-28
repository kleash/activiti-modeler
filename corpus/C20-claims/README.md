# C20-claims: insurance claim

Business project for the corpus row **C20** ([verification index](../../docs/verification-index.md), section 13): a DMN triage, a multi-instance review, an exclusive
gateway on variables and an event sub process. Built through the modeler without hand-made mappings (`createProject` without `defaultMappings`): the user tasks, the
boundary event and the event sub process start have the modeler's default mapping, and so has the multi-instance review (`MAP_ALL_OUTPUTS`, see below). The only mapping
`build.ts` writes by hand is the explicit `MAP_ALL` of the process `mapAllMultiInstance`, which pins what the default avoids.

| Element (`seed/processes/insurance-claim.bpmn20.xml`) | What it shows |
|---|---|
| `triage` | Decision task on `claim-triage.dmn` (FIRST; `claimType` and `claimAmount` give `severity` and the number of `reviewers`), wired by the decision picker |
| `assessClaim` | **Parallel multi-instance user task**, cardinality `${reviewers}` (a DMN output), candidate group `adjusters`, default mapping `MAP_ALL_OUTPUTS`; the completion variable `verdict` stays local to the instance and `outputDataItem` collects it into `verdicts` |
| `outcomeGateway` | Exclusive gateway on variables: `${verdicts.contains('REJECT')}`, `${severity == 'MAJOR'}`, default |
| `managerSignOff` | User task (group `claims-managers`) with the default `MAP_ALL`: `signedOff`, `signOffNote` and `sys_task_assignee` reach the process |
| `onWithdrawal` | Interrupting **message boundary event** on the review, default `MAP_ALL`: the payload `withdrawalReason` reaches the process |
| `documentsHandler` / `documentStart` | **Non-interrupting message event sub process**, default `MAP_ALL` on its start event: the payload `documentName` reaches the process while the claim goes on |

## Engine findings made here (engine findings C20.1, C20.3, C20.4 in `docs/engine-findings.md`)

1. **`MAP_ALL` wedges a parallel multi-instance user task** (`map-all-multi-instance.scenario.json`, process `mapAllMultiInstance`, `MAP_ALL` set explicitly). `MAP_ALL` (and `MAP_ALL_INPUTS`) hands the task every variable of
   the instance execution, which in a multi-instance includes `nrOfInstances`, `nrOfActiveInstances`, `nrOfCompletedInstances`, `loopCounter` and the output collection; completing the task
   writes them back as local variables of the instance, and the multi-instance bookkeeping never sees the instances finish: the instance stays active with nothing active, the flow never
   leaves the task, `verdicts` stays empty. A sequential multi-instance task with `MAP_ALL` completes (tested with a cardinality of 5 and a completion condition), and so does a parallel or sequential one with `MAP_ALL_OUTPUTS` or no
   mapping, which behave alike. The modeler therefore gives a user task that is (or becomes) multi-instance `MAP_ALL_OUTPUTS` instead of `MAP_ALL`: `assessClaim` is
   built with that default and its scenarios assert the collected `verdicts` and that nothing else leaks into the process. The lint rule `parallel-multi-instance-user-task-map-all` warns about the explicit choice.
2. **An interrupting message event sub process cannot interrupt an active multi-instance activity** (`interrupt-multi-instance.scenario.json`, process `interruptMultiInstance`): delivering its message fails with `PersistenceException ... ACT_FK_EXE_PARENT`
   and is rolled back (the review goes on). It holds for a parallel or sequential multi-instance user task, call activity or sub process, and for a multi-instance task inside an embedded sub process; a message boundary event on the same task works (`onWithdrawal`), and so does a
   non-interrupting event sub process (`documentsHandler`) while the review is open. This is why the withdrawal is a boundary event. The lint rule `message-event-subprocess-multi-instance` warns about the construct.
   (Also seen: a message start in an event sub process nested in an embedded sub process is never subscribed, only the ones directly under the process; an error event sub process does not catch an error thrown inside a multi-instance service task.)
3. A non-interrupting message event sub process starts **once** per instance (the second `claimDocuments` message is not found), as in C06; the scenario asserts the failure.
4. A message boundary event on a parallel multi-instance task with two open instances receives its message, with or without a correlation key (`onWithdrawal`): it subscribes once for the whole multi-instance scope. A message catch **inside** a multi-instance sub process subscribes once per instance
   (`Query return 2 results instead of max 1`); the lint rule `message-subscription-clash` reports that case only.

## What the default mappings carry

Control, run once while the project was written (a copy of the seed with the entry deleted): without the mapping of `managerSignOff`, `onWithdrawal` or `documentStart` the scenario that
asserts its payload fails (1 scenario each); all three defaults are load-bearing.

Every flow node and sequence flow is visited; eight exemptions (`coverage-exemptions.json`): the event sub process container and its start event (the engine records no history for them, as in C06) and, in
`mapAllMultiInstance`, the end event and the flow into it (the instance is wedged on purpose), and in `interruptMultiInstance` the event sub process, its start event, its end event and the flow between them (the delivery fails on purpose).

Run: `scripts/verify-models.sh corpus --project C20-claims`
