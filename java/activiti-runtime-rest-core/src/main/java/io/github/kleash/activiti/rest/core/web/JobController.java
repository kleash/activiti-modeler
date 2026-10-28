package io.github.kleash.activiti.rest.core.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.RestCoreProperties;
import io.github.kleash.activiti.rest.core.dto.JobDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.JobService;
import io.github.kleash.activiti.rest.core.service.Paging;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RuntimeRestController
@RequestMapping(ApiPaths.BASE)
@Tag(name = "Jobs", description = "Jobs, timers and dead-letter jobs")
public class JobController {

    private final JobService jobs;
    private final RestCoreProperties properties;

    public JobController(JobService jobs, RestCoreProperties properties) {
        this.jobs = jobs;
        this.properties = properties;
    }

    @GetMapping("/jobs")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listJobs", summary = "Jobs of all tables (JOB, TIMER, SUSPENDED, DEADLETTER) or of one kind")
    public PageDto<JobDtos.Job> list(
            @RequestParam(required = false) JobService.Kind kind,
            @RequestParam(required = false) String processInstanceId,
            @RequestParam(required = false, defaultValue = "false") boolean withException,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return jobs.list(Paging.of(page, size, properties), kind, processInstanceId, withException);
    }

    @GetMapping("/jobs/{id}")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getJob", summary = "A job in whichever table it is, with the stack trace of its last failure")
    public JobDtos.JobDetail get(@PathVariable String id) {
        return jobs.detail(id);
    }

    @PostMapping("/jobs/{id}/execute")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "executeJob", summary = "Execute an executable job now (ManagementService.executeJob)")
    public void execute(@PathVariable String id) {
        jobs.execute(id);
    }

    @PostMapping("/jobs/{id}/retries")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "setJobRetries", summary = "Set the retries of an executable or timer job")
    public void retries(@PathVariable String id, @RequestBody JobDtos.RetriesRequest request) {
        if (request.retries() == null) {
            throw new IllegalArgumentException("retries is required");
        }
        jobs.setRetries(id, request.retries());
    }

    @PostMapping("/timers/{id}/fire")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "fireTimer", summary = "Fire a timer now: moveTimerToExecutableJob, then executeJob")
    public JobDtos.FireResult fire(@PathVariable String id) {
        return jobs.fireTimer(id);
    }

    @PostMapping("/deadletter/{id}/retry")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "retryDeadLetterJob", summary = "Move a dead-letter job back to the executable table (moveDeadLetterJobToExecutableJob)")
    public JobDtos.Job retry(@PathVariable String id, @RequestBody(required = false) JobDtos.DeadLetterRetryRequest request) {
        return jobs.retryDeadLetter(id, request == null ? null : request.retries(), request != null && Boolean.TRUE.equals(request.execute()));
    }
}
