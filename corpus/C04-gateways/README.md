# C04 gateways

Hand-written seed (the oracle for the modeler-generated version of the same project): the matrix rows G1-G4 and F1-F2 - every
branch of the exclusive, parallel and inclusive gateways, default flows, the inclusive join and the event-based gateway
(timer against message).

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `exclusiveRouting` | First matching flow in document order, the boundaries 100 / 999 / 1000, the default flow, a `take` execution listener, a `skipExpression` that is ignored without the enabling variable | `exclusive-routing` |
| `exclusiveSkip` | `skipExpression` on a flow with `_ACTIVITI_SKIP_EXPRESSION_ENABLED` declared as a property default (not possible as a start variable) | `exclusive-skip` |
| `exclusiveStrict` | No default flow and no matching condition: the completion fails and rolls back, then can be repeated | `exclusive-strict` |
| `parallelForkJoin` | Three branches, the join waits for all of them in any completion order | `parallel-fork-join` |
| `inclusiveRouting` | Every branch whose condition is true runs, the join waits only for the started branches, the default flow when none is | `inclusive-routing` |
| `eventBased` | Timer against message under a fixed clock, payload mapping, a message with the wrong correlation key | `event-based` |

`model-expect.json` asserts what a run cannot show: default flows, flow names and conditions, `skipExpression` text, execution
listeners on flows, gateway incoming and outgoing flows. Every flow node and sequence flow is visited (no exemptions).

Element ids are readable and stable (`f_<source>_<target>` for flows); the generated project must keep them.
Engine notes: [engine findings](../../docs/engine-findings.md) 6, 20, 23.

Run: `scripts/verify-models.sh corpus --project C04`
