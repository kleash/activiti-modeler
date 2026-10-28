package io.github.kleash.activiti.scenario.model;

import java.util.List;
import java.util.Map;

/**
 * Final assertions of a scenario. A {@code null} component means "not asserted".
 *
 * @param state           COMPLETED, ACTIVE or DEADLETTER
 * @param endEvents       exact set of end events reached by the root instance
 * @param path            path assertions for the root instance
 * @param variables       expected process variables (subset, matchers allowed)
 * @param absentVariables variable names that must not exist
 * @param deadLetterJobs  exact list of dead-letter jobs in the tree
 */
public record Expect(
        String state,
        List<String> endEvents,
        PathExpectation path,
        Map<String, Object> variables,
        List<String> absentVariables,
        List<DeadLetterExpectation> deadLetterJobs) {
}
