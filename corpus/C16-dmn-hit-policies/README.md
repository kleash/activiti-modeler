# C16: DMN hit policies

Seed project for the corpus row **C16** of the [feature matrix](../../docs/FEATURE_MATRIX.md) (DM2, DM3, DM8, DM11, T6): one decision table per hit policy and aggregator, decision tasks in processes, a no-match path.

The files are written by hand. The version the modeler generates (`build.ts`) must produce the same element IDs and pass the same scenarios. The scenarios are the oracle and are never generated from the modeler's output (ADR 0005).

## Layout

```
seed/processes/                  deploy this folder as one deployment (ADR 0003)
  *.dmn                          13 decision tables, DMN 1.3, portable conventions
  hitPolicies.bpmn20.xml         + -extensions.json: 12 decision tasks in a row
  noMatchRouting.bpmn20.xml      + -extensions.json: reacts to "no match" with _activiti_dmn_matched_
  mapAllOutputs.bpmn20.xml       + -extensions.json: mappingType MAP_ALL_OUTPUTS
scenarios/
  hit-policies.scenario.json     3 process scenarios + 35 direct decision evaluations (decisions[])
  no-match-routing.scenario.json 4 process scenarios + 3 decisions
  map-all-outputs.scenario.json  2 process scenarios
```

Engine settings the project needs (ADR 0005): `history-level=full`, `db-history-used=true`, `deployment-mode=default`, location suffixes `**.bpmn20.xml,**.bpmn,**.dmn`. The DMN files must stay directly in `processes/`.

## The tables

| File | Decision id | Hit policy | Input | Output | What it shows |
|---|---|---|---|---|---|
| `unique-grade.dmn` | `uniqueGrade` | UNIQUE | `score` | `grade` | one match; half open range `[50..80)` |
| `first-tier.dmn` | `firstTier` | FIRST | `score` | `tier` | overlapping rules, first wins; catch-all rule with `-` |
| `any-region.dmn` | `anyRegion` | ANY | `country` | `region` | two rules for `DE` agree; no match for `FR` |
| `priority-risk.dmn` | `priorityRisk` | PRIORITY | `amount` | `risk` (`"high","medium","low"`) | highest priority wins, not the first rule |
| `priority-two-outputs.dmn` | `priorityTwoOutputs` | PRIORITY | `amount` | `risk`, `action` | two output columns: lexicographic order, the second column breaks ties |
| `rule-order-badges.dmn` | `ruleOrderBadges` | RULE ORDER | `score` | `badge` | all matches in rule order |
| `output-order-badges.dmn` | `outputOrderBadges` | OUTPUT ORDER | `score` | `badge` (`"star","achiever","participant"`) | all matches by priority, not rule order |
| `collect-flags.dmn` | `collectFlags` | COLLECT | `amount` | `flag` | list; empty list when nothing matches |
| `collect-sum-points.dmn` | `collectSumPoints` | COLLECT SUM | `amount` | `points` | aggregate; no row when nothing matches |
| `collect-min-price.dmn` | `collectMinPrice` | COLLECT MIN | `amount` | `unitPrice` | same |
| `collect-max-penalty.dmn` | `collectMaxPenalty` | COLLECT MAX | `delay` | `penalty` | same |
| `collect-count-alerts.dmn` | `collectCountAlerts` | COLLECT COUNT | `amount` | `alerts` | number of distinct outputs; `0` when nothing matches |
| `routing.dmn` | `routeByAmount` | UNIQUE | `amount` | `route` | gaps in the table, used by `noMatchRouting` |

Rule IDs are `<decisionId>_<ruleName>` and are what `matchedRules` asserts.

## What the scenarios assert

- **`hitPolicies`**: three runs (large values: every table matches; small values: first rules only; nothing matches where a table can miss). Variables per table, the matched rule ids of every task, the whole path with order and sequence flows. Multi-result decisions are lists of row maps (`[{"badge": "star"}, ...]`); aggregates and single results are plain values.
- **`noMatchRouting`**: the four documented behaviours. Both gateway branches are covered. With no match the output column `route` is **not emitted** (`absentVariables`), `matched` is `false`, and a mapped variable that already had a value **keeps it** (`route: "previous"`).
- **`mapAllOutputs`**: with `MAP_ALL_OUTPUTS` the outputs `alerts`, `_activiti_dmn_matched_` and `_activiti_dmn_matched_rules_` become process variables as they are.
- **`decisions[]`**: direct evaluations of every table with at least two input values per table, including the no-match case, with `result` (rows) and `matchedRules`. The decision reference is a decision id, or a resource base name where noted (`unique-grade`, `routing`).

## How it is verified

| What | Where |
|---|---|
| The seed deploys on embedded Activiti 9.0.0 (Spring Boot 3.5.7 and 3.5.16) with absolute resource names, and every scenario and decision above passes on Operaton | `java/activiti-dmn-connector`, `CorpusC16EndToEndTest` |
| The same on KIE (`activiti.dmn.engine=kie`) | `java/activiti-dmn-connector-kie`, `KieC16EndToEndTest` |
| Every `decisions[]` entry gives the oracle's rows and matched rules on both engines | `DmnCrossCheckTest` |

Until `activiti-scenario-runner` and the harness take over, `CorpusC16EndToEndTest` runs the scenario files with a small interpreter (`ScenarioFileRunner`, test sources of `activiti-dmn-connector`). It fails on any scenario key it does not interpret, so the files cannot use features nobody checks.
