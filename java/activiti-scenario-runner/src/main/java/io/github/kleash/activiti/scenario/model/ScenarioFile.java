package io.github.kleash.activiti.scenario.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * A parsed {@code *.scenario.json} file (schema: {@code schemas/scenario.schema.json}).
 *
 * @param name        display name of the file
 * @param description optional free text
 * @param users       user name to group names
 * @param clock       fixed engine clock for every scenario of the file, or {@code null}
 * @param scenarios   process scenarios, in file order
 * @param decisions   decision cases, in file order
 * @param source      where the file was read from (for messages), may be {@code null}
 */
public record ScenarioFile(
        String name,
        String description,
        Map<String, List<String>> users,
        Instant clock,
        List<Scenario> scenarios,
        List<DecisionCase> decisions,
        String source) {

    public ScenarioFile {
        users = users == null ? Map.of() : Map.copyOf(users);
        scenarios = scenarios == null ? List.of() : List.copyOf(scenarios);
        decisions = decisions == null ? List.of() : List.copyOf(decisions);
    }
}
