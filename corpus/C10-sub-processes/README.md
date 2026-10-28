# C10 sub-processes

Hand-written seed: embedded sub processes (S1) with local data objects, multi-instance sub processes with `loopDataOutputRef`
aggregation and an early completion condition, an asynchronous non-exclusive sub process and the terminate end event in all its
variants (E9: default, `terminateAll`, `terminateMultiInstance`).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `embeddedSubProcess` | A sub process with its own start and end and a local data object: the sub process variable exists only inside it, the process variable everywhere |
| `miSubProcess` | Parallel multi-instance over a collection: element variable, `outputDataItem` + `loopDataOutputRef` collected in completion order, a completion condition that cancels the open instances; the verdict is copied to a sub process data object by a script task because an output mapping inside a sub process writes process variables |
| `miSequential` | Sequential multi-instance with a loop cardinality and the index variable |
| `asyncSubProcess` | Entering an asynchronous non-exclusive sub process creates a job; the content runs when the job is executed |
| `terminateScopes` | A default terminate end event destroys only its sub process scope; the parent continues |
| `terminateAllScopes` | `terminateAll` ends the whole process instance from inside a sub process |
| `terminateMiDefault` | Inside a multi-instance sub process a default terminate ends only that instance; when all abort the process continues |
| `terminateMiRoot` | `terminateMultiInstance` deletes every instance and the process continues after the sub process |

Each process has its own `scenarios/<name>.scenario.json` and, where it has mappings or property defaults, a
`<name>-extensions.json`. `model-expect.json` asserts loop characteristics, terminate event definitions and the asynchronous
flags. Every flow node and sequence flow is visited (no exemptions).

Engine notes: [engine findings](../../docs/engine-findings.md) 18, 19.

Run: `scripts/verify-models.sh corpus --project C10`
