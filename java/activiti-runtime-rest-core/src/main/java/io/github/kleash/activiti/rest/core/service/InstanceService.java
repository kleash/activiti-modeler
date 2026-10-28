package io.github.kleash.activiti.rest.core.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.activiti.api.process.model.ProcessInstance;
import org.activiti.api.process.model.builders.MessagePayloadBuilder;
import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.model.payloads.SetProcessVariablesPayload;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.FlowElementsContainer;
import org.activiti.bpmn.model.SequenceFlow;
import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.history.HistoricDetail;
import org.activiti.engine.history.HistoricProcessInstance;
import org.activiti.engine.history.HistoricProcessInstanceQuery;
import org.activiti.engine.history.HistoricVariableInstance;
import org.activiti.engine.history.HistoricVariableUpdate;
import org.activiti.engine.impl.persistence.entity.HistoricVariableInstanceEntity;
import org.activiti.engine.runtime.Execution;
import org.activiti.engine.runtime.ProcessInstanceQuery;
import org.activiti.runtime.api.impl.ProcessVariablesPayloadValidator;
import org.springframework.beans.factory.ObjectProvider;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.core.dto.InstanceDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;

/**
 * Process instances: start (through {@code ProcessRuntime}, as the principal), list, inspect running and ended ones, manage.
 *
 * <p>Reads use the engine services, because {@code ProcessRuntime} shows an instance only to the user who started it or works on
 * one of its tasks - right for an end user, wrong for an operator. Starts go through {@code ProcessRuntime}, so security policies,
 * candidate starters and variable validation apply as for any user; management operations (suspend, activate, delete,
 * variables) use the engine directly under the {@code operate} access level, because the runtime would restrict them to the starter.
 */
public class InstanceService {

    private final ProcessRuntime processRuntime;
    private final RuntimeService runtime;
    private final HistoryService history;
    private final RepositoryService repository;
    private final TaskViews tasks;
    private final JobService jobs;
    private final SequenceFlowTracker flows;
    private final ObjectProvider<ProcessVariablesPayloadValidator> validator;
    private final ObjectMapper mapper;

    public InstanceService(ProcessRuntime processRuntime, RuntimeService runtime, HistoryService history, RepositoryService repository,
                           TaskViews tasks, JobService jobs, SequenceFlowTracker flows,
                           ObjectProvider<ProcessVariablesPayloadValidator> validator, ObjectMapper mapper) {
        this.processRuntime = processRuntime;
        this.runtime = runtime;
        this.history = history;
        this.repository = repository;
        this.tasks = tasks;
        this.jobs = jobs;
        this.flows = flows;
        this.validator = validator;
        this.mapper = mapper;
    }

    // ---- start ----------------------------------------------------------------------------------------------------------

    /** Starts an instance as the authenticated principal, by key, definition id or message. */
    public InstanceDtos.InstanceDetail start(InstanceDtos.StartRequest request) {
        int given = (request.processKey() != null ? 1 : 0) + (request.processDefinitionId() != null ? 1 : 0) + (request.messageName() != null ? 1 : 0);
        if (given != 1) {
            throw new IllegalArgumentException("Give exactly one of processKey, processDefinitionId and messageName");
        }
        Map<String, Object> variables = Values.nonNull(request.variables());
        ProcessInstance started;
        if (request.messageName() != null) {
            started = processRuntime.start(MessagePayloadBuilder.start(request.messageName())
                    .withBusinessKey(request.businessKey()).withVariables(variables).build());
        } else {
            started = processRuntime.start(ProcessPayloadBuilder.start()
                    .withProcessDefinitionKey(request.processKey())
                    .withProcessDefinitionId(request.processKey() == null ? request.processDefinitionId() : null)
                    .withBusinessKey(request.businessKey())
                    .withName(request.name())
                    .withVariables(variables).build());
        }
        return detail(started.getId());
    }

    // ---- read -------------------------------------------------------------------------------------------------------------

    /**
     * Instances, newest first.
     *
     * @param state {@code all} (default), {@code running} (active or suspended), {@code active}, {@code suspended}, {@code finished},
     *              {@code completed} or {@code cancelled}
     */
    public PageDto<InstanceDtos.InstanceSummary> list(Paging paging, String state, String definitionKey, String definitionId, String businessKey,
                                              String startedBy, String parentId) {
        String wanted = state == null || state.isBlank() ? "all" : state.toLowerCase();
        if (wanted.equals("active") || wanted.equals("suspended")) {
            ProcessInstanceQuery query = runtime.createProcessInstanceQuery();
            if (wanted.equals("active")) {
                query.active();
            } else {
                query.suspended();
            }
            if (definitionKey != null) {
                query.processDefinitionKey(definitionKey);
            }
            if (definitionId != null) {
                query.processDefinitionId(definitionId);
            }
            if (businessKey != null) {
                query.processInstanceBusinessKey(businessKey);
            }
            if (startedBy != null) {
                query.startedBy(startedBy);
            }
            if (parentId != null) {
                query.superProcessInstanceId(parentId);
            }
            query.orderByProcessInstanceId().desc();
            List<InstanceDtos.InstanceSummary> items = query.listPage(paging.first(), paging.size()).stream()
                    .map(i -> summary(i, wanted.toUpperCase())).toList();
            return new PageDto<>(items, paging.page(), paging.size(), query.count());
        }
        HistoricProcessInstanceQuery query = history.createHistoricProcessInstanceQuery();
        switch (wanted) {
            case "all" -> { }
            case "running" -> query.unfinished();
            case "finished" -> query.finished();
            case "completed" -> query.finished().notDeleted();
            case "cancelled" -> query.finished().deleted();
            default -> throw new IllegalArgumentException("Unknown state '" + state + "'; use all, running, active, suspended, finished, completed or cancelled");
        }
        if (definitionKey != null) {
            query.processDefinitionKey(definitionKey);
        }
        if (definitionId != null) {
            query.processDefinitionId(definitionId);
        }
        if (businessKey != null) {
            query.processInstanceBusinessKey(businessKey);
        }
        if (startedBy != null) {
            query.startedBy(startedBy);
        }
        if (parentId != null) {
            query.superProcessInstanceId(parentId);
        }
        query.orderByProcessInstanceStartTime().desc();
        List<HistoricProcessInstance> page = query.listPage(paging.first(), paging.size());
        Set<String> suspended = suspendedAmong(page);
        List<InstanceDtos.InstanceSummary> items = page.stream().map(h -> summary(h, suspended)).toList();
        return new PageDto<>(items, paging.page(), paging.size(), query.count());
    }

    /** Everything about one instance, running or ended. */
    public InstanceDtos.InstanceDetail detail(String id) {
        HistoricProcessInstance h = requireHistoric(id);
        org.activiti.engine.runtime.ProcessInstance running = runtime.createProcessInstanceQuery().processInstanceId(id).singleResult();
        BpmnModel model = modelOf(h.getProcessDefinitionId());
        List<HistoricActivityInstance> activities = activities(id);
        List<String> active = running == null ? List.of() : runtime.getActiveActivityIds(id);
        return new InstanceDtos.InstanceDetail(
                h.getId(), h.getProcessDefinitionId(), h.getProcessDefinitionKey(), h.getProcessDefinitionName(), h.getProcessDefinitionVersion(),
                h.getDeploymentId(), h.getBusinessKey(), h.getName(), stateOf(h, running), Values.instant(h.getStartTime()), Values.instant(h.getEndTime()),
                h.getDurationInMillis(), h.getStartUserId(), h.getStartActivityId(), h.getEndActivityId(), h.getDeleteReason(),
                h.getSuperProcessInstanceId(), active, path(h, model, activities), variables(h, running != null),
                tasks.ofInstance(id), jobs.ofInstance(id), executions(id, model), children(id));
    }

    /** What an instance visited. */
    public InstanceDtos.InstancePath path(String id) {
        HistoricProcessInstance h = requireHistoric(id);
        return path(h, modelOf(h.getProcessDefinitionId()), activities(id));
    }

    /** Process variables of an instance: live while it runs, from history afterwards. */
    public List<InstanceDtos.InstanceVariable> variables(String id) {
        HistoricProcessInstance h = requireHistoric(id);
        return variables(h, runtime.createProcessInstanceQuery().processInstanceId(id).count() > 0);
    }

    /** Every update of every process variable, oldest first. */
    public List<InstanceDtos.InstanceVariableUpdate> variableHistory(String id) {
        requireHistoric(id);
        List<HistoricDetail> details = new ArrayList<>(history.createHistoricDetailQuery().processInstanceId(id).variableUpdates().list());
        details.sort(Comparator.comparing(HistoricDetail::getTime).thenComparing(HistoricDetail::getId, InstanceService::compareIds));
        List<InstanceDtos.InstanceVariableUpdate> out = new ArrayList<>();
        for (HistoricDetail d : details) {
            if (d instanceof HistoricVariableUpdate update) {
                out.add(new InstanceDtos.InstanceVariableUpdate(update.getVariableName(), update.getVariableTypeName(), Values.json(mapper, update.getValue()),
                        update.getRevision(), Values.instant(d.getTime()), d.getExecutionId(), d.getTaskId()));
            }
        }
        return out;
    }

    // ---- manage -----------------------------------------------------------------------------------------------------------

    /** Sets process variables of a running instance, validated against the declared properties as the runtime does. */
    public void setVariables(String id, Map<String, Object> variables) {
        org.activiti.engine.runtime.ProcessInstance instance = requireRunning(id);
        Map<String, Object> values = Values.nonNull(variables);
        if (values.isEmpty()) {
            throw new IllegalArgumentException("No variables given");
        }
        ProcessVariablesPayloadValidator checker = validator.getIfAvailable();
        if (checker != null) {
            SetProcessVariablesPayload payload = ProcessPayloadBuilder.setVariables(id).withVariables(values).build();
            checker.checkPayloadVariables(payload, instance.getProcessDefinitionId());
            // the validator may convert values (a date given as text); the converted ones are set
            values = payload.getVariables();
        }
        runtime.setVariables(id, values);
    }

    /** Removes process variables of a running instance. */
    public void removeVariables(String id, List<String> names) {
        requireRunning(id);
        if (names == null || names.isEmpty()) {
            throw new IllegalArgumentException("No variable names given");
        }
        runtime.removeVariables(id, names);
    }

    public void suspend(String id) {
        requireRunning(id);
        runtime.suspendProcessInstanceById(id);
    }

    public void activate(String id) {
        requireRunning(id);
        runtime.activateProcessInstanceById(id);
    }

    /** Cancels a running instance (its history stays, with the reason). */
    public void cancel(String id, String reason) {
        requireRunning(id);
        runtime.deleteProcessInstance(id, reason == null || reason.isBlank() ? "cancelled through the REST API" : reason);
    }

    /** Deletes the history of an ended instance (admin only; the controller checks). */
    public void purgeHistory(String id) {
        HistoricProcessInstance h = requireHistoric(id);
        if (h.getEndTime() == null) {
            throw new IllegalStateException("Process instance " + id + " is still running; cancel it first");
        }
        history.deleteHistoricProcessInstance(id);
    }

    /** Triggers a waiting execution (a receive task, an intermediate catch the engine lets you trigger). */
    public void trigger(String executionId, Map<String, Object> variables) {
        Execution execution = runtime.createExecutionQuery().executionId(executionId).singleResult();
        if (execution == null) {
            throw new ActivitiObjectNotFoundException("No execution with id '" + executionId + "'", Execution.class);
        }
        Map<String, Object> values = Values.nonNull(variables);
        if (values.isEmpty()) {
            runtime.trigger(executionId);
        } else {
            runtime.trigger(executionId, values);
        }
    }

    // ---- building blocks ----------------------------------------------------------------------------------------------------

    private HistoricProcessInstance requireHistoric(String id) {
        HistoricProcessInstance h = history.createHistoricProcessInstanceQuery().processInstanceId(id).singleResult();
        if (h == null) {
            throw new ActivitiObjectNotFoundException("No process instance with id '" + id + "'", ProcessInstance.class);
        }
        return h;
    }

    private org.activiti.engine.runtime.ProcessInstance requireRunning(String id) {
        org.activiti.engine.runtime.ProcessInstance instance = runtime.createProcessInstanceQuery().processInstanceId(id).singleResult();
        if (instance == null) {
            requireHistoric(id);
            throw new IllegalStateException("Process instance " + id + " has ended");
        }
        return instance;
    }

    private Set<String> suspendedAmong(List<HistoricProcessInstance> page) {
        Set<String> unfinished = page.stream().filter(h -> h.getEndTime() == null).map(HistoricProcessInstance::getId).collect(Collectors.toSet());
        if (unfinished.isEmpty()) {
            return Set.of();
        }
        return runtime.createProcessInstanceQuery().processInstanceIds(unfinished).suspended().list().stream()
                .map(org.activiti.engine.runtime.ProcessInstance::getId).collect(Collectors.toSet());
    }

    private static String stateOf(HistoricProcessInstance h, org.activiti.engine.runtime.ProcessInstance running) {
        if (running != null) {
            return running.isSuspended() ? "SUSPENDED" : "ACTIVE";
        }
        return finishedState(h);
    }

    private static String finishedState(HistoricProcessInstance h) {
        if (h.getEndTime() == null) {
            return "ACTIVE";
        }
        return h.getDeleteReason() == null ? "COMPLETED" : "CANCELLED";
    }

    private InstanceDtos.InstanceSummary summary(HistoricProcessInstance h, Set<String> suspended) {
        String state = suspended.contains(h.getId()) ? "SUSPENDED" : finishedState(h);
        return new InstanceDtos.InstanceSummary(h.getId(), h.getProcessDefinitionId(), h.getProcessDefinitionKey(), h.getProcessDefinitionName(),
                h.getProcessDefinitionVersion(), h.getBusinessKey(), h.getName(), state, Values.instant(h.getStartTime()), Values.instant(h.getEndTime()),
                h.getStartUserId(), h.getSuperProcessInstanceId(), h.getDeleteReason());
    }

    private InstanceDtos.InstanceSummary summary(org.activiti.engine.runtime.ProcessInstance i, String state) {
        return new InstanceDtos.InstanceSummary(i.getId(), i.getProcessDefinitionId(), i.getProcessDefinitionKey(), i.getProcessDefinitionName(),
                i.getProcessDefinitionVersion(), i.getBusinessKey(), i.getName(), state, Values.instant(i.getStartTime()), null, i.getStartUserId(),
                i.getParentProcessInstanceId(), null);
    }

    private List<InstanceDtos.InstanceSummary> children(String id) {
        List<HistoricProcessInstance> children = history.createHistoricProcessInstanceQuery().superProcessInstanceId(id)
                .orderByProcessInstanceStartTime().asc().list();
        Set<String> suspended = suspendedAmong(children);
        return children.stream().map(c -> summary(c, suspended)).toList();
    }

    private List<HistoricActivityInstance> activities(String id) {
        List<HistoricActivityInstance> list = new ArrayList<>(history.createHistoricActivityInstanceQuery().processInstanceId(id).list());
        list.sort(Comparator.comparing(HistoricActivityInstance::getStartTime).thenComparing(HistoricActivityInstance::getId, InstanceService::compareIds));
        return list;
    }

    private InstanceDtos.InstancePath path(HistoricProcessInstance h, BpmnModel model, List<HistoricActivityInstance> activities) {
        List<InstanceDtos.InstanceActivityStep> steps = activities.stream().map(a -> new InstanceDtos.InstanceActivityStep(a.getActivityId(), a.getActivityName(),
                a.getActivityType(), a.getExecutionId(), a.getTaskId(), a.getAssignee(), a.getCalledProcessInstanceId(), Values.instant(a.getStartTime()),
                Values.instant(a.getEndTime()), a.getDurationInMillis(), a.getDeleteReason())).toList();
        List<SequenceFlowTracker.Taken> recorded = flows.flowsOf(h.getId());
        if (!recorded.isEmpty()) {
            List<InstanceDtos.InstanceFlowStep> taken = recorded.stream().map(t -> new InstanceDtos.InstanceFlowStep(t.flowId(), t.sourceActivityId(),
                    t.targetActivityId(), t.order(), t.time())).toList();
            return new InstanceDtos.InstancePath(steps, taken, "recorded");
        }
        return new InstanceDtos.InstancePath(steps, infer(model, h.getProcessDefinitionKey(), activities), "inferred");
    }

    /** Flows between two visited activities, for an instance whose flows this JVM did not see. */
    private static List<InstanceDtos.InstanceFlowStep> infer(BpmnModel model, String processKey, List<HistoricActivityInstance> activities) {
        if (model == null) {
            return List.of();
        }
        Set<String> visited = activities.stream().map(HistoricActivityInstance::getActivityId).collect(Collectors.toCollection(LinkedHashSet::new));
        org.activiti.bpmn.model.Process process = model.getProcessById(processKey);
        if (process == null) {
            return List.of();
        }
        List<InstanceDtos.InstanceFlowStep> taken = new ArrayList<>();
        collectFlows(process, visited, taken);
        return taken;
    }

    private static void collectFlows(FlowElementsContainer container, Set<String> visited, List<InstanceDtos.InstanceFlowStep> out) {
        for (FlowElement element : container.getFlowElements()) {
            if (element instanceof SequenceFlow flow && visited.contains(flow.getSourceRef()) && visited.contains(flow.getTargetRef())) {
                out.add(new InstanceDtos.InstanceFlowStep(flow.getId(), flow.getSourceRef(), flow.getTargetRef(), null, null));
            }
            if (element instanceof FlowElementsContainer nested) {
                collectFlows(nested, visited, out);
            }
        }
    }

    private List<InstanceDtos.InstanceVariable> variables(HistoricProcessInstance h, boolean running) {
        List<InstanceDtos.InstanceVariable> out = new ArrayList<>();
        if (running) {
            Map<String, org.activiti.engine.impl.persistence.entity.VariableInstance> live = runtime.getVariableInstances(h.getId());
            new java.util.TreeMap<>(live).forEach((name, v) -> out.add(new InstanceDtos.InstanceVariable(name, v.getTypeName(), Values.json(mapper, v.getValue()))));
            return out;
        }
        Map<String, InstanceDtos.InstanceVariable> byName = new LinkedHashMap<>();
        for (HistoricVariableInstance v : history.createHistoricVariableInstanceQuery().processInstanceId(h.getId()).list()) {
            // variables of child executions (multi-instance element variables, loop counters) are not process variables
            boolean processLevel = !(v instanceof HistoricVariableInstanceEntity e) || h.getId().equals(e.getExecutionId());
            if (v.getTaskId() == null && processLevel) {
                byName.put(v.getVariableName(), new InstanceDtos.InstanceVariable(v.getVariableName(), v.getVariableTypeName(), Values.json(mapper, v.getValue())));
            }
        }
        out.addAll(byName.values().stream().sorted(Comparator.comparing(InstanceDtos.InstanceVariable::name)).toList());
        return out;
    }

    private List<InstanceDtos.InstanceExecution> executions(String id, BpmnModel model) {
        List<InstanceDtos.InstanceExecution> out = new ArrayList<>();
        for (Execution e : runtime.createExecutionQuery().processInstanceId(id).list()) {
            if (e.getActivityId() == null) {
                continue;
            }
            FlowElement element = model == null ? null : model.getFlowElement(e.getActivityId());
            String type = element == null ? null : Character.toLowerCase(element.getClass().getSimpleName().charAt(0)) + element.getClass().getSimpleName().substring(1);
            out.add(new InstanceDtos.InstanceExecution(e.getId(), e.getParentId(), e.getActivityId(), element == null ? null : element.getName(), type, e.isSuspended()));
        }
        return out;
    }

    private BpmnModel modelOf(String definitionId) {
        try {
            return repository.getBpmnModel(definitionId);
        } catch (RuntimeException e) {
            return null;
        }
    }

    static int compareIds(String a, String b) {
        try {
            return Long.compare(Long.parseLong(a), Long.parseLong(b));
        } catch (NumberFormatException e) {
            return a.compareTo(b);
        }
    }
}
