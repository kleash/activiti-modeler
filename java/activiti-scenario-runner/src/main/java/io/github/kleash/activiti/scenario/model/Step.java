package io.github.kleash.activiti.scenario.model;

import java.util.List;
import java.util.Map;

/**
 * A scenario step. Each record corresponds to one step type of the schema ({@code $defs/step}); {@link #type()}
 * is the JSON key.
 */
public sealed interface Step {

    /** The JSON key of the step type, e.g. {@code completeTask}. */
    String type();

    /** One-line human readable description used in reports. */
    String describe();

    /** Expected failure of a step ({@code expectFailure}). Both fields are optional. */
    record ExpectedFailure(String exception, String messageContains) {
        public String describe() {
            StringBuilder sb = new StringBuilder();
            if (exception != null) {
                sb.append(exception);
            }
            if (messageContains != null) {
                sb.append(sb.isEmpty() ? "" : " ").append("containing \"").append(messageContains).append('"');
            }
            return sb.isEmpty() ? "any failure" : sb.toString();
        }
    }

    /**
     * Selects one task among several at an activity. {@code fields} holds the given keys among
     * {@code localVariables}, {@code assignee}, {@code name} (expected values or matchers) and {@code index}.
     */
    record TaskMatch(Map<String, Object> fields) {
        public TaskMatch {
            fields = fields == null ? Map.of() : fields;
        }

        public String describe() {
            return fields.toString();
        }
    }

    /**
     * Task assertions. {@code fields} holds exactly the keys the file gave (so an explicit {@code null} stays
     * distinguishable from absence) among {@code name}, {@code description}, {@code assignee}, {@code owner},
     * {@code priority}, {@code category}, {@code formKey}, {@code dueDate}, {@code localVariables},
     * {@code candidateUsers}, {@code candidateGroups}, {@code identityLinks}.
     */
    record ExpectTask(
            String activity,
            TaskMatch match,
            Integer count,
            Map<String, Object> fields,
            boolean partial,
            List<String> visibleTo,
            List<String> notVisibleTo) implements Step {

        public ExpectTask {
            fields = fields == null ? Map.of() : fields;
            visibleTo = visibleTo == null ? List.of() : List.copyOf(visibleTo);
            notVisibleTo = notVisibleTo == null ? List.of() : List.copyOf(notVisibleTo);
        }

        @Override public String type() { return "expectTask"; }
        @Override public String describe() { return "expectTask " + activity; }
    }

    record Claim(String activity, String user, TaskMatch match) implements Step {
        @Override public String type() { return "claim"; }
        @Override public String describe() { return "claim " + activity + " as " + user; }
    }

    record Release(String activity, String user, TaskMatch match) implements Step {
        @Override public String type() { return "release"; }
        @Override public String describe() { return "release " + activity + " as " + user; }
    }

    record Assign(String activity, String assignee, String user, TaskMatch match) implements Step {
        @Override public String type() { return "assign"; }
        @Override public String describe() { return "assign " + activity + " to " + assignee + " (by " + user + ")"; }
    }

    record CompleteTask(
            String activity, String user, Map<String, Object> variables, TaskMatch match, ExpectedFailure expectFailure)
            implements Step {
        public CompleteTask {
            variables = variables == null ? Map.of() : variables;
        }

        @Override public String type() { return "completeTask"; }
        @Override public String describe() {
            return "completeTask " + activity + " as " + user
                    + (expectFailure != null ? " (expecting failure: " + expectFailure.describe() + ")" : "");
        }
    }

    record ExpectConnectorCall(
            String activity,
            String connector,
            Integer count,
            Integer call,
            Map<String, Object> inbound,
            Map<String, Object> outbound,
            boolean partial) implements Step {
        @Override public String type() { return "expectConnectorCall"; }
        @Override public String describe() { return "expectConnectorCall " + activity; }
    }

    record ExpectChildInstance(
            String callActivity,
            String process,
            Object businessKey,
            boolean hasBusinessKey,
            Integer count,
            Integer call,
            String state,
            Map<String, Object> startVariables,
            Map<String, Object> variables,
            List<String> absentVariables,
            PathExpectation path) implements Step {
        @Override public String type() { return "expectChildInstance"; }
        @Override public String describe() { return "expectChildInstance of " + callActivity; }
    }

    record Message(String name, String correlationKey, Map<String, Object> variables, String user, ExpectedFailure expectFailure)
            implements Step {
        public Message {
            variables = variables == null ? Map.of() : variables;
        }

        @Override public String type() { return "message"; }
        @Override public String describe() {
            return "message '" + name + "'" + (correlationKey != null ? " [" + correlationKey + "]" : "")
                    + (expectFailure != null ? " (expecting failure: " + expectFailure.describe() + ")" : "");
        }
    }

    record Signal(String name, Map<String, Object> variables, String user) implements Step {
        public Signal {
            variables = variables == null ? Map.of() : variables;
        }

        @Override public String type() { return "signal"; }
        @Override public String describe() { return "signal '" + name + "'"; }
    }

    /**
     * {@code match} picks one of several executions waiting at the activity (a multi-instance receive task); only its
     * {@code localVariables} apply, checked against the variables visible from the execution (the element variable is local to it).
     */
    record TriggerReceiveTask(String activity, Map<String, Object> variables, TaskMatch match) implements Step {
        public TriggerReceiveTask {
            variables = variables == null ? Map.of() : variables;
        }

        @Override public String type() { return "triggerReceiveTask"; }
        @Override public String describe() { return "triggerReceiveTask " + activity; }
    }

    /** {@code dueDate} is {@code null} when not asserted; {@code hasDueDate} tells an explicit null apart. */
    record ExpectTimer(String activity, Integer count, Object dueDate, boolean hasDueDate) implements Step {
        @Override public String type() { return "expectTimer"; }
        @Override public String describe() { return "expectTimer " + activity; }
    }

    record FireTimer(String activity, boolean all) implements Step {
        @Override public String type() { return "fireTimer"; }
        @Override public String describe() { return "fireTimer " + activity; }
    }

    record AdvanceClock(String duration) implements Step {
        @Override public String type() { return "advanceClock"; }
        @Override public String describe() { return "advanceClock " + duration; }
    }

    record ExecuteJobs(Integer maxRounds, Integer timeoutMs) implements Step {
        @Override public String type() { return "executeJobs"; }
        @Override public String describe() { return "executeJobs"; }
    }

    record FailJobUntilDeadLetter(String activity, Integer maxAttempts) implements Step {
        @Override public String type() { return "failJobUntilDeadLetter"; }
        @Override public String describe() { return "failJobUntilDeadLetter " + activity; }
    }

    /** {@code exactly}, {@code contains} and {@code notContains} may each be {@code null}. */
    record ExpectActive(List<String> exactly, List<String> contains, List<String> notContains) implements Step {
        @Override public String type() { return "expectActive"; }
        @Override public String describe() {
            return "expectActive " + (exactly != null ? exactly : "")
                    + (contains != null ? " contains " + contains : "")
                    + (notContains != null ? " notContains " + notContains : "");
        }
    }

    record SetVariables(Map<String, Object> variables) implements Step {
        @Override public String type() { return "setVariables"; }
        @Override public String describe() { return "setVariables " + variables.keySet(); }
    }
}
