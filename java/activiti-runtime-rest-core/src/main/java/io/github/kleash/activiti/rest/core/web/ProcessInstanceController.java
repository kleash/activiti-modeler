package io.github.kleash.activiti.rest.core.web;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.RestCoreProperties;
import io.github.kleash.activiti.rest.core.dto.InstanceDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.AccessPolicy;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.InstanceService;
import io.github.kleash.activiti.rest.core.service.Paging;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RuntimeRestController
@RequestMapping(ApiPaths.BASE + "/process-instances")
@Tag(name = "Process instances", description = "Start, observe and manage process instances")
public class ProcessInstanceController {

    private final InstanceService instances;
    private final RestCoreProperties properties;
    private final AccessPolicy policy;

    public ProcessInstanceController(InstanceService instances, RestCoreProperties properties, AccessPolicy policy) {
        this.instances = instances;
        this.properties = properties;
        this.policy = policy;
    }

    @PostMapping
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "startProcessInstance", summary = "Start an instance by key, definition id or message, as the authenticated user (ProcessRuntime)")
    public ResponseEntity<InstanceDtos.InstanceDetail> start(@RequestBody InstanceDtos.StartRequest request) {
        InstanceDtos.InstanceDetail started = instances.start(request);
        return ResponseEntity.status(HttpStatus.CREATED).header("Location", "process-instances/" + started.id()).body(started);
    }

    @GetMapping
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listProcessInstances", summary = "Instances, newest first; running and ended")
    public PageDto<InstanceDtos.InstanceSummary> list(
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String definitionKey,
            @RequestParam(required = false) String definitionId,
            @RequestParam(required = false) String businessKey,
            @RequestParam(required = false) String startedBy,
            @RequestParam(required = false) String parentId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return instances.list(Paging.of(page, size, properties), state, definitionKey, definitionId, businessKey, startedBy, parentId);
    }

    @GetMapping("/{id}")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessInstance",
            summary = "State, active activities, path (activities and sequence flows taken), variables, tasks, jobs, executions and child instances")
    public InstanceDtos.InstanceDetail get(@PathVariable String id) {
        return instances.detail(id);
    }

    @GetMapping("/{id}/path")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessInstancePath", summary = "The activities an instance entered and the sequence flows it took")
    public InstanceDtos.InstancePath path(@PathVariable String id) {
        return instances.path(id);
    }

    @GetMapping("/{id}/variables")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessInstanceVariables", summary = "Process variables: live while running, from history afterwards")
    public List<InstanceDtos.InstanceVariable> variables(@PathVariable String id) {
        return instances.variables(id);
    }

    @GetMapping("/{id}/variables/history")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessInstanceVariableHistory", summary = "Every update of every process variable")
    public List<InstanceDtos.InstanceVariableUpdate> variableHistory(@PathVariable String id) {
        return instances.variableHistory(id);
    }

    @PutMapping("/{id}/variables")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "setProcessInstanceVariables", summary = "Set process variables of a running instance")
    public void setVariables(@PathVariable String id, @RequestBody InstanceDtos.VariablesRequest request) {
        instances.setVariables(id, request.variables());
    }

    @DeleteMapping("/{id}/variables")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "removeProcessInstanceVariables", summary = "Remove process variables of a running instance (repeat the name parameter)")
    public void removeVariables(@PathVariable String id, @RequestParam(name = "name") List<String> names) {
        instances.removeVariables(id, names);
    }

    @PostMapping("/{id}/suspend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "suspendProcessInstance", summary = "Suspend a running instance")
    public void suspend(@PathVariable String id) {
        instances.suspend(id);
    }

    @PostMapping("/{id}/activate")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "activateProcessInstance", summary = "Activate a suspended instance")
    public void activate(@PathVariable String id) {
        instances.activate(id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "deleteProcessInstance",
            summary = "Cancel a running instance; with purgeHistory=true (admin only) delete the history of an ended one")
    public void delete(@PathVariable String id, @RequestParam(required = false) String reason,
                       @RequestParam(required = false, defaultValue = "false") boolean purgeHistory) {
        if (purgeHistory) {
            if (!policy.grants(SecurityContextHolder.getContext().getAuthentication(), Access.ADMIN)) {
                throw new AccessDeniedException("Deleting history needs the admin access level (" + policy.authoritiesFor(Access.ADMIN) + ")");
            }
            instances.purgeHistory(id);
        } else {
            instances.cancel(id, reason);
        }
    }
}
