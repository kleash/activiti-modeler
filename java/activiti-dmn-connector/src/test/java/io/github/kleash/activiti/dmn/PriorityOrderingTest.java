package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class PriorityOrderingTest {

    private static DmnModel.DecisionInfo decision(DmnHitPolicy policy, DmnModel.OutputInfo... outputs) {
        return new DmnModel.DecisionInfo("d", "d", "d", List.of(), List.of(), false, DmnModel.Kind.DECISION_TABLE, "decisionTable",
            policy, DmnAggregation.NONE, 1, List.of(outputs), List.of());
    }

    private static DmnModel.OutputInfo output(String name, String values) {
        return new DmnModel.OutputInfo("o_" + name, name, "string", values);
    }

    private static Map<String, Object> row(Object... keyValues) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            row.put((String) keyValues[i], keyValues[i + 1]);
        }
        return row;
    }

    @Test
    void parsesStringNumberAndBooleanLiterals() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY,
            output("s", "\"high\", \"mid\" ,\"a \\\"quoted\\\" one\""), output("n", "3,2.5,-1"), output("b", "true,false")));

        assertThat(ordering.columns()).extracting(PriorityOrdering.Column::outputName).containsExactly("s", "n", "b");
        assertThat(ordering.columns().get(0).values()).containsExactly("high", "mid", "a \"quoted\" one");
        assertThat(ordering.columns().get(1).values()).containsExactly(new BigDecimal("3"), new BigDecimal("2.5"), new BigDecimal("-1"));
        assertThat(ordering.columns().get(2).values()).containsExactly(true, false);
    }

    @Test
    void sortsByPositionInTheListHighestFirst() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("v", "\"c\",\"b\",\"a\"")));
        List<Map<String, Object>> rows = List.of(row("v", "a"), row("v", "c"), row("v", "b"));

        assertThat(ordering.sort(rows, r -> r)).containsExactly(row("v", "c"), row("v", "b"), row("v", "a"));
    }

    @Test
    void numbersCompareByValueNotByJavaType() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("v", "10,5,1")));
        List<Map<String, Object>> rows = List.of(row("v", 1L), row("v", 10.0), row("v", new BigDecimal("5.00")));

        assertThat(ordering.sort(rows, r -> r)).extracting(r -> ((Number) r.get("v")).intValue()).containsExactly(10, 5, 1);
    }

    @Test
    void laterColumnsBreakTiesOfEarlierColumns() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("risk", "\"high\",\"low\""), output("action", "\"go\",\"stop\"")));
        List<Map<String, Object>> rows = List.of(
            row("risk", "low", "action", "go"), row("risk", "high", "action", "stop"), row("risk", "high", "action", "go"), row("risk", "low", "action", "stop"));

        assertThat(ordering.sort(rows, r -> r)).containsExactly(
            row("risk", "high", "action", "go"), row("risk", "high", "action", "stop"),
            row("risk", "low", "action", "go"), row("risk", "low", "action", "stop"));
    }

    @Test
    void columnsWithoutOutputValuesDoNotParticipate() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY, output("note", null), output("level", "\"b\",\"a\"")));
        List<Map<String, Object>> rows = List.of(row("note", "z", "level", "a"), row("note", "a", "level", "b"));

        assertThat(ordering.columns()).extracting(PriorityOrdering.Column::outputName).containsExactly("level");
        assertThat(ordering.sort(rows, r -> r).get(0)).isEqualTo(row("note", "a", "level", "b"));
    }

    @Test
    void sortIsStableForTies() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("v", "\"x\",\"y\"")));
        List<Map<String, Object>> rows = List.of(row("v", "y", "id", 1), row("v", "x", "id", 2), row("v", "y", "id", 3), row("v", "x", "id", 4));

        assertThat(ordering.sort(rows, r -> r)).extracting(r -> r.get("id")).containsExactly(2, 4, 1, 3);
    }

    @Test
    void emptyOutputEntryHasTheLowestPriority() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("v", "\"x\",\"y\"")));
        Map<String, Object> empty = new LinkedHashMap<>();
        empty.put("v", null);

        assertThat(ordering.sort(List.of(empty, row("v", "y"), row("v", "x")), r -> r)).containsExactly(row("v", "x"), row("v", "y"), empty);
    }

    @Test
    void valueOutsideOutputValuesIsAnError() {
        PriorityOrdering ordering = PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY, output("v", "\"x\",\"y\"")));

        assertThatThrownBy(() -> ordering.sort(List.of(row("v", "x"), row("v", "z")), r -> r))
            .isInstanceOf(DmnException.class).hasMessageContaining("'v' produced \"z\"").hasMessageContaining("not in the column's outputValues");
    }

    @Test
    void missingOutputValuesIsAModelError() {
        assertThatThrownBy(() -> PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY, output("v", null))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("needs 'outputValues'");
        assertThatThrownBy(() -> PriorityOrdering.of(decision(DmnHitPolicy.OUTPUT_ORDER, output("v", "  "))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("OUTPUT ORDER");
    }

    @Test
    void nonLiteralOutputValuesAreAModelError() {
        assertThatThrownBy(() -> PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY, output("v", "upper case(\"a\")"))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("comma separated list of string, number or boolean literals");
        assertThatThrownBy(() -> PriorityOrdering.of(decision(DmnHitPolicy.PRIORITY, output("v", "\"unterminated"))))
            .isInstanceOf(DmnModelException.class);
    }
}
