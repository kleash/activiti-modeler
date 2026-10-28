package io.github.kleash.activiti.rest.core.web;

import org.activiti.api.task.model.builders.TaskPayloadBuilder;
import org.activiti.api.task.runtime.TaskAdminRuntime;
import org.activiti.api.task.runtime.TaskRuntime;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.RestCoreProperties;
import io.github.kleash.activiti.rest.core.dto.PageDto;
import io.github.kleash.activiti.rest.core.dto.TaskDtos;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.AccessPolicy;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.Paging;
import io.github.kleash.activiti.rest.core.service.TaskViews;
import io.github.kleash.activiti.rest.core.service.Values;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * User tasks. Claim, release, assign and complete go through {@code TaskRuntime} as the authenticated principal: the runtime's own
 * rules apply (a task is visible to its assignee, owner, candidate users and the members of candidate groups; completing needs the
 * claim). A principal with the admin access level reassigns any task through {@code TaskAdminRuntime}.
 */
@RuntimeRestController
@RequestMapping(ApiPaths.BASE + "/tasks")
@Tag(name = "Tasks", description = "User tasks, worked on as the authenticated user")
public class TaskController {

    private final TaskViews views;
    private final TaskRuntime taskRuntime;
    private final ObjectProvider<TaskAdminRuntime> adminRuntime;
    private final AccessPolicy policy;
    private final RestCoreProperties properties;

    public TaskController(TaskViews views, TaskRuntime taskRuntime, ObjectProvider<TaskAdminRuntime> adminRuntime, AccessPolicy policy,
                          RestCoreProperties properties) {
        this.views = views;
        this.taskRuntime = taskRuntime;
        this.adminRuntime = adminRuntime;
        this.policy = policy;
        this.properties = properties;
    }

    @GetMapping
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listTasks", summary = "Open tasks, newest first; mine=true shows the tasks TaskRuntime shows the authenticated user")
    public PageDto<TaskDtos.Task> list(
            @RequestParam(required = false) String processInstanceId,
            @RequestParam(required = false) String assignee,
            @RequestParam(required = false) String candidateUser,
            @RequestParam(required = false) String candidateGroup,
            @RequestParam(required = false, defaultValue = "false") boolean unassigned,
            @RequestParam(required = false) String nameLike,
            @RequestParam(required = false) String taskDefinitionKey,
            @RequestParam(required = false, defaultValue = "false") boolean mine,
            @RequestParam(required = false, defaultValue = "false") boolean candidates,
            @RequestParam(required = false, defaultValue = "false") boolean variables,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return views.list(Paging.of(page, size, properties), new TaskViews.Filter(processInstanceId, assignee, candidateUser, candidateGroup, unassigned,
                nameLike, taskDefinitionKey, mine, candidates, variables));
    }

    @GetMapping("/{id}")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getTask", summary = "One open task with its candidates and local variables")
    public TaskDtos.Task get(@PathVariable String id) {
        return views.detail(id);
    }

    @PostMapping("/{id}/claim")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "claimTask", summary = "Claim a task for the authenticated user")
    public TaskDtos.Task claim(@PathVariable String id) {
        taskRuntime.claim(TaskPayloadBuilder.claim().withTaskId(id).build());
        return views.detail(id);
    }

    @PostMapping("/{id}/release")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "releaseTask", summary = "Release a task the authenticated user has claimed")
    public TaskDtos.Task release(@PathVariable String id) {
        taskRuntime.release(TaskPayloadBuilder.release().withTaskId(id).build());
        return views.detail(id);
    }

    @PostMapping("/{id}/assign")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "assignTask",
            summary = "Assign a task to a candidate user: the assignee hands it over (TaskRuntime); an admin reassigns any task (TaskAdminRuntime)")
    public TaskDtos.Task assign(@PathVariable String id, @RequestBody TaskDtos.AssignRequest request) {
        if (request.assignee() == null || request.assignee().isBlank()) {
            throw new IllegalArgumentException("assignee is required");
        }
        TaskAdminRuntime admin = adminRuntime.getIfAvailable();
        if (admin != null && policy.grants(SecurityContextHolder.getContext().getAuthentication(), Access.ADMIN)) {
            admin.assign(TaskPayloadBuilder.assign().withTaskId(id).withAssignee(request.assignee()).build());
        } else {
            taskRuntime.assign(TaskPayloadBuilder.assign().withTaskId(id).withAssignee(request.assignee()).build());
        }
        return views.detail(id);
    }

    @PostMapping("/{id}/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "completeTask",
            summary = "Complete a task the authenticated user has claimed; the variables are local to the task and reach the process through the output mapping")
    public void complete(@PathVariable String id, @RequestBody(required = false) TaskDtos.CompleteRequest request) {
        taskRuntime.complete(TaskPayloadBuilder.complete().withTaskId(id)
                .withVariables(Values.nonNull(request == null ? null : request.variables())).build());
    }
}
