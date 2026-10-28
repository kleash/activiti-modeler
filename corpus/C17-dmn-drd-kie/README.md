# C17-kie: DMN business knowledge model and boxed context (KIE only)

KIE-only variant of the corpus row **C17** ([feature matrix](../../docs/FEATURE_MATRIX.md) DM6). It needs the KIE engine, `activiti.dmn.engine=kie` with the module `activiti-dmn-connector-kie`. On Operaton the decision task fails with a clear error and no process instance is left behind. The harness must therefore run this project only on the KIE profile.

Hand written; the modeler's generated version must keep the element IDs and pass the same scenarios.

## Layout

```
seed/processes/
  pricing.dmn                       DMN 1.3 with DMNDI
  pricing.bpmn20.xml                + -extensions.json: one decision task, constant `finalPrice`
scenarios/
  pricing.scenario.json             3 process scenarios + 4 direct decision evaluations
```

## The model

- Input data `basePrice` and `loyaltyYears`.
- Business knowledge model `discountRate(years)`: `if years >= 5 then 0.1 else if years >= 2 then 0.05 else 0`.
- Decision `finalPrice`, a **boxed context**: the entry `rate` **invokes** the BKM with `years = loyaltyYears`; the result entry is `basePrice * (1 - rate)`.

| basePrice | loyaltyYears | finalPrice |
|---|---|---|
| 200 | 5 | 180 |
| 200 | 2 | 190 |
| 200 | 0 | 200 |
| 1000 | 10 | 900 (decision only, referenced by the file base name `pricing`) |

A decision that is not a decision table reports no matched rules (`matchedRules: []`) and `matched` is true when it produced a value.

## How it is verified

| What | Where |
|---|---|
| Deploys on embedded Activiti 9.0.0 with `activiti.dmn.engine=kie`; scenarios and decisions pass | `java/activiti-dmn-connector-kie`, `KieC17KieEndToEndTest` |
| KIE evaluates the BKM invocation for several inputs | `KieDmnEvaluatorTest` |
| Operaton rejects the project with `... requires a business knowledge model ... Set activiti.dmn.engine=kie` and leaves no instance | `java/activiti-dmn-connector`, `KieOnlyProjectOnOperatonEndToEndTest` |
| `DmnCrossCheck` reports "operaton failed" as a difference for this file | `DmnCrossCheckTest` |
