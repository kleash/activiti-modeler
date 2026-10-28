# C11 call-activities

Hand-written seed for the call activity (T14) and the multi-instance call activity (T16): `activiti:in` / `activiti:out`,
`inheritVariables`, business keys, the extensions-JSON mapping, `calledElement` as an expression and multi-instance. Every
called process is part of the project and is asserted with `expectChildInstance` (start variables, final variables, state, path).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `callInOut` + `priceCalculator` | `activiti:in` with `source` (renaming) and `sourceExpression`, `activiti:out` with `source` and `sourceExpression` (evaluated on the child). Nothing else crosses the boundary; the child is observed while it is running (`ACTIVE`) and after it ended |
| `callInherit` + `auditChild` | `inheritVariables`: the child starts with a copy of every variable; its changes and additions stay in the child |
| `callBusinessKey` + `leafChild` | `activiti:businessKey` expression, `inheritBusinessKey`, and neither (no business key) |
| `callMappings` + `riskCheck`, `echoChild`, `leafChild` | The Activiti 7+ extensions mapping of a call activity: `VARIABLE` and `VALUE` inputs, a constant, mapped outputs only, the child's own properties (default, required) and `MAP_ALL` both ways; a child **without** an extensions file receives no mapped inputs |
| `callExpression` + `variantA`, `variantB` | `calledElement="${childKey}"` resolved at run time; an unknown key fails the call |
| `callMultiInstance` + `itemChild`, `positionChild` | A parallel multi-instance call activity (collection, element variable) and a sequential one (cardinality, element index variable passed with `activiti:in sourceExpression`); one child per instance, observed with `expectChildInstance` `call: n` |

Engine behaviour asserted here is listed in `docs/engine-findings.md`, section "C11 call activities" (a multi-instance call
activity returns nothing from its children; mapped inputs reach only children that have an extensions file).

`model-expect.json` asserts `calledElement`, `inParameters`, `outParameters`, `inheritVariables`, `inheritBusinessKey`,
`businessKey` and the loop characteristics. Every flow node and sequence flow is visited (no exemptions).

Run: `scripts/verify-models.sh corpus --project C11`
