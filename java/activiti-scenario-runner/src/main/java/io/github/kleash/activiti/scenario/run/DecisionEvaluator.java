package io.github.kleash.activiti.scenario.run;

import java.util.List;
import java.util.Map;

/**
 * Evaluates DMN decisions for the {@code decisions} section of a scenario file. The DMN connector module provides an
 * implementation backed by its engine; the runner has no DMN dependency of its own.
 */
@FunctionalInterface
public interface DecisionEvaluator {

    /**
     * Evaluates a decision.
     *
     * @param decision decision id (or table name) as written in the scenario
     * @param inputs   input variables
     * @return result rows (a single-result decision yields one row) and the ids of the matched rules
     */
    Outcome evaluate(String decision, Map<String, Object> inputs);

    /**
     * @param rows         result rows in hit-policy order, each a map of output name to value
     * @param matchedRules ids of the matched rules in result order
     */
    record Outcome(List<Map<String, Object>> rows, List<String> matchedRules) {
    }
}
