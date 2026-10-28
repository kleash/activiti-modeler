# ADR 0004: DMN execution through an Activiti connector backed by Operaton DMN

- Status: Accepted
- Date: 2026-10-26

## Context

Activiti 9 OSS has no DMN engine:
- `businessRuleTask` throws an NPE at deployment.
- `serviceTask activiti:type="dmn"` is silently skipped.

The convention from Alfresco Process Automation (APA) is a service task with `implementation="dmn-connector.EXECUTE_TABLE"`. The decision is referenced by the constant `_activiti_dmn_table_` in the extensions JSON. Activiti resolves the bean named after `implementation` and calls it as a `Connector`.

Engines evaluated:
- **Operaton DMN 2.2.0** (Apache-2.0, small, lenient with dmn-js output). It handles DMN 1.3, DRD chaining, UNIQUE, FIRST, ANY, RULE ORDER, and COLLECT with and without aggregators, plus literal expressions. It rejects PRIORITY and OUTPUT ORDER at parse time.
- **KIE DMN 10.2.0.** It handles all of DMN 1.3, including BKMs and boxed expressions, but it is heavy and strict.

## Decision

- **Library module:** `activiti-dmn-connector` (Spring Boot auto-configuration). It registers the bean `dmn-connector.EXECUTE_TABLE`, with a pluggable `DmnEvaluator` SPI.
  - **Default:** Operaton. Pin `org.camunda.feel:feel-engine:1.20.0` for Jackson 2.19 compatibility.
  - **PRIORITY and OUTPUT ORDER:** our own extension. The DMN is parsed with the hit policy rewritten to RULE ORDER. Matched rules are then ordered by the output's `outputValues` priority list: PRIORITY keeps the first, OUTPUT ORDER keeps all, in that order. **This gives all seven hit policies.**
  - **Optional:** `activiti-dmn-connector-kie`, which adds BKMs, boxed contexts, decision services and strict conformance. The verification suite cross-checks every corpus DMN on both engines where both support its constructs.
- **Resolving the decision:** the value of the `_activiti_dmn_table_` constant is resolved against the `.dmn` resources of the **process definition's own deployment**. Results are cached per deployment ID and resource. Resolution tries these in order and fails with a clear error if a step is ambiguous:
  1. The DMN **resource base name**: the file name without directory or `.dmn`. Spring auto-deployment stores absolute paths, so only the last path segment is compared. This is the APA convention, where the value is the model name. It resolves to that file's sink decision, the one no other decision in the file requires.
  2. The `definitions/@name` of a DMN file, resolved to that file's sink decision.
  3. A **decision ID** in any DMN file of the deployment.

  The modeler writes form 3, a decision ID, because it is unambiguous. Forms 1 and 2 are accepted for APA-exported models.
- **Inputs:** the connector's inbound variables, which are the mapped inputs plus constants. `_activiti_*` constants are removed before evaluation.
- **Outputs.** The connector always adds these outbound variables:

  | Outbound variable | When | Value |
  |---|---|---|
  | `<output name>` (one per output column) | single result: UNIQUE, FIRST, ANY, PRIORITY with one hit, COLLECT with an aggregator | the column value, or the aggregate for COLLECT+aggregator. Every output column must have a non-empty `name` (lint L33) |
  | `<decisionId>` | multi-result: COLLECT without aggregator, RULE ORDER, OUTPUT ORDER | a list of row maps in hit-policy order |
  | `_activiti_dmn_matched_` | always | boolean |
  | `_activiti_dmn_matched_rules_` | always | list of rule IDs, in result order |

  **These outputs reach the process only through the task's output mappings** (ADR 0003): either `MAP_ALL_OUTPUTS`, or explicit outputs whose targets are declared in `properties`. On a no-match, output columns are **not emitted**. The engine's VARIABLE output mapping skips null sources, so a mapped variable keeps its previous value. Models that need to react to "no match" map `_activiti_dmn_matched_`.

  The modeler's decision-task wiring offers all four outputs and auto-declares their targets.

  Clarifications, with tests on both engines:
  - **Multi-result no-match:** a multi-result decision with no match emits `<decisionId>` as an **empty list**. Each row is a map even for a single output column, for example `{"badge": "star"}`.
  - **COUNT:** COLLECT COUNT counts **distinct output values**, as DMN 1.3 and KIE do. Operaton counts matched rules, so its result is recomputed. On a no-match COUNT emits `0`; this is the one exception to "columns are not emitted on no-match".
  - **PRIORITY and OUTPUT ORDER ordering:**
    - The priority of a value is its position in the column's `outputValues`, first is highest.
    - Multiple output columns are compared lexicographically in column order, skipping columns without `outputValues`. Ties keep rule order.
    - A value outside `outputValues` is an error.
    - KIE agrees on every corpus case.
  - **Matched rules:** these are the rules that **contributed to the result**:
    - FIRST and ANY: the first match;
    - PRIORITY: the selected rule;
    - OUTPUT ORDER: all matches, in priority order;
    - COLLECT and RULE ORDER: all matches.
  - **DRDs on Operaton** are evaluated bottom-up by our evaluator, so a PRIORITY or OUTPUT ORDER decision feeds its ordered result to the decisions that require it.
  - **Missing input variables** evaluate as FEEL `null`. A mapping typo shows up as a no-match, not an error; lint should flag unmapped decision inputs.
- **SPI:** `DmnEvaluator.evaluate(dmnResource, decisionRef, inputs)` returns a `DmnEvaluation` holding the result rows, the matched rule IDs in order, and per-decision results for DRDs.
  - On Operaton, the matched rules are collected with an evaluation listener (`DmnDecisionTableEvaluationListener`).
  - On KIE, they come from `DMNDecisionTableEvaluatedEvent`.
- **Modeler support:**
  - Edits everything dmn-js supports.
  - Lint flags constructs the selected engine profile cannot execute, for example BKM invocation on Operaton.
  - Emits portable DMN: DMN 1.3 namespace, a `<variable>` on every decision, FEEL type names, `inputData` declared in DRDs, and `-` for "any".
- **No `businessRuleTask`:** the modeler never emits it. The "Decision task" is a service task, drawn with a business-rule icon by a custom renderer.

## Consequences

- DMN works in any Spring Boot app that adds `activiti-dmn-connector`. The decision tester of the dev API (`POST /api/decisions/evaluate`) evaluates through the same connector (`DmnEvaluationService`).
- Hosts must add `**.dmn` to the location suffixes, or deploy DMN programmatically with the BPMN.
