package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** User tasks. */
public final class TaskDtos {

    private TaskDtos() {
    }

    /**
     * A user task.
     *
     * @param id                  task id
     * @param name                name
     * @param description         description
     * @param assignee            assignee
     * @param owner               owner
     * @param processInstanceId   instance
     * @param processDefinitionId definition
     * @param executionId         execution
     * @param taskDefinitionKey   the BPMN id of the user task
     * @param formKey             form key
     * @param priority            priority (the engine default is 0)
     * @param category            category
     * @param createTime          when it was created
     * @param claimTime           when it was claimed
     * @param dueDate             due date
     * @param suspended           whether the instance is suspended
     * @param parentTaskId        parent task of a sub task
     * @param candidateUsers      candidate users (detail, or list with {@code candidates=true})
     * @param candidateGroups     candidate groups (same)
     * @param localVariables      task-local variables (detail, or list with {@code variables=true})
     */
    @Schema(requiredProperties = {"id", "priority", "suspended", "createTime"})
    public record Task(
            String id,
            String name,
            String description,
            String assignee,
            String owner,
            String processInstanceId,
            String processDefinitionId,
            String executionId,
            String taskDefinitionKey,
            String formKey,
            int priority,
            String category,
            Instant createTime,
            Instant claimTime,
            Instant dueDate,
            boolean suspended,
            String parentTaskId,
            List<String> candidateUsers,
            List<String> candidateGroups,
            Map<String, Object> localVariables) {
    }

    /** Body of {@code POST /tasks/{id}/assign}: the assignee is the new assignee; the actor is the principal. */
    @StrictBody
    @Schema(requiredProperties = {"assignee"})
    public record AssignRequest(String assignee) {
    }

    /** Body of {@code POST /tasks/{id}/complete}. */
    @StrictBody
    public record CompleteRequest(Map<String, Object> variables) {
    }
}
