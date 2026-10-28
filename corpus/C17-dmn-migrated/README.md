# C17-dmn-migrated: DMN 1.1 and 1.2 files, migrated by the modeler, evaluated on the engine

Proof for feature **DM9** (import of DMN 1.1 / 1.2): the engine evaluates what the modeler's migration produces. The modeler opens a legacy file with
`@bpmn-io/dmn-migrate` and writes it with the portable-DMN normalizer (`modeler/packages/activiti-project/src/dmn/`); this project runs the result on Activiti.

The chain, all of it checked:

1. `corpus/N01-negative/models/legacy-discount.dmn` is a DMN 1.1 file with Camunda's namespace, an output column without a name and the type `integer`.
2. `build.ts` opens it in the modeler the way the DMN editor opens a tab (test API `openDmn`: migrate, import into dmn-js) and exports the project (the save normalization). It fails if the file
   was not migrated from 1.1, or if the import warns.
3. `seed/processes/legacy-discount.dmn` is the migrated file **as it was reviewed by hand**: DMN 1.3 namespace, the Camunda target namespace replaced, `inputData` `customer` declared and
   required by the decision, the output column named `Discount` (a single output is named after its decision) with the FEEL type `number`, the rule ids kept. The build's semantic
   comparison (`corpus.spec.ts`) fails on any difference between that hand-reviewed file and what the pipeline wrote.
4. The harness deploys the seed and the generated project and evaluates the table: `legacy-discount.scenario.json` (`decisions[]`, by decision id and by file name; the DMN cross-check replays each
   evaluation on KIE) and `discount-order.scenario.json` (a process with a decision task wired to the decision by the picker, an exclusive gateway on `_activiti_dmn_matched_`).

The same chain runs for a **DMN 1.2** file, `legacy/shipping-fee.dmn`, written the way Camunda Modeler 4 writes one (the DMN 1.2 namespaces, Camunda's
namespace and its attribute `camunda:inputVariable`, the type `double`, empty input entries, no input data, a diagram): the build opens it with `openDmn`
(it fails unless the file was migrated from 1.2), the comparison requires the hand-written `seed/processes/shipping-fee.dmn`, and
`shipping-fee.scenario.json` evaluates it (`decisions[]`). The Playwright test "DM9 a DMN 1.2 file opens migrated too" opens and saves the same file in the editor.

| File | What it is |
|---|---|
| `seed/processes/legacy-discount.dmn` | The hand-reviewed migrated file (hit policy FIRST, one rule `rule1`: `customer == "gold"` gives `Discount` 10) |
| `legacy/shipping-fee.dmn` | The DMN 1.2 source (hit policy FIRST: express costs 25, below 2 kg 5, from 2 kg 12.5) |
| `seed/processes/shipping-fee.dmn` | What the migration and the save must make of it: DMN 1.3, the Activiti target namespace, no Camunda attribute, `number` for `double`, `-` in the empty entries, input data `weight` and `express` required by the decision, the decision, column and rule ids kept |
| `seed/processes/discount-order.bpmn20.xml` + `-extensions.json` | Process `discountOrder`: decision task `decideDiscount`, gateway `discountGateway`, two end events |

Notes from the review of the migration: the decision keeps its id `discount` and its name `Discount` (so the variable and the output column are named `Discount`, with a capital); the migration
adds no diagram, so the DRD is laid out by the editor when the file is opened; the decision variable has no type (`Any`).

Run: `scripts/verify-models.sh corpus --project C17-dmn-migrated`
