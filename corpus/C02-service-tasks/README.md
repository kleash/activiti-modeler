# C02 service-tasks

Hand-written seed for the service task kinds T2-T5 and the asynchronous flag: `activiti:class` with fields, `activiti:expression`
with a result variable, `activiti:delegateExpression` and connectors with every variable mapping kind. The beans behind the
names are the corpus support library ([docs/corpus-support.md](../../docs/corpus-support.md)).

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `classDelegates` | `activiti:class` with fields given as a nested string, a `stringValue` attribute, a nested expression and an `expression` attribute | `class-delegates` |
| `expressions` | `activiti:expression` with `resultVariableName` (arithmetic, a bean method), without one (side effect only); a missing variable rejects the start | `expressions` |
| `delegateExpressions` | `activiti:delegateExpression` with a bean, and a bean configured differently by two tasks through fields | `delegate-expressions` |
| `connectorMappings` | `crm.LOOKUP`, `echo.EXECUTE`, `flags.EXECUTE` with `VARIABLE` / `VALUE` inputs (a value may contain expressions), constants, `VARIABLE` outputs, `MAP_ALL`, a `JSONPATCH` output (nested objects, array, path variable) and `ephemeral`; the inbound variables of every call are asserted with `expectConnectorCall` | `connector-mappings` |
| `asyncServiceTasks` | An async class delegate with `exclusive=false`, an async connector and an async expression: nothing runs before the jobs are executed | `async-service-tasks` |

`seed/connectors/` holds the connector descriptors (`crm.json`, `echo.json`, `flags.json`). `model-expect.json` asserts the
implementation type, fields, result variables, `async` and `exclusive` (the part a run cannot show). Every flow node and sequence
flow is visited (no exemptions).

Engine notes: [engine findings](../../docs/engine-findings.md) 4, 15-17.

Run: `scripts/verify-models.sh corpus --project C02`
