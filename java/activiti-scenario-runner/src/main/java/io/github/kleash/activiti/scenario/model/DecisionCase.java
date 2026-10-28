package io.github.kleash.activiti.scenario.model;

import java.util.List;
import java.util.Map;

/**
 * A DMN decision evaluation with its expected result rows and matched rule ids.
 *
 * @param name         optional display name
 * @param decision     decision id (or table name) understood by the {@code DecisionEvaluator}
 * @param inputs       input variables
 * @param result       expected rows in order, or {@code null} when not asserted
 * @param matchedRules expected matched rule ids (exact set), or {@code null} when not asserted
 */
public record DecisionCase(
        String name, String decision, Map<String, Object> inputs, List<Map<String, Object>> result, List<String> matchedRules) {

    public DecisionCase {
        inputs = inputs == null ? Map.of() : inputs;
    }

    public String title() {
        return name != null ? name : "decision " + decision;
    }
}
