package io.github.kleash.activiti.scenario.model;

import java.util.List;

/** Parsed {@code coverage-exemptions.json}. */
public record CoverageExemptions(List<Exemption> exemptions) {

    public static final CoverageExemptions NONE = new CoverageExemptions(List.of());

    public CoverageExemptions {
        exemptions = exemptions == null ? List.of() : List.copyOf(exemptions);
    }

    /**
     * @param process process id, or {@code null} when the element id is unique in the project
     * @param element id of the flow node or sequence flow
     * @param reason  why it is exempt
     */
    public record Exemption(String process, String element, String reason) {
    }
}
