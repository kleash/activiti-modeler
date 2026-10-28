package io.github.kleash.activiti.rest.core.service;

import java.util.List;

import org.activiti.api.runtime.shared.security.SecurityManager;
import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.TaskService;
import org.activiti.engine.task.IdentityLink;
import org.activiti.engine.task.IdentityLinkType;
import org.activiti.engine.task.TaskInfo;
import org.activiti.engine.task.TaskQuery;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.core.dto.PageDto;
import io.github.kleash.activiti.rest.core.dto.TaskDtos;

/**
 * Read model of user tasks. A reader with the {@code read} access level sees every task, the way an operator does;
 * {@code mine} limits the list to the tasks {@code TaskRuntime} shows the principal (assignee, owner, candidate user, member of a
 * candidate group), which is what an end user's inbox is.
 */
public class TaskViews {

    private final TaskService taskService;
    private final SecurityManager security;
    private final ObjectMapper mapper;

    public TaskViews(TaskService taskService, SecurityManager security, ObjectMapper mapper) {
        this.taskService = taskService;
        this.security = security;
        this.mapper = mapper;
    }

    /** Filters of the task list. */
    public record Filter(String processInstanceId, String assignee, String candidateUser, String candidateGroup, boolean unassigned, String nameLike,
                         String taskDefinitionKey, boolean mine, boolean candidates, boolean variables) {
    }

    /** Open tasks, newest first. */
    public PageDto<TaskDtos.Task> list(Paging paging, Filter filter) {
        TaskQuery query = taskService.createTaskQuery();
        if (filter.mine()) {
            String user = security.getAuthenticatedUserId();
            List<String> groups = security.getAuthenticatedUserGroups();
            query.or().taskCandidateOrAssigned(user, groups).taskOwner(user).endOr();
        }
        if (filter.processInstanceId() != null) {
            query.processInstanceId(filter.processInstanceId());
        }
        if (filter.assignee() != null) {
            query.taskAssignee(filter.assignee());
        }
        if (filter.candidateUser() != null) {
            query.taskCandidateUser(filter.candidateUser());
        }
        if (filter.candidateGroup() != null) {
            query.taskCandidateGroup(filter.candidateGroup());
        }
        if (filter.unassigned()) {
            query.taskUnassigned();
        }
        if (filter.nameLike() != null) {
            query.taskNameLike("%" + filter.nameLike() + "%");
        }
        if (filter.taskDefinitionKey() != null) {
            query.taskDefinitionKey(filter.taskDefinitionKey());
        }
        if (filter.variables()) {
            query.includeTaskLocalVariables();
        }
        query.orderByTaskCreateTime().desc();
        List<TaskDtos.Task> items = query.listPage(paging.first(), paging.size()).stream().map(t -> dto(t, filter.candidates(), filter.variables())).toList();
        return new PageDto<>(items, paging.page(), paging.size(), query.count());
    }

    /** One task with its candidates and local variables. */
    public TaskDtos.Task detail(String id) {
        org.activiti.engine.task.Task task = taskService.createTaskQuery().taskId(id).includeTaskLocalVariables().singleResult();
        if (task == null) {
            throw new ActivitiObjectNotFoundException("No open task with id '" + id + "'", org.activiti.engine.task.Task.class);
        }
        return dto(task, true, true);
    }

    /** Open tasks of one instance. */
    List<TaskDtos.Task> ofInstance(String processInstanceId) {
        return taskService.createTaskQuery().processInstanceId(processInstanceId).includeTaskLocalVariables().orderByTaskCreateTime().asc().list().stream()
                .map(t -> dto(t, true, true)).toList();
    }

    private TaskDtos.Task dto(org.activiti.engine.task.Task t, boolean candidates, boolean variables) {
        List<String> users = null;
        List<String> groups = null;
        if (candidates) {
            List<IdentityLink> links = taskService.getIdentityLinksForTask(t.getId());
            users = links.stream().filter(l -> IdentityLinkType.CANDIDATE.equals(l.getType()) && l.getUserId() != null).map(IdentityLink::getUserId).toList();
            groups = links.stream().filter(l -> IdentityLinkType.CANDIDATE.equals(l.getType()) && l.getGroupId() != null).map(IdentityLink::getGroupId).toList();
        }
        return new TaskDtos.Task(t.getId(), t.getName(), t.getDescription(), t.getAssignee(), t.getOwner(), t.getProcessInstanceId(), t.getProcessDefinitionId(),
                t.getExecutionId(), t.getTaskDefinitionKey(), t.getFormKey(), t.getPriority(), t.getCategory(), Values.instant(t.getCreateTime()),
                Values.instant(t.getClaimTime()), Values.instant(t.getDueDate()), t.isSuspended(), t.getParentTaskId(), users, groups,
                variables ? Values.json(mapper, ((TaskInfo) t).getTaskLocalVariables()) : null);
    }
}
