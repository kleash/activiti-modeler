package io.github.kleash.activiti.scenario.report;

import java.util.List;

/**
 * Result of running one scenario file. Serializable with Jackson (the modeler server returns it as JSON).
 *
 * @param name       the file's name
 * @param source     where the file was read from, or {@code null}
 * @param durationMs wall-clock time
 * @param scenarios  one report per process scenario, in order
 * @param decisions  one report per decision case, in order
 * @param visited    everything the scenarios of the file visited
 */
public record FileReport(
        String name,
        String source,
        long durationMs,
        List<ScenarioReport> scenarios,
        List<DecisionReport> decisions,
        VisitedElements visited) {

    public Status status() {
        boolean failed = scenarios.stream().anyMatch(s -> !s.passed()) || decisions.stream().anyMatch(d -> !d.passed());
        return failed ? Status.FAILED : Status.PASSED;
    }

    public boolean passed() {
        return status() == Status.PASSED;
    }

    public String render() {
        StringBuilder sb = new StringBuilder("Scenario file '").append(name).append("' ").append(passed() ? "passed" : "FAILED");
        scenarios.forEach(s -> sb.append("\n").append(s.render().indent(2).stripTrailing()));
        decisions.forEach(d -> sb.append("\n").append(d.render().indent(2).stripTrailing()));
        return sb.toString();
    }
}
