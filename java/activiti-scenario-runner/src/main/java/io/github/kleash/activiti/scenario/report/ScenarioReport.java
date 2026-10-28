package io.github.kleash.activiti.scenario.report;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * Result of one process scenario.
 *
 * @param name                  scenario name
 * @param status                PASSED or FAILED
 * @param durationMs            wall-clock time of the whole scenario including cleanup
 * @param rootProcessInstanceId id of the root instance ({@code null} when it could not be started)
 * @param steps                 the start and every step with its outcome
 * @param failures              every problem found: the failing step first, then each mismatch of the final {@code expect}
 * @param visited               flow nodes and sequence flows visited by the instance tree (for path coverage)
 * @param cause                 the exception that failed a step, if any (not serialized)
 */
public record ScenarioReport(
        String name,
        Status status,
        long durationMs,
        String rootProcessInstanceId,
        List<StepReport> steps,
        List<String> failures,
        VisitedElements visited,
        @JsonIgnore Throwable cause) {

    public boolean passed() {
        return status == Status.PASSED;
    }

    /** Multi-line, human readable account of the run: one line per step, then the problems. */
    public String render() {
        StringBuilder sb = new StringBuilder();
        sb.append("Scenario '").append(name).append("' ").append(passed() ? "passed" : "FAILED").append(" in ").append(durationMs).append(" ms");
        for (StepReport step : steps) {
            sb.append("\n  ").append(switch (step.status()) {
                case PASSED -> "[ok]   ";
                case FAILED -> "[FAIL] ";
                case SKIPPED -> "[skip] ";
            });
            sb.append(step.index() == 0 ? "start" : "step " + step.index()).append(": ").append(step.description());
        }
        if (!failures.isEmpty()) {
            sb.append("\nProblems:");
            failures.forEach(f -> sb.append("\n  - ").append(f.replace("\n", "\n    ")));
        }
        return sb.toString();
    }
}
