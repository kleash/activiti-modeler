# C09 transactions

Hand-written seed for the transaction sub process (S3), the cancel end event (E10) and the cancel boundary event (E25), with
compensable work inside the transaction.

| Process (`seed/processes/`) | What it shows |
|---|---|
| `bookingTransaction` | A transaction with two compensable user tasks (compensation boundary event, association, handler with `isForCompensation`), a payment check, a normal end event and a **cancel end event**. The cancel boundary event on the transaction leads to a refund |

| Scenario | Outcome |
|---|---|
| paid | the transaction ends normally, no handler runs |
| payment fails after both reservations | the cancel end event compensates the completed work, handlers run in reverse order of completion (`releaseMeal`, then `releaseSeat`, under a fixed clock advanced between the reservations), the cancel boundary event takes over and the process leaves through the refund |
| payment fails, nothing was reserved | the cancel end event finds no completed compensable work: the engine fails with `No execution found for sub process of boundary cancel event onCancel`, the completion of the user task is rolled back and the task stays open (T-rule: a cancel end event needs completed compensable work) |
| nothing reserved but paid | the transaction ends normally |

The transaction and its cancel boundary event count as active while the transaction runs (`expectActive` lists
`booking` and `onCancel`). The compensation boundary events are exempted from path coverage for the reason given in
`scenarios/coverage-exemptions.json` (engine finding C08.1). `model-expect.json` asserts the `Transaction` type, the cancel event
definitions, the boundary attachments and `forCompensation`.

Run: `scripts/verify-models.sh corpus --project C09`
