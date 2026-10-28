# C20-loan: loan origination

Business project for the corpus row **C20** ([verification index](../../docs/verification-index.md), section 13): a realistic multi-process model whose
point is to prove, on Activiti 9.0.0, the **default mappings the modeler writes** (`MAP_ALL`, [ADR 0006](../../docs/adr/0006-extensions-store.md)). The
user tasks, the call activity and the message catch event of this project have no hand-made mapping: `build.ts` creates them with the modeler's
default (`createProject` without `defaultMappings`) and the seed is written in the exact form the modeler writes. The only mapping written through an
accessor is the decision task's (`decision.pick`, the picker of the Decision group).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `loanOrigination` | Application received, call activity `kycCall` (the KYC check), exclusive gateway on `kycStatus`, decision task `assessRisk` on the DMN table `creditDecision` (inputs `creditScore`, `amount`; outputs `riskClass`, `route`, matched rules in `creditRules`), exclusive gateway on `route` (decline / automatic / manual), user task `underwriting` (candidate group `underwriters`) with an interrupting **timer boundary** (`PT48H`) that escalates to the user task `seniorReview` (group `senior-underwriters`), exclusive gateway on `approved`, expression task `prepareOffer`, message catch `awaitDocuments` (`documentsReceived`, correlation key `${applicationId}`), exclusive gateway on `documentsComplete`, disbursement |
| `kycCheck` | The called process: user task `verifyIdentity` (group `kyc-analysts`) whose completion variables `idVerified` and `creditScore` feed an exclusive gateway; expression tasks set `kycStatus` |
| `credit-policy.dmn` | UNIQUE table, two inputs, two outputs, four rules (`creditDecision_decline`, `_manualMedium`, `_autoLow`, `_manualLarge`) |

## What the default mappings carry (and what the scenarios assert)

| Element | Mapping (written by the modeler) | What reaches the process | Asserted by |
|---|---|---|---|
| `kycCall` (call activity) | `MAP_ALL` | in: every variable of the application starts the child (`expectChildInstance.startVariables`, `expectTask.localVariables` of `verifyIdentity`); out: `kycStatus`, `creditScore`, `idVerified`, `sys_task_assignee` come back, and the gateways `kycGateway` and `routeGateway` (through the DMN input `creditScore`) decide on them | all six process scenarios; the failed KYC ends in `kycRejectedEnd` |
| `verifyIdentity` (user task of the child) | `MAP_ALL` | the analyst's `idVerified` and `creditScore` become variables of the child process (gateway `identityGateway`) | `expectChildInstance.variables`, path of the child |
| `underwriting`, `seniorReview` (user tasks) | `MAP_ALL` | `approved`, `approvedAmount`, `underwriterNote` reach the process; `approved` decides `approvedGateway`, `approvedAmount` becomes `offerAmount` | "manual underwriting", "the underwriter rejects", "the 48 hour timer escalates" |
| `awaitDocuments` (message catch event) | `MAP_ALL` | the payload `documentCount` and `documentsComplete`; `documentsComplete` decides `documentsGateway` (funded or closed) | "an automatic offer", "manual underwriting", "the 48 hour timer escalates" |

Control, run once while the project was written (a copy of the seed with the entry deleted from the extensions file): without the mapping of `kycCall`
or `verifyIdentity` 7 of the 7 process scenarios fail, without `underwriting` 3, without `seniorReview` 1 and without `awaitDocuments` 3. So each default is
load-bearing on the engine, not decoration.

Other things the scenarios assert: task assignment (`candidateGroups`, `visibleTo` / `notVisibleTo`), the task-local variables a `MAP_ALL` task receives
(all process variables), the timer job (`expectTimer`: due 48 hours after the fixed clock; gone once the task is completed), `fireTimer` and the escalation
path, a message with the wrong correlation key (`ActivitiObjectNotFoundException`), the matched rules of the table in the process (`creditRules`) and 7
direct evaluations of the table at its boundaries (`credit-policy.scenario.json`).

`model-expect.json` asserts what the engine's own reader makes of the extensions: `MAP_ALL` and empty inputs / outputs on the four default-mapped elements, the explicit
mapping and the `_activiti_dmn_table_` constant of the decision task, no mapping on the expression tasks. Every flow node and sequence flow is visited (no exemptions).

Engine facts used: `MAP_ALL` on a user task also copies `sys_task_assignee` and the input-mapped variables into the process ([engine findings](../../docs/engine-findings.md) 1);
a child instance receives mapped inputs only when it has an extensions entry (C11.2), which the modeler writes for every process.

Run: `scripts/verify-models.sh corpus --project C20-loan`
