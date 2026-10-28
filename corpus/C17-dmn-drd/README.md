# C17: DMN decision requirements diagram (DRD)

Seed project for the corpus row **C17** of the [feature matrix](../../docs/FEATURE_MATRIX.md) (DM1, DM4, DM5, DM8): required decisions, a literal expression decision, `inputData`, evaluated through decision tasks. The KIE-only variant is [`../C17-dmn-drd-kie`](../C17-dmn-drd-kie/README.md).

Hand written; the modeler's generated versions must keep the element IDs and pass the same scenarios (ADR 0005).

## Layout

```
seed/processes/
  loan-decision.dmn                                  the DRD (DMN 1.3, DMNDI)
  loanApplication.bpmn20.xml                         + -extensions.json: decision referenced by decision id
  loanApplicationByFile.bpmn20.xml                   + -extensions.json: by DMN file base name
  loanApplicationByModelName.bpmn20.xml              + -extensions.json: by DMN model name (definitions/@name)
scenarios/
  loanApplication.scenario.json                      5 process scenarios + 15 direct decision evaluations
  loanApplicationByFile.scenario.json                the same 5 process scenarios
  loanApplicationByModelName.scenario.json           the same 5 process scenarios
```

## The DRD

```
 age, country ──> riskClass (PRIORITY: HIGH > MEDIUM > LOW) ──┐
                                                              ├──> loanOffer (UNIQUE, sink) ──> offer
 income ────────> maxLoan (literal expression: income * 4) ───┤
 amount ──────────────────────────────────────────────────────┘
```

| Decision | Kind | Rules (ids are `<decision>_<rule>`) |
|---|---|---|
| `riskClass` | PRIORITY, outputs `"HIGH","MEDIUM","LOW"` | `highYoung`: age < 21 gives HIGH. `mediumAbroad`: country not DE/AT/CH gives MEDIUM. `lowDefault`: anything gives LOW |
| `maxLoan` | literal expression | `income * 4`, no rules |
| `loanOffer` | UNIQUE | `approve`: LOW or MEDIUM and amount <= maxLoan gives APPROVE. `review`: HIGH and within limit gives REVIEW. `declineLimit`: amount > maxLoan gives DECLINE |

The sink decision of `loan-decision.dmn` is `loanOffer`. The file base name is `loan-decision`, the model name (`definitions/@name`) is `Loan decision`. They differ on purpose so the three reference forms of ADR 0004 are distinct:

| Process | `_activiti_dmn_table_` | Resolution step |
|---|---|---|
| `loanApplication` | `loanOffer` | 3: decision id (what the modeler writes) |
| `loanApplicationByFile` | `loan-decision` | 1: resource base name |
| `loanApplicationByModelName` | `Loan decision` | 2: `definitions/@name` |

`riskClass` is a PRIORITY decision that feeds a downstream table. The result of the **ordered** decision must reach `loanOffer`: case 3 (age 19 in DE) matches two `riskClass` rules, `highYoung` and `lowDefault`, and `loanOffer` must see `HIGH`. Case 5 matches all three.

## Scenarios

Five cases per process, covering every branch of the `routeOffer` gateway (approved, manual review, declined): low risk, medium risk, young applicant (PRIORITY), amount above the limit, and a young foreign applicant above the limit. Each asserts `offer`, `matched`, `matchedRules` (of the sink decision `loanOffer`), the end event, the path and the sequence flows.

`loanApplication.scenario.json` adds `decisions[]`: for every case `loanOffer` (referenced alternately by id, file base name and model name), and the required decisions `riskClass` and `maxLoan` evaluated on their own with their matched rules.

## How it is verified

| What | Where |
|---|---|
| Deploys on embedded Activiti 9.0.0 (Boot 3.5.7 and 3.5.16); all scenarios and decisions pass on Operaton; the evaluation reports every required decision of the DRD | `java/activiti-dmn-connector`, `CorpusC17EndToEndTest` |
| The same on KIE | `java/activiti-dmn-connector-kie`, `KieC17EndToEndTest` |
| Operaton and KIE agree on every `decisions[]` entry | `DmnCrossCheckTest` |
