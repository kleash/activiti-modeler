package io.github.kleash.activiti.scenario.load;

import java.util.List;

/** A scenario, model-expect or exemptions file does not conform to its JSON Schema (or is not valid JSON). */
public class InvalidScenarioException extends RuntimeException {

    private final transient List<String> problems;

    public InvalidScenarioException(String source, List<String> problems) {
        super(buildMessage(source, problems));
        this.problems = List.copyOf(problems);
    }

    public InvalidScenarioException(String source, String problem, Throwable cause) {
        super(buildMessage(source, List.of(problem)), cause);
        this.problems = List.of(problem);
    }

    /** One entry per schema violation, each starting with the JSON path of the offending value. */
    public List<String> problems() {
        return problems;
    }

    private static String buildMessage(String source, List<String> problems) {
        StringBuilder sb = new StringBuilder();
        sb.append(source).append(" is not valid (").append(problems.size()).append(problems.size() == 1 ? " problem" : " problems").append("):");
        for (String problem : problems) {
            sb.append("\n  - ").append(problem);
        }
        return sb.toString();
    }
}
