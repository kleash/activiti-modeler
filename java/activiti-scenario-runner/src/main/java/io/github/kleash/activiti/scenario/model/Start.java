package io.github.kleash.activiti.scenario.model;

import java.util.Map;

/**
 * Trigger of the root process instance. Exactly one of {@code message}, {@code signal}, {@code timer} or
 * {@code process} (start by key) selects the way; {@code process} additionally qualifies {@code timer} and
 * {@code signal}. With {@code expectFailure} the scenario asserts that starting is rejected (no steps follow).
 */
public record Start(
        String process,
        String message,
        String signal,
        String timer,
        String businessKey,
        String user,
        Map<String, Object> variables,
        Step.ExpectedFailure expectFailure) {

    /** Kind of trigger. */
    public enum Kind { PROCESS, MESSAGE, SIGNAL, TIMER }

    public Start {
        variables = variables == null ? Map.of() : variables;
    }

    public Kind kind() {
        if (message != null) {
            return Kind.MESSAGE;
        }
        if (signal != null) {
            return Kind.SIGNAL;
        }
        if (timer != null) {
            return Kind.TIMER;
        }
        return Kind.PROCESS;
    }

    /** Human readable form, e.g. {@code start process loanApproval}. */
    public String describe() {
        return switch (kind()) {
            case MESSAGE -> "start by message '" + message + "'";
            case SIGNAL -> "start by signal '" + signal + "'";
            case TIMER -> "start by timer '" + timer + "' of process '" + process + "'";
            case PROCESS -> "start process '" + process + "'";
        };
    }
}
