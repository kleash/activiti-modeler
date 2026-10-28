package io.github.kleash.activiti.scenario.run;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.history.HistoricDetail;
import org.activiti.engine.history.HistoricProcessInstance;
import org.activiti.engine.history.HistoricVariableInstance;
import org.activiti.engine.history.HistoricVariableUpdate;
import org.activiti.engine.impl.persistence.entity.HistoricVariableInstanceEntity;

import io.github.kleash.activiti.scenario.model.PathExpectation;
import io.github.kleash.activiti.scenario.recording.SequenceFlowRecorder;

/** Read access to what a process instance did and holds, from history and the recorders. */
final class Inspector {

    private final ScenarioEngine engine;

    Inspector(ScenarioEngine engine) {
        this.engine = engine;
    }

    /** Compares engine ids: numerically when both are numbers (the default id generator), else as text. */
    static int compareIds(String a, String b) {
        try {
            return Long.compare(Long.parseLong(a), Long.parseLong(b));
        } catch (NumberFormatException e) {
            return a.compareTo(b);
        }
    }

    boolean isRunning(String instanceId) {
        return engine.runtimeService().createProcessInstanceQuery().processInstanceId(instanceId).count() > 0;
    }

    HistoricProcessInstance historic(String instanceId) {
        HistoricProcessInstance instance = engine.historyService().createHistoricProcessInstanceQuery().processInstanceId(instanceId).singleResult();
        if (instance == null) {
            throw new IllegalStateException("Process instance " + instanceId + " has no history record");
        }
        return instance;
    }

    /**
     * Activity instances of a process instance in the order they were entered. Ties (equal timestamps, as with a fixed
     * clock) are broken by the id, which the engine generates in increasing order.
     */
    List<HistoricActivityInstance> activities(String instanceId) {
        List<HistoricActivityInstance> list = new ArrayList<>(
                engine.historyService().createHistoricActivityInstanceQuery().processInstanceId(instanceId).list());
        list.sort(Comparator.comparing(HistoricActivityInstance::getStartTime).thenComparing(HistoricActivityInstance::getId, Inspector::compareIds));
        return list;
    }

    /** Activity ids entered by the instance, in entering order, repeated entries kept. */
    List<String> path(String instanceId) {
        return activities(instanceId).stream().map(HistoricActivityInstance::getActivityId).toList();
    }

    Set<String> endEvents(String instanceId) {
        Set<String> ids = new TreeSet<>();
        for (HistoricActivityInstance a : activities(instanceId)) {
            if ("endEvent".equals(a.getActivityType())) {
                ids.add(a.getActivityId());
            }
        }
        return ids;
    }

    Set<String> flowsOf(String instanceId) {
        Set<String> ids = new LinkedHashSet<>();
        for (SequenceFlowRecorder.TakenFlow f : engine.sequenceFlows().flowsOf(Set.of(instanceId))) {
            ids.add(f.flowId());
        }
        return ids;
    }

    /** Process-level variables: live values while the instance runs, history afterwards. */
    Map<String, Object> processVariables(String instanceId) {
        if (isRunning(instanceId)) {
            return new LinkedHashMap<>(engine.runtimeService().getVariables(instanceId));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (HistoricVariableInstance v : engine.historyService().createHistoricVariableInstanceQuery().processInstanceId(instanceId).list()) {
            // HistoricVariableInstance does not expose the execution; the entity does. Variables of other (child)
            // executions - multi-instance element variables, loop counters - are not process variables.
            boolean processLevel = v instanceof HistoricVariableInstanceEntity e ? instanceId.equals(e.getExecutionId()) : true;
            if (v.getTaskId() == null && processLevel) {
                out.put(v.getVariableName(), v.getValue());
            }
        }
        return out;
    }

    /** The first recorded value of each process-level variable (what the instance was started with, after mapping). */
    Map<String, Object> startVariables(String instanceId) {
        List<HistoricDetail> details = new ArrayList<>(
                engine.historyService().createHistoricDetailQuery().processInstanceId(instanceId).variableUpdates().list());
        details.sort(Comparator.comparing(HistoricDetail::getTime).thenComparing(HistoricDetail::getId, Inspector::compareIds));
        Map<String, Object> out = new LinkedHashMap<>();
        for (HistoricDetail d : details) {
            if (d instanceof HistoricVariableUpdate update && update.getTaskId() == null) {
                out.putIfAbsent(update.getVariableName(), update.getValue());
            }
        }
        return out;
    }

    /** Checks a path expectation; the messages start with {@code label}. */
    List<String> checkPath(String label, String instanceId, PathExpectation expected) {
        List<String> problems = new ArrayList<>();
        List<String> path = path(instanceId);
        Set<String> entered = new LinkedHashSet<>(path);
        for (String id : expected.contains()) {
            if (!entered.contains(id)) {
                problems.add(label + ".path.contains: activity '" + id + "' was never entered; entered: " + path);
            }
        }
        for (String id : expected.notContains()) {
            if (entered.contains(id)) {
                problems.add(label + ".path.notContains: activity '" + id + "' was entered; path: " + path);
            }
        }
        for (List<String> pair : expected.order()) {
            String a = pair.get(0);
            String b = pair.get(1);
            int firstA = path.indexOf(a);
            int lastB = path.lastIndexOf(b);
            if (firstA < 0 || lastB < 0) {
                problems.add(label + ".path.order [" + a + ", " + b + "]: '" + (firstA < 0 ? a : b) + "' was never entered; path: " + path);
            } else if (firstA >= lastB) {
                problems.add(label + ".path.order [" + a + ", " + b + "]: expected '" + a + "' to be entered before '" + b + "' but the path was " + path);
            }
        }
        if (!expected.sequenceFlows().isEmpty() || !expected.notSequenceFlows().isEmpty()) {
            Set<String> flows = flowsOf(instanceId);
            for (String id : expected.sequenceFlows()) {
                if (!flows.contains(id)) {
                    problems.add(label + ".path.sequenceFlows: sequence flow '" + id + "' was not taken; taken: " + flows);
                }
            }
            for (String id : expected.notSequenceFlows()) {
                if (flows.contains(id)) {
                    problems.add(label + ".path.notSequenceFlows: sequence flow '" + id + "' was taken; taken: " + flows);
                }
            }
        }
        return problems;
    }

    /** Flow nodes and sequence flows visited by the given instances, by process definition key. */
    Map<String, Visit> visits(Collection<String> instanceIds) {
        Map<String, Visit> byKey = new LinkedHashMap<>();
        for (String id : instanceIds) {
            HistoricProcessInstance instance = engine.historyService().createHistoricProcessInstanceQuery().processInstanceId(id).singleResult();
            if (instance == null) {
                continue;
            }
            Visit visit = byKey.computeIfAbsent(instance.getProcessDefinitionKey(), k -> new Visit());
            visit.nodes.addAll(path(id));
            visit.flows.addAll(flowsOf(id));
        }
        return byKey;
    }

    /** Nodes and flows of one process definition. */
    static final class Visit {
        final Set<String> nodes = new TreeSet<>();
        final Set<String> flows = new TreeSet<>();
    }
}
