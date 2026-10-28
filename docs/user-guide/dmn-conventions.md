# Portable DMN conventions

The modeler writes, and the corpus uses, DMN that evaluates **identically on both engines**: Operaton (the default) and KIE (optional). The rules below are what the strict engine, KIE, requires. Operaton accepts them too. Each rule shows what happens when it is broken, taken from the tests in `java/activiti-dmn-connector-kie`.

See [ADR 0004](../adr/0004-dmn-execution.md) for the decision behind the engines, and the [integration guide](../integration-guide.md#dmn) for how a host app adds the connector.

## The rules

| # | Rule | If broken |
|---|---|---|
| 1 | **DMN 1.3 namespace**: `https://www.omg.org/spec/DMN/20191111/MODEL/` | DMN 1.1 and 1.2 documents load on both engines, but dmn-js 18 and KIE are written against 1.3. Migrate older files with `@bpmn-io/dmn-migrate`. |
| 2 | **Declare every input as `inputData`** and connect it to the decisions that read it with `informationRequirement/requiredInput`. | KIE refuses the model: `Error compiling FEEL expression 'score' on decision table 'uniqueGrade', input clause #1: Unknown variable 'score'`. Operaton silently accepts it. |
| 3 | **Every decision has a `<variable>` whose `name` equals the decision's `name`.** | KIE: downstream references fail with `Unknown variable name 'Risk'` when the variable is `risk` and the decision `Risk`. |
| 4 | **Use FEEL type names** in `typeRef`: `string`, `number`, `boolean`, `date`, `time`, `date and time`. Never `integer`, `long` or `double`. | KIE: `type reference 'integer' does not exists`. |
| 5 | **Write `-` for "any"** in an input entry, never an empty entry. | KIE: `Missing test on decision table input entry`. |
| 6 | **Name every output column.** | The connector fails the decision with `output column '...' has no name` (modeler lint L33). |
| 7 | **In a DRD, name the output column of a single-output decision table exactly like the decision's variable.** For example decision `riskClass` with output `riskClass`. | Operaton hands a required decision's result to its dependents under the **output column name**; KIE hands it over under the **decision variable name**. They only agree when both are the same. Multi-output required decisions are not portable (Operaton exposes each column, KIE one context). |
| 8 | **`outputValues` of PRIORITY and OUTPUT ORDER tables are a comma separated list of literals**: `"high","mid","low"`, numbers or booleans. | The connector fails with `must be a comma separated list of string, number or boolean literals`. |
| 9 | **Give every rule a stable `id`.** dmn-js does. Matched rules are reported by id. | A rule without an id is reported as `<decisionId>_rule<n>` (n counts from 1). |
| 10 | **Include DMNDI** (`dmndi:DMNDI`) so dmn-js can open the file. Engines ignore it. | dmn-js shows an empty canvas. |
| 11 | **Put the `.dmn` file directly in the `processes/` folder next to the BPMN.** | Spring's `**.dmn` location pattern does not descend into sub folders (neither does `**.bpmn20.xml`). A file in `processes/sub/` is not deployed. |

## What only KIE can run

On Operaton the connector fails with a clear error naming the decision, for example `Decision 'finalPrice' in pricing.dmn requires a business knowledge model ... Set activiti.dmn.engine=kie`. Never a wrong answer.

- business knowledge models (BKM) and their invocation;
- boxed expressions other than decision table and literal expression: context, invocation, list, relation, function definition, conditional, for/some/every/filter;
- decision services.

The corpus project `corpus/C17-dmn-drd-kie` is the KIE-only example. Modeler lint L29 flags these constructs when the Operaton profile is selected.

## Hit policies

Both engines give the same answer for all seven hit policies and the four COLLECT aggregators. This is checked by one shared test class (`AbstractEvaluatorContractTest`, 47 cases) that runs against each engine, and by `DmnCrossCheck` on every corpus decision.

| Hit policy | Result | Matched rules (`_activiti_dmn_matched_rules_`) |
|---|---|---|
| UNIQUE | one row; two matching rules are an error | the matched rule |
| FIRST | the first matching rule in rule order | that rule |
| ANY | one row; matching rules with different outputs are an error | the first matching rule |
| PRIORITY | the rule with the highest output priority | that rule (ties: first in rule order) |
| RULE ORDER | all matches in rule order | all, in rule order |
| OUTPUT ORDER | all matches by output priority | all, in priority order (ties keep rule order) |
| COLLECT | all matches in rule order | all, in rule order |
| COLLECT SUM / MIN / MAX | one row with the aggregate; no match: no row | all matched rules |
| COLLECT COUNT | one row; no match: `0` | all matched rules |

The matched rules are "the rules behind the result rows, in result order".

### Output priority (PRIORITY, OUTPUT ORDER)

Operaton rejects both policies at parse time, so the connector adds them (class `PriorityOrdering`). The semantics are the ones DMN 1.3 defines and that KIE implements natively; the cross-check proves both agree:

- The priority of an output value is its position in the output column's `outputValues` list, first is highest.
- With several output columns the order is **lexicographic in column order**: compare the first column's priority, break ties with the second column, and so on. A column without `outputValues` does not take part. At least one column needs `outputValues`.
- Rules that are still tied keep rule order.
- A value that is not in `outputValues` is an error. An empty output entry (`null`) has the lowest priority.
- PRIORITY returns the first rule of that order, OUTPUT ORDER all of them.

A PRIORITY or OUTPUT ORDER decision that feeds a downstream decision hands over its **ordered** result. The Operaton evaluator therefore evaluates the decisions of a DRD one by one, bottom-up, instead of letting Operaton resolve the requirements.

### COUNT and SUM

DMN 1.3 defines `C#` (COUNT) as the number of **distinct** output values. KIE does that. Operaton counts matched rules. The connector recomputes Operaton's COUNT as the distinct count so both engines agree: two rules that both output `1` count as `1`. SUM adds all matched outputs on both engines, duplicates included (`5` and `5` sum to `10`).

## Inputs and null

A decision input that is missing from the connector's inputs is `null` in FEEL. Comparisons with `null` do not match, so a typo in an input mapping shows up as "no rule matched", not as an error. When a decision unexpectedly does not match, check the input mapping of the decision task and `_activiti_dmn_matched_rules_`.

Numbers: FEEL has one number type. Results are normalised to `Long` when integral, else `Double`, on both engines.

## Checklist for a new DMN file

1. `definitions` has the 1.3 namespace, an `id` and a `name`; `namespace` is set.
2. One `inputData` per input, each with a `variable` and a FEEL `typeRef`.
3. Each decision has `id`, `name` and `variable` (same name); `informationRequirement` points to its inputs and required decisions.
4. Input entries use `-` for any; output columns are named; PRIORITY / OUTPUT ORDER have literal `outputValues`.
5. Rules have ids; the file has DMNDI shapes.
6. File lives in `processes/`. Check it with `DmnCrossCheck` when KIE is available.
