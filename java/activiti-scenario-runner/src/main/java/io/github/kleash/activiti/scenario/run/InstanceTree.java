package io.github.kleash.activiti.scenario.run;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.activiti.engine.HistoryService;
import org.activiti.engine.history.HistoricProcessInstance;

import io.github.kleash.activiti.scenario.jobs.InstanceScope;

/**
 * The root process instance of a scenario plus every descendant reached through {@code superProcessInstanceId},
 * recursively. Every query the runner makes is scoped to it, so scenarios do not see each other's data.
 */
final class InstanceTree implements InstanceScope {

    private final HistoryService history;
    private final String rootId;

    InstanceTree(HistoryService history, String rootId) {
        this.history = history;
        this.rootId = rootId;
    }

    String rootId() {
        return rootId;
    }

    /** Root first, then descendants breadth first. */
    @Override
    public Set<String> instanceIds() {
        Set<String> ids = new LinkedHashSet<>();
        List<String> frontier = new ArrayList<>(List.of(rootId));
        ids.add(rootId);
        while (!frontier.isEmpty()) {
            List<String> next = new ArrayList<>();
            for (String parent : frontier) {
                for (HistoricProcessInstance child : history.createHistoricProcessInstanceQuery().superProcessInstanceId(parent)
                        .orderByProcessInstanceStartTime().asc().list()) {
                    if (ids.add(child.getId())) {
                        next.add(child.getId());
                    }
                }
            }
            frontier = next;
        }
        return ids;
    }
}
