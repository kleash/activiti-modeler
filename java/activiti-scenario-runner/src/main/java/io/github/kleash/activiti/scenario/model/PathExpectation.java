package io.github.kleash.activiti.scenario.model;

import java.util.List;

/** Expected path of one process instance. */
public record PathExpectation(
        List<String> contains,
        List<String> notContains,
        List<List<String>> order,
        List<String> sequenceFlows,
        List<String> notSequenceFlows) {

    public PathExpectation {
        contains = contains == null ? List.of() : List.copyOf(contains);
        notContains = notContains == null ? List.of() : List.copyOf(notContains);
        order = order == null ? List.of() : List.copyOf(order);
        sequenceFlows = sequenceFlows == null ? List.of() : List.copyOf(sequenceFlows);
        notSequenceFlows = notSequenceFlows == null ? List.of() : List.copyOf(notSequenceFlows);
    }
}
