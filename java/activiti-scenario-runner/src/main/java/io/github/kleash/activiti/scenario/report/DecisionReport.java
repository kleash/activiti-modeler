package io.github.kleash.activiti.scenario.report;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnore;

/** Result of one decision case. */
public record DecisionReport(String name, Status status, long durationMs, List<String> failures, @JsonIgnore Throwable cause) {

    public boolean passed() {
        return status == Status.PASSED;
    }

    public String render() {
        StringBuilder sb = new StringBuilder("Decision case '").append(name).append("' ").append(passed() ? "passed" : "FAILED");
        failures.forEach(f -> sb.append("\n  - ").append(f.replace("\n", "\n    ")));
        return sb.toString();
    }
}
