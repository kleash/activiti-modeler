package io.github.kleash.activiti.scenario.report;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Flow nodes and sequence flows visited by the process instances of one or more scenarios, per process definition
 * key. Input of the path coverage computation.
 */
public record VisitedElements(Map<String, Visits> byProcess) {

    /** Visits of one process definition. */
    public record Visits(Set<String> nodes, Set<String> flows) {
    }

    public static VisitedElements empty() {
        return new VisitedElements(new TreeMap<>());
    }

    /** Adds the given visits for a process key. */
    public void add(String processKey, Set<String> nodes, Set<String> flows) {
        Visits visits = byProcess.computeIfAbsent(processKey, k -> new Visits(new TreeSet<>(), new TreeSet<>()));
        visits.nodes().addAll(nodes);
        visits.flows().addAll(flows);
    }

    /** Adds everything from {@code other}. */
    public void addAll(VisitedElements other) {
        other.byProcess.forEach((key, v) -> add(key, v.nodes(), v.flows()));
    }
}
