# C12 misc-flow

Hand-written seed for the small flow elements: link events (E15/E16/E19), the receive task (T11), the manual task (T12), the
abstract task (T13) and the implicit parallel split of conditional flows without a gateway (F3).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `linkEvents` | Two paths leave through link throw events and re-enter at the one link catch event with the same target; there is no sequence flow between a throw and its catch |
| `receiveTask` | A wait state resumed by `RuntimeService.trigger` (the `triggerReceiveTask` step), optionally with variables |
| `implicitSplit` | A manual task and an abstract task pass straight through; the abstract task leaves through conditional flows: every true condition is taken (parallel split), the default flow of the activity only when none is |

`model-expect.json` asserts the link event definitions (name, target, sources), the receive/manual/abstract task types and the
default flow and conditions of the implicit split. Every flow node and sequence flow is visited (no exemptions).

Run: `scripts/verify-models.sh corpus --project C12`
