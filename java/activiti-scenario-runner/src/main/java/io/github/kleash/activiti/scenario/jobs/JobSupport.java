package io.github.kleash.activiti.scenario.jobs;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import org.activiti.engine.ManagementService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.impl.jobexecutor.ProcessEventJobHandler;
import org.activiti.engine.impl.jobexecutor.TimerEventHandler;
import org.activiti.engine.impl.jobexecutor.TimerStartEventJobHandler;
import org.activiti.engine.impl.persistence.entity.EventSubscriptionEntity;
import org.activiti.engine.repository.ProcessDefinition;
import org.activiti.engine.runtime.Clock;
import org.activiti.engine.runtime.Execution;
import org.activiti.engine.runtime.Job;

/** Job queries scoped to an {@link InstanceScope}, shared by the job drivers and the scenario runner. */
public final class JobSupport {

    private final ManagementService management;
    private final RuntimeService runtime;
    private final RepositoryService repository;
    private final Clock clock;

    public JobSupport(ManagementService management, RuntimeService runtime, RepositoryService repository, Clock clock) {
        this.management = management;
        this.runtime = runtime;
        this.repository = repository;
        this.clock = clock;
    }

    /**
     * Executable (async) jobs of the scope: the jobs of its instances, plus the async event jobs of its event
     * subscriptions (see {@link #eventJobs}).
     */
    public List<Job> executableJobs(InstanceScope scope) {
        List<Job> jobs = new ArrayList<>();
        Set<String> instanceIds = scope.instanceIds();
        for (String id : instanceIds) {
            jobs.addAll(management.createJobQuery().processInstanceId(id).list());
        }
        for (Job job : eventJobs()) {
            EventSubscriptionEntity subscription = subscriptionOf(job);
            if (subscription != null && subscription.getProcessInstanceId() != null && instanceIds.contains(subscription.getProcessInstanceId())) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    /**
     * The async event jobs ({@code ProcessEventJobHandler}, created by an intermediate throw signal with
     * {@code activiti:async="true"}). The engine creates them without a process instance or execution; the event
     * subscription that the job delivers to (its handler configuration) says which instance it belongs to.
     */
    private List<Job> eventJobs() {
        return management.createJobQuery().messages().list().stream()
                .filter(j -> j.getProcessInstanceId() == null && ProcessEventJobHandler.TYPE.equals(j.getJobHandlerType()))
                .toList();
    }

    private EventSubscriptionEntity subscriptionOf(Job eventJob) {
        String subscriptionId = eventJob.getJobHandlerConfiguration();
        return management.executeCommand(commandContext -> commandContext.getEventSubscriptionEntityManager().findById(subscriptionId));
    }

    /**
     * Deletes async event jobs whose event subscription no longer exists (its instance was deleted): nothing can be
     * delivered any more, and the job would only fail when an executor picked it up.
     */
    public void deleteOrphanedEventJobs() {
        for (Job job : eventJobs()) {
            if (subscriptionOf(job) == null) {
                try {
                    management.deleteJob(job.getId());
                } catch (org.activiti.engine.ActivitiObjectNotFoundException | org.activiti.engine.ActivitiOptimisticLockingException executorGotThereFirst) {
                    // With the async executor on, the job may have been executed (or be executing) since the query: either way it is gone.
                }
            }
        }
    }

    /**
     * Timer jobs of the scope (including retry timers of failed jobs, also those of async event jobs), earliest due date
     * first.
     */
    public List<Job> timerJobs(InstanceScope scope) {
        List<Job> jobs = new ArrayList<>();
        Set<String> instanceIds = scope.instanceIds();
        for (String id : instanceIds) {
            jobs.addAll(management.createTimerJobQuery().processInstanceId(id).list());
        }
        jobs.addAll(inScope(failedEventTimerJobs(), instanceIds));
        jobs.sort(Comparator.comparing(Job::getDuedate, Comparator.nullsFirst(Comparator.<Date>naturalOrder())).thenComparing(Job::getId));
        return jobs;
    }

    /** Dead-letter jobs of the scope (also those of async event jobs, which have no process instance). */
    public List<Job> deadLetterJobs(InstanceScope scope) {
        List<Job> jobs = new ArrayList<>();
        Set<String> instanceIds = scope.instanceIds();
        for (String id : instanceIds) {
            jobs.addAll(management.createDeadLetterJobQuery().processInstanceId(id).list());
        }
        jobs.addAll(inScope(management.createDeadLetterJobQuery().list().stream()
                .filter(JobSupport::isInstanceLessEventJob).toList(), instanceIds));
        return jobs;
    }

    /**
     * Retry timers of failed jobs: a job that failed (its exception message is recorded) and was turned into a timer job
     * that waits for its retry delay. These are the jobs {@code executeJobs} makes executable in EXECUTOR mode, so that a
     * transient failure (typically an optimistic locking failure of the race between the engine's after-commit hint and the
     * acquisition thread) does not stop the wait.
     */
    public List<Job> failedTimerJobs(InstanceScope scope) {
        List<Job> jobs = new ArrayList<>();
        Set<String> instanceIds = scope.instanceIds();
        for (String id : instanceIds) {
            jobs.addAll(management.createTimerJobQuery().processInstanceId(id).withException().list());
        }
        jobs.addAll(inScope(failedEventTimerJobs(), instanceIds));
        return jobs;
    }

    private List<Job> failedEventTimerJobs() {
        return management.createTimerJobQuery().withException().list().stream().filter(JobSupport::isInstanceLessEventJob).toList();
    }

    private static boolean isInstanceLessEventJob(Job job) {
        return job.getProcessInstanceId() == null && ProcessEventJobHandler.TYPE.equals(job.getJobHandlerType());
    }

    private List<Job> inScope(List<Job> eventJobs, Set<String> instanceIds) {
        List<Job> result = new ArrayList<>();
        for (Job job : eventJobs) {
            EventSubscriptionEntity subscription = subscriptionOf(job);
            if (subscription != null && subscription.getProcessInstanceId() != null && instanceIds.contains(subscription.getProcessInstanceId())) {
                result.add(job);
            }
        }
        return result;
    }

    /** Timer jobs of the scope whose due date has passed on the engine clock. */
    public List<Job> dueTimerJobs(InstanceScope scope) {
        Date now = clock.getCurrentTime();
        return timerJobs(scope).stream().filter(j -> j.getDuedate() != null && !j.getDuedate().after(now)).toList();
    }

    /**
     * The activity a job belongs to: for timer events the {@code activityId} in the handler configuration (the id of
     * the timer event), for other jobs (async continuations, retry timers of failed jobs) the activity the job's
     * execution is at.
     */
    public String activityOf(Job job) {
        if (job.getProcessInstanceId() == null && ProcessEventJobHandler.TYPE.equals(job.getJobHandlerType())) {
            EventSubscriptionEntity subscription = subscriptionOf(job);
            return subscription != null ? subscription.getActivityId() : job.getJobHandlerConfiguration();
        }
        String configuration = job.getJobHandlerConfiguration();
        if (configuration != null && configuration.startsWith("{")) {
            String fromConfiguration = TimerEventHandler.getActivityIdFromConfiguration(configuration);
            if (fromConfiguration != null && !fromConfiguration.startsWith("{")) {
                return fromConfiguration;
            }
        }
        if (job.getExecutionId() == null) {
            return configuration;
        }
        Execution execution = runtime.createExecutionQuery().executionId(job.getExecutionId()).singleResult();
        return execution == null ? null : execution.getActivityId();
    }

    /** The jobs among {@code jobs} that belong to {@code activityId}. */
    public List<Job> at(List<Job> jobs, String activityId) {
        return jobs.stream().filter(j -> Objects.equals(activityOf(j), activityId)).toList();
    }

    /** The start timer job of timer start event {@code activityId} in the latest definition of {@code processKey}. */
    public Job startTimerJob(String processKey, String activityId) {
        List<Job> candidates = startTimerJobs(management.createTimerJobQuery().processDefinitionId(latestDefinition(processKey).getId()).list());
        List<Job> matching = candidates.stream().filter(j -> activityId.equals(activityOf(j))).toList();
        if (matching.isEmpty()) {
            throw new JobDrivingException("Process '" + processKey + "' has no start timer job for start event '" + activityId
                    + "'. Start timer jobs: " + candidates.stream().map(this::activityOf).toList());
        }
        return matching.get(0);
    }

    /**
     * Whether the start timer job of start event {@code activityId} is in the executable table: the async executor is running it
     * (it was due), and the next timer job of a cycle is created when that run ends.
     */
    public boolean startTimerIsRunning(String processKey, String activityId) {
        return startTimerJobs(management.createJobQuery().processDefinitionId(latestDefinition(processKey).getId()).list()).stream()
                .anyMatch(j -> activityId.equals(activityOf(j)));
    }

    private List<Job> startTimerJobs(List<Job> jobs) {
        return jobs.stream().filter(j -> j.getProcessInstanceId() == null && TimerStartEventJobHandler.TYPE.equals(j.getJobHandlerType())).toList();
    }

    private ProcessDefinition latestDefinition(String processKey) {
        ProcessDefinition definition = repository.createProcessDefinitionQuery().processDefinitionKey(processKey).latestVersion().singleResult();
        if (definition == null) {
            throw new JobDrivingException("No process definition with key '" + processKey + "' is deployed");
        }
        return definition;
    }

    /** {@code id@activity} for each job, for messages. */
    public String describe(List<Job> jobs) {
        return jobs.stream().map(j -> j.getId() + "@" + activityOf(j)).toList().toString();
    }
}
