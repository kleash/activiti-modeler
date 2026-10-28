package io.github.kleash.activiti.rest.core.service;

import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.ActivitiOptimisticLockingException;
import org.activiti.engine.ManagementService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.impl.jobexecutor.TimerEventHandler;
import org.activiti.engine.runtime.Execution;
import org.activiti.engine.runtime.Job;

import io.github.kleash.activiti.rest.core.dto.JobDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;

/** Jobs, timers and dead-letter jobs: read them, execute them, fire timers, revive dead letters. */
public class JobService {

    /** The four job tables of the engine. */
    public enum Kind { JOB, TIMER, SUSPENDED, DEADLETTER }

    private final ManagementService management;
    private final RuntimeService runtime;

    public JobService(ManagementService management, RuntimeService runtime) {
        this.management = management;
        this.runtime = runtime;
    }

    /**
     * Jobs of one table or, without {@code kind}, of all four (executable first, then timers, suspended and dead letters),
     * optionally of one process instance, with failures only.
     */
    public PageDto<JobDtos.Job> list(Paging paging, Kind kind, String processInstanceId, boolean withException) {
        List<Kind> kinds = kind == null ? List.of(Kind.JOB, Kind.TIMER, Kind.SUSPENDED, Kind.DEADLETTER) : List.of(kind);
        long total = 0;
        long skip = paging.first();
        List<JobDtos.Job> items = new ArrayList<>();
        for (Kind k : kinds) {
            long count = count(k, processInstanceId, withException);
            total += count;
            if (skip >= count) {
                skip -= count;
                continue;
            }
            int want = paging.size() - items.size();
            if (want > 0) {
                for (Job job : page(k, processInstanceId, withException, (int) skip, want)) {
                    items.add(dto(job, k));
                }
                skip = 0;
            }
        }
        return new PageDto<>(items, paging.page(), paging.size(), total);
    }

    /** One job in whichever table it is, with the stack trace of its last failure. */
    public JobDtos.JobDetail detail(String id) {
        for (Kind k : Kind.values()) {
            Job job = find(k, id);
            if (job != null) {
                return new JobDtos.JobDetail(dto(job, k), stacktrace(k, id));
            }
        }
        throw new ActivitiObjectNotFoundException("No job with id '" + id + "' in the job, timer, suspended or dead-letter table", Job.class);
    }

    /** Executes an executable job now (it must be in the job table, not a timer waiting for its date). */
    public void execute(String id) {
        if (find(Kind.JOB, id) == null) {
            Kind where = locate(id);
            throw new ActivitiObjectNotFoundException("Job '" + id + "' is not executable"
                    + (where == null ? ": there is no such job" : ": it is a " + where + " job; fire a timer with POST /timers/{id}/fire, revive a dead letter with POST /deadletter/{id}/retry"), Job.class);
        }
        management.executeJob(id);
    }

    /** Sets the retries of an executable or timer job. */
    public void setRetries(String id, int retries) {
        if (retries < 0) {
            throw new IllegalArgumentException("retries must be 0 or more");
        }
        Kind where = locate(id);
        if (where == Kind.JOB) {
            management.setJobRetries(id, retries);
        } else if (where == Kind.TIMER) {
            management.setTimerJobRetries(id, retries);
        } else if (where == Kind.DEADLETTER) {
            throw new IllegalArgumentException("Job '" + id + "' is a dead letter; revive it with POST /deadletter/{id}/retry, which sets the retries");
        } else {
            throw new ActivitiObjectNotFoundException("No executable or timer job with id '" + id + "'", Job.class);
        }
    }

    /**
     * Fires a timer now: moves the timer job to the executable table ({@code moveTimerToExecutableJob}; the executable job
     * has a new id) and executes it. When the async executor is running it may take the job between the two steps; the
     * timer has fired then all the same, and the result says so.
     */
    public JobDtos.FireResult fireTimer(String timerJobId) {
        Job executable = management.moveTimerToExecutableJob(timerJobId);
        try {
            management.executeJob(executable.getId());
            return new JobDtos.FireResult(timerJobId, executable.getId(), "request");
        } catch (ActivitiObjectNotFoundException | ActivitiOptimisticLockingException e) {
            // the executor (or another caller) executed the job first
            return new JobDtos.FireResult(timerJobId, executable.getId(), "executor");
        }
    }

    /**
     * Moves a dead-letter job back to the executable table with {@code retries} retries (default 3)
     * ({@code moveDeadLetterJobToExecutableJob}); the async executor picks it up, or it is executed right away with {@code execute}.
     */
    public JobDtos.Job retryDeadLetter(String deadLetterJobId, Integer retries, boolean execute) {
        Job revived = management.moveDeadLetterJobToExecutableJob(deadLetterJobId, retries == null ? 3 : retries);
        if (execute) {
            try {
                management.executeJob(revived.getId());
            } catch (ActivitiObjectNotFoundException | ActivitiOptimisticLockingException e) {
                // taken by the executor first
            }
        }
        return dto(revived, Kind.JOB);
    }

    // ---- queries -------------------------------------------------------------------------------------------------------

    /** All jobs of one process instance, over the four tables. */
    List<JobDtos.Job> ofInstance(String processInstanceId) {
        List<JobDtos.Job> jobs = new ArrayList<>();
        for (Kind k : Kind.values()) {
            for (Job job : page(k, processInstanceId, false, 0, Integer.MAX_VALUE)) {
                jobs.add(dto(job, k));
            }
        }
        return jobs;
    }

    private long count(Kind kind, String instance, boolean withException) {
        return switch (kind) {
            case JOB -> { var q = management.createJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); yield q.count(); }
            case TIMER -> { var q = management.createTimerJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); yield q.count(); }
            case SUSPENDED -> { var q = management.createSuspendedJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); yield q.count(); }
            case DEADLETTER -> { var q = management.createDeadLetterJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); yield q.count(); }
        };
    }

    private List<? extends Job> page(Kind kind, String instance, boolean withException, int first, int size) {
        return switch (kind) {
            case JOB -> { var q = management.createJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); q.orderByJobDuedate().asc(); yield q.listPage(first, size); }
            case TIMER -> { var q = management.createTimerJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); q.orderByJobDuedate().asc(); yield q.listPage(first, size); }
            case SUSPENDED -> { var q = management.createSuspendedJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); q.orderByJobDuedate().asc(); yield q.listPage(first, size); }
            case DEADLETTER -> { var q = management.createDeadLetterJobQuery(); if (instance != null) q.processInstanceId(instance); if (withException) q.withException(); q.orderByJobDuedate().asc(); yield q.listPage(first, size); }
        };
    }

    private Job find(Kind kind, String id) {
        return switch (kind) {
            case JOB -> management.createJobQuery().jobId(id).singleResult();
            case TIMER -> management.createTimerJobQuery().jobId(id).singleResult();
            case SUSPENDED -> management.createSuspendedJobQuery().jobId(id).singleResult();
            case DEADLETTER -> management.createDeadLetterJobQuery().jobId(id).singleResult();
        };
    }

    private Kind locate(String id) {
        for (Kind k : Kind.values()) {
            if (find(k, id) != null) {
                return k;
            }
        }
        return null;
    }

    private String stacktrace(Kind kind, String id) {
        return switch (kind) {
            case JOB -> management.getJobExceptionStacktrace(id);
            case TIMER -> management.getTimerJobExceptionStacktrace(id);
            case SUSPENDED -> management.getSuspendedJobExceptionStacktrace(id);
            case DEADLETTER -> management.getDeadLetterJobExceptionStacktrace(id);
        };
    }

    private JobDtos.Job dto(Job job, Kind kind) {
        return new JobDtos.Job(job.getId(), kind.name(), job.getJobType(), job.getProcessInstanceId(), job.getExecutionId(),
                job.getProcessDefinitionId(), activityOf(job), job.getJobHandlerType(), Values.instant(job.getDuedate()), job.getRetries(),
                job.getExceptionMessage(), job.isExclusive());
    }

    /** The element a job belongs to: the timer event named in a timer's handler configuration, else the activity its execution waits at. */
    private String activityOf(Job job) {
        String configuration = job.getJobHandlerConfiguration();
        if (configuration != null && configuration.startsWith("{")) {
            try {
                String fromConfiguration = TimerEventHandler.getActivityIdFromConfiguration(configuration);
                if (fromConfiguration != null && !fromConfiguration.startsWith("{")) {
                    return fromConfiguration;
                }
            } catch (RuntimeException e) {
                // not a timer configuration
            }
        }
        if (job.getExecutionId() == null) {
            return null;
        }
        Execution execution = runtime.createExecutionQuery().executionId(job.getExecutionId()).singleResult();
        return execution == null ? null : execution.getActivityId();
    }
}
