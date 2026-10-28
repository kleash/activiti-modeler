package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** The outbound variables of a decision task (ADR 0004 output contract). */
class DmnOutputContractTest {

    private static DecisionEvaluation table(String id, DmnHitPolicy policy, DmnAggregation aggregation, boolean multi,
                                            List<Map<String, Object>> rows, List<String> rules) {
        return new DecisionEvaluation(id, id, DmnModel.Kind.DECISION_TABLE, policy, aggregation, multi, id, rows, rules);
    }

    private static DmnEvaluation of(DecisionEvaluation decision) {
        return new DmnEvaluation(decision, List.of(decision));
    }

    @Test
    void singleResultEmitsOneVariablePerOutputColumn() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("grade", "A");
        row.put("limit", 500L);
        DmnEvaluation evaluation = of(table("d", DmnHitPolicy.UNIQUE, DmnAggregation.NONE, false, List.of(row), List.of("r1")));

        Map<String, Object> out = DmnOutputContract.outboundVariables(evaluation);

        assertThat(out).containsEntry("grade", "A").containsEntry("limit", 500L)
            .containsEntry("_activiti_dmn_matched_", true).containsEntry("_activiti_dmn_matched_rules_", List.of("r1"))
            .doesNotContainKey("d");
    }

    @Test
    void multiResultEmitsAListOfRowMapsUnderTheDecisionId() {
        DmnEvaluation evaluation = of(table("badges", DmnHitPolicy.RULE_ORDER, DmnAggregation.NONE, true,
            List.of(Map.of("badge", "x"), Map.of("badge", "y")), List.of("r1", "r2")));

        Map<String, Object> out = DmnOutputContract.outboundVariables(evaluation);

        assertThat(out).containsEntry("badges", List.of(Map.of("badge", "x"), Map.of("badge", "y")))
            .doesNotContainKey("badge").containsEntry("_activiti_dmn_matched_rules_", List.of("r1", "r2"));
    }

    @Test
    void multiResultWithoutMatchStillEmitsAnEmptyList() {
        DmnEvaluation evaluation = of(table("flags", DmnHitPolicy.COLLECT, DmnAggregation.NONE, true, List.of(), List.of()));

        Map<String, Object> out = DmnOutputContract.outboundVariables(evaluation);

        assertThat(out).containsEntry("flags", List.of()).containsEntry("_activiti_dmn_matched_", false)
            .containsEntry("_activiti_dmn_matched_rules_", List.of());
    }

    @Test
    void noMatchEmitsNoOutputColumnsButTheMatchedFlags() {
        DmnEvaluation evaluation = of(table("d", DmnHitPolicy.UNIQUE, DmnAggregation.NONE, false, List.of(), List.of()));

        assertThat(DmnOutputContract.outboundVariables(evaluation)).containsOnlyKeys("_activiti_dmn_matched_", "_activiti_dmn_matched_rules_")
            .containsEntry("_activiti_dmn_matched_", false);
    }

    @Test
    void nullColumnValuesAreNotEmitted() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("a", "x");
        row.put("b", null);
        DmnEvaluation evaluation = of(table("d", DmnHitPolicy.FIRST, DmnAggregation.NONE, false, List.of(row), List.of("r")));

        assertThat(DmnOutputContract.outboundVariables(evaluation)).containsKey("a").doesNotContainKey("b");
    }

    @Test
    void aggregateIsEmittedUnderTheOutputName() {
        DmnEvaluation evaluation = of(table("d", DmnHitPolicy.COLLECT, DmnAggregation.SUM, false, List.of(Map.of("total", 111L)), List.of("a", "b")));

        assertThat(DmnOutputContract.outboundVariables(evaluation)).containsEntry("total", 111L).doesNotContainKey("d");
    }

    @Test
    void literalExpressionIsEmittedUnderItsVariableName() {
        DecisionEvaluation literal = new DecisionEvaluation("maxLoan", "maxLoan", DmnModel.Kind.LITERAL_EXPRESSION, null, DmnAggregation.NONE,
            false, "maxLoan", List.of(Map.of("maxLoan", 20000L)), List.of());

        Map<String, Object> out = DmnOutputContract.outboundVariables(of(literal));

        assertThat(out).containsEntry("maxLoan", 20000L).containsEntry("_activiti_dmn_matched_", true)
            .containsEntry("_activiti_dmn_matched_rules_", List.of());
    }

    @Test
    void outboundCollectionsAreMutableAndSerializableCopies() {
        DmnEvaluation evaluation = of(table("d", DmnHitPolicy.RULE_ORDER, DmnAggregation.NONE, true, List.of(Map.of("a", 1L)), List.of("r")));

        Map<String, Object> out = DmnOutputContract.outboundVariables(evaluation);

        assertThat(out.get("d")).isInstanceOf(ArrayList.class);
        assertThat(((List<?>) out.get("d")).get(0)).isInstanceOf(LinkedHashMap.class);
        assertThat(out.get("_activiti_dmn_matched_rules_")).isInstanceOf(ArrayList.class);
    }

    @Test
    void reservedConstantsAreStrippedFromTheInputs() {
        Map<String, Object> inbound = new LinkedHashMap<>();
        inbound.put("_activiti_dmn_table_", "risk");
        inbound.put("_activiti_other_", 1);
        inbound.put("amount", 10);
        inbound.put("activiti_not_reserved", 2);

        assertThat(DmnOutputContract.decisionInputs(inbound)).containsOnlyKeys("amount", "activiti_not_reserved");
    }
}
