# C18 collaboration

Hand-written seed for pools, lanes, message flows, annotations, data references and a coloured diagram (feature matrix D2, P3, A1, X1).
The engine deploys every pool that has a `processRef` as its own process and ignores everything else of the collaboration; this project
shows that the files are accepted, that the processes run on their own and that nothing travels along a message flow.

| File (`seed/processes/`) | What it shows |
|---|---|
| `collaboration.bpmn20.xml` | Two executable pools in one file (`customerOrder` with two lanes, `supplierFulfilment` without lanes) and a black-box pool `Carrier` (no process). Three message flows (event to event with `messageRef`, event to event, task to pool). A definitions-level `dataStore`, a `dataStoreReference` and a `dataObjectReference` linked to the customer's first task by `dataOutputAssociation` / `dataInputAssociation`, a data object that becomes the variable `orderNote`, a text annotation with an association. The message throw events use `${recordingThrowMessageDelegate}`; the confirmation is correlated by `${orderId}` |
| `annotations.bpmn20.xml` | A process without pools (`annotatedRequest`) whose user task has a text annotation connected by an association: the editor keeps both in the process, where the engine reads them |
| `coloured.bpmn20.xml` | One pool with a lane and an exclusive gateway, coloured the way the bpmn-js colour picker does: `bioc:stroke` / `bioc:fill` and `color:border-color` / `color:background-color` on the pool, the lane, the shapes and the annotation, `bioc:stroke` / `color:border-color` on the edges |

Scenarios (`scenarios/`): the customer pool end to end (throw recorded, confirmation correlated, wrong order id rejected), the supplier
pool started by its message start event, both branches of the coloured process and the annotated process. Every flow node and sequence flow is visited, no
exemptions (the pools, lanes, annotations, data references and message flows are not flow nodes of a process).

`model-expect.json` asserts what the scenarios cannot see: the lanes and their flow references, the text annotations and associations of the three processes that have one,
the data object, the data store reference (and that the engine does not read its `dataStoreRef`), the message references and the
correlation key.

The build leaves the text annotations where bpmn-js puts them: in the collaboration for the two pools (the export writes an annotation that lies
inside a pool, with its association, into the process of the pool, engine finding C18.7) and in the process for `annotatedRequest`.

Engine findings: C18.1 to C18.7 in `docs/engine-findings.md` (artifacts after flow elements, the data reference diagram warnings, the
unread `dataStoreRef`, pools and message flows, colour attributes, the delegate on a message definition, the annotations of a collaboration).

Run: `scripts/verify-models.sh corpus --project C18`
