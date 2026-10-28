# C22-camunda-import: a Camunda 7 model, imported by the modeler, run on Activiti 9

Proof for feature **U17** (Camunda 7 to Activiti importer): the engine runs what the importer writes, beyond the modeler's own export checks.

The chain, all of it checked:

1. `camunda/*.bpmn` are Camunda 7 models (Camunda Modeler, `camunda:` attributes): a business rule task with `decisionRef`, `resultVariable`
   and `mapDecisionResult`; an asynchronous service task with a delegate class and a retry cycle; an expression service task; a user task
   with candidate groups, due date, priority, form key, a task listener and input/output parameters; a user task with a form data block; a call
   activity with `camunda:in` / `camunda:out` and `inheritBusinessKey`; a process with candidate starter groups.
2. `build.ts` opens each file in the modeler through the test API `importCamunda` (detect the vendor, convert, load the result), exports the
   project (the save normalization) and fails if the conversion left a `camunda:` or `zeebe:` name or a lint finding behind.
3. `seed/processes/*` are the converted files **as they were reviewed by hand**: `activiti:` attributes, the input/output parameters turned into
   the extensions JSON (ADR 0003 / 0006), the business rule task turned into a service task on the DMN connector with the decision id in the
   `_activiti_dmn_table_` constant, the decision (`order-risk.dmn`) written the way the DMN editor writes it. The build's semantic comparison
   (`corpus.spec.ts`) fails on any difference between the hand-reviewed seed and what the pipeline wrote.
4. The harness deploys the seed and the generated project and runs `scenarios/` against both.

| File | What it is |
|---|---|
| `seed/processes/order-fulfilment.bpmn20.xml` + `-extensions.json` | Process `fulfilOrder`: greeting, async discount, decision task, gateway, manager review, call activity, dispatch confirmation |
| `seed/processes/shipping-label.bpmn20.xml` + `-extensions.json` | Process `shippingLabel`, the called process |
| `seed/processes/order-risk.dmn` | Decision `orderRisk` (hit policy UNIQUE, output `riskClass`) |
| `scenarios/fulfil-order.scenario.json` | A small order (no review), a large order (reviewed and granted), a refused discount |
| `scenarios/order-risk.scenario.json` | The decision table evaluated directly, boundaries included |
| `model-expect.json` | The engine reader's view of the converted model: attributes, listeners, form properties, call activity parameters, mappings, constants |

Notes from the review of the conversion:

- A Camunda input parameter with a plain text value (`20`) becomes a `VALUE` mapping; the engine delivers it as the **string** `"20"`.
- `approved` is written by an output parameter whose source type the importer cannot know; it is declared as `json` and the loss report asks the
  user to check it. The engine accepts the boolean `true` / `false` that the task completion delivers.
- The task listener expression is `${listenerRecorder.recordTask(task)}`: a bean method named `notify` cannot be called from JUEL (the engine
  resolves it to `Object.notify`, a native method), see `docs/engine-findings.md`.

Run: `scripts/verify-models.sh corpus --project C22-camunda-import`
