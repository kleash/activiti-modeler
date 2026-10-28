package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Process instances, their path, variables and the things that wait inside them. */
public final class InstanceDtos {

    private InstanceDtos() {
    }

    /**
     * Start an instance, by definition key, by definition id or by message. The acting user is the authenticated
     * principal; the body has no user field and one is refused.
     *
     * @param processKey          key of the process definition (latest version)
     * @param processDefinitionId id of a process definition
     * @param messageName         name of a message start event
     * @param businessKey         business key
     * @param name                instance name
     * @param variables           start variables; names starting with an underscore are refused by the runtime
     */
    @StrictBody
    @Schema(requiredProperties = {})
    public record StartRequest(String processKey, String processDefinitionId, String messageName, String businessKey, String name,
                               Map<String, Object> variables) {
    }

    /** Body of {@code PUT /process-instances/{id}/variables}. */
    @StrictBody
    public record VariablesRequest(Map<String, Object> variables) {
    }

    /**
     * @param id                      instance id
     * @param processDefinitionId     definition id
     * @param processDefinitionKey    definition key
     * @param processDefinitionName   definition name
     * @param processDefinitionVersion definition version
     * @param businessKey             business key
     * @param name                    instance name
     * @param state                   {@code ACTIVE}, {@code SUSPENDED}, {@code COMPLETED} or {@code CANCELLED}
     * @param startTime               when it started
     * @param endTime                 when it ended
     * @param startUserId             who started it
     * @param superProcessInstanceId  the parent instance of a call activity
     * @param deleteReason            why it was deleted or terminated
     */
    @Schema(requiredProperties = {"id", "processDefinitionId", "processDefinitionKey", "state"})
    public record InstanceSummary(
            String id,
            String processDefinitionId,
            String processDefinitionKey,
            String processDefinitionName,
            Integer processDefinitionVersion,
            String businessKey,
            String name,
            String state,
            Instant startTime,
            Instant endTime,
            String startUserId,
            String superProcessInstanceId,
            String deleteReason) {
    }

    /**
     * Everything about one instance, running or ended.
     *
     * @param id                      instance id
     * @param processDefinitionId     definition id
     * @param processDefinitionKey    definition key
     * @param processDefinitionName   definition name
     * @param processDefinitionVersion definition version
     * @param deploymentId            the deployment
     * @param businessKey             business key
     * @param name                    instance name
     * @param state                   {@code ACTIVE}, {@code SUSPENDED}, {@code COMPLETED} or {@code CANCELLED}
     * @param startTime               when it started
     * @param endTime                 when it ended
     * @param durationMillis          duration of an ended instance
     * @param startUserId             who started it
     * @param startActivityId         the start event
     * @param endActivityId           the end event (or element) that ended it
     * @param deleteReason            why it was deleted or terminated
     * @param superProcessInstanceId  the parent instance of a call activity
     * @param activeActivityIds       activities with a token now
     * @param path                    what was visited
     * @param variables               process variables (live while running, history afterwards)
     * @param tasks                   open tasks of this instance
     * @param jobs                    executable, timer, suspended and dead-letter jobs of this instance
     * @param executions              waiting executions (the ids {@code POST /executions/{id}/trigger} takes)
     * @param children                instances started by call activities of this one
     */
    @Schema(requiredProperties = {"id", "processDefinitionId", "processDefinitionKey", "deploymentId", "state", "activeActivityIds", "path", "variables", "tasks", "jobs", "executions", "children"})
    public record InstanceDetail(
            String id,
            String processDefinitionId,
            String processDefinitionKey,
            String processDefinitionName,
            Integer processDefinitionVersion,
            String deploymentId,
            String businessKey,
            String name,
            String state,
            Instant startTime,
            Instant endTime,
            Long durationMillis,
            String startUserId,
            String startActivityId,
            String endActivityId,
            String deleteReason,
            String superProcessInstanceId,
            List<String> activeActivityIds,
            InstancePath path,
            List<InstanceVariable> variables,
            List<TaskDtos.Task> tasks,
            List<JobDtos.Job> jobs,
            List<InstanceExecution> executions,
            List<InstanceSummary> children) {
    }

    /**
     * What an instance visited, from history.
     *
     * @param activities          activity instances in the order they were entered
     * @param sequenceFlows       sequence flows taken
     * @param sequenceFlowsSource {@code recorded}: taken flows seen by the runtime while this JVM ran;
     *                            {@code inferred}: derived from the model and the visited activities (instances this JVM did not see,
     *                            for example from before a restart; a flow between two visited activities is reported as taken)
     */
    @Schema(requiredProperties = {"activities", "sequenceFlows", "sequenceFlowsSource"})
    public record InstancePath(List<InstanceActivityStep> activities, List<InstanceFlowStep> sequenceFlows, String sequenceFlowsSource) {
    }

    /**
     * @param activityId             BPMN id of the element
     * @param activityName           its name
     * @param activityType           BPMN element type as the engine names it ({@code userTask}, {@code exclusiveGateway}, ...)
     * @param executionId            the execution that entered it
     * @param taskId                 the task of a user task
     * @param assignee               the assignee of a user task
     * @param calledProcessInstanceId the instance a call activity started
     * @param startTime              when it was entered
     * @param endTime                when it was left; {@code null} while active
     * @param durationMillis         time spent
     * @param deleteReason           why it was left without completing
     */
    @Schema(requiredProperties = {"activityId", "activityType", "startTime"})
    public record InstanceActivityStep(
            String activityId,
            String activityName,
            String activityType,
            String executionId,
            String taskId,
            String assignee,
            String calledProcessInstanceId,
            Instant startTime,
            Instant endTime,
            Long durationMillis,
            String deleteReason) {
    }

    /**
     * @param id               sequence flow id
     * @param sourceActivityId element the flow leaves
     * @param targetActivityId element the flow enters
     * @param order            position in the order the flows were taken (recorded flows only)
     * @param time             when it was taken (recorded flows only)
     */
    @Schema(requiredProperties = {"id"})
    public record InstanceFlowStep(String id, String sourceActivityId, String targetActivityId, Long order, Instant time) {
    }

    /**
     * @param name  variable name
     * @param type  the engine's variable type ({@code string}, {@code integer}, {@code json}, ...)
     * @param value the value as JSON (dates as ISO text)
     */
    @Schema(requiredProperties = {"name"})
    public record InstanceVariable(String name, String type, Object value) {
    }

    /**
     * One update of a variable, from history.
     *
     * @param name        variable name
     * @param type        engine variable type
     * @param value       value after the update
     * @param revision    revision of the variable
     * @param time        when it was set
     * @param executionId execution scope
     * @param taskId      task scope
     */
    @Schema(requiredProperties = {"name", "revision"})
    public record InstanceVariableUpdate(String name, String type, Object value, int revision, Instant time, String executionId, String taskId) {
    }

    /**
     * @param id           execution id
     * @param parentId     parent execution
     * @param activityId   the element it waits at
     * @param activityName its name
     * @param activityType the element type ({@code receiveTask}, {@code intermediateCatchEvent}, ...)
     * @param suspended    whether it is suspended
     */
    @Schema(requiredProperties = {"id", "activityId", "suspended"})
    public record InstanceExecution(String id, String parentId, String activityId, String activityName, String activityType, boolean suspended) {
    }
}
