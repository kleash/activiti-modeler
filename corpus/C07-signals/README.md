# C07 signals

Hand-written seed: matrix rows **E4** (signal start), **E14** (catch by `signalRef` and `signalExpression`), **E17** (throw, including
`activiti:async`), **E24** (boundary signal, interrupting and not), global against `processInstance` scope (P2), and the traps around
signal expressions.

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `signalStart` | A broadcast signal starts an instance; its variables become process variables unmapped (engine finding 37); another name starts nothing | `signal-start` (2) |
| `signalCatch` | Two catches by `signalRef`: a signal sent too early is lost, variables arrive with the signal | `signal-catch` |
| `signalLocalScope` | A `processInstance` scoped signal: `ProcessRuntime.signal` from outside does not reach it, a throw in the same instance does | `signal-local-scope` |
| `signalParent`, `signalChildGlobal`, `signalChildLocal` | A child instance throws `childDone`: with scope `global` the parent's catch receives it together with the child's variables (the call activity has no mapping), with scope `processInstance` it stays in the child and the parent keeps waiting | `signal-parent` (2) |
| `signalAsync` | `activiti:async` on the throw: the catch is triggered only when the event job runs (`executeJobs`); the job has no process instance, the runner attributes it through the event subscription (engine finding 35) | `signal-async` (2) |
| `signalBoundary` | An interrupting and a non-interrupting boundary signal on one user task; the non-interrupting one is repeatable; signals after completion find no subscription | `signal-boundary` (3) |
| `signalExpressions` | Catch and throw both named by `activiti:signalExpression`; a file that uses it must not declare any `signal` element (engine finding 28) and cannot use `+` for concatenation (finding 36) | `signal-expressions` |
| `signalExpressionLeak` | The catch's subscription survives, so a second broadcast skips the receive task - an engine bug pinned by a scenario (engine finding 29) | `signal-expression-leak` (2) |

Event sub processes with a signal start are not covered: the engine does not implement them (R1 0.1 item 6). A signal end event
does not throw (R1 0.1 item 7).

`model-expect.json` asserts the signal event definitions (`signalRef` is the signal's id in the deployed model, `signalExpression`, `async`) and
`cancelActivity`. Every flow node and sequence flow is visited (no exemptions).
Engine notes: [engine findings](../../docs/engine-findings.md) 28, 29, 35-37.

Run: `scripts/verify-models.sh corpus --project C07`
