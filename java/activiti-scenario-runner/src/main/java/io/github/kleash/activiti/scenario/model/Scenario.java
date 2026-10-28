package io.github.kleash.activiti.scenario.model;

import java.time.Instant;
import java.util.List;

/**
 * One process scenario: how the root instance starts, the steps that drive it and what must hold at the end.
 *
 * @param name        scenario name
 * @param description optional free text
 * @param clock       per-scenario fixed clock (overrides the file's), or {@code null}
 * @param start       how the root instance is created
 * @param steps       the steps, executed in order
 * @param expect      final assertions, or {@code null}
 */
public record Scenario(String name, String description, Instant clock, Start start, List<Step> steps, Expect expect) {

    public Scenario {
        steps = steps == null ? List.of() : List.copyOf(steps);
    }
}
