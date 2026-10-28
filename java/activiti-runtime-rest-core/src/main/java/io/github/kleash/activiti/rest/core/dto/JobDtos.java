package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

/** Jobs, timers and dead-letter jobs. */
public final class JobDtos {

    private JobDtos() {
    }

    /**
     * A job in any of the engine's job tables.
     *
     * @param id                  job id
     * @param kind                {@code JOB} (executable, in the job table), {@code TIMER} (waits for its due date, including retry timers of
     *                            failed jobs), {@code SUSPENDED} or {@code DEADLETTER} (retries exhausted)
     * @param jobType             {@code timer} or {@code message}
     * @param processInstanceId   the instance; async event jobs (an async signal throw) have none
     * @param executionId         the execution
     * @param processDefinitionId the definition
     * @param activityId          the element the job belongs to
     * @param handlerType         the job handler ({@code async-continuation}, {@code timer-transition}, {@code event}, ...)
     * @param dueDate             when it is due
     * @param retries             retries left
     * @param exceptionMessage    the message of the last failure
     * @param exclusive           whether it is exclusive per instance
     */
    @Schema(requiredProperties = {"id", "kind", "retries", "exclusive"})
    public record Job(
            String id,
            String kind,
            String jobType,
            String processInstanceId,
            String executionId,
            String processDefinitionId,
            String activityId,
            String handlerType,
            Instant dueDate,
            int retries,
            String exceptionMessage,
            boolean exclusive) {
    }

    /**
     * A job with the stack trace of its last failure.
     *
     * @param job        the job
     * @param stacktrace stack trace of the last failure, {@code null} when it never failed
     */
    @Schema(requiredProperties = {"job"})
    public record JobDetail(Job job, String stacktrace) {
    }

    /** Body of {@code POST /jobs/{id}/retries}. */
    @StrictBody
    @Schema(requiredProperties = {"retries"})
    public record RetriesRequest(Integer retries) {
    }

    /** Body of {@code POST /deadletter/{id}/retry}. */
    @StrictBody
    public record DeadLetterRetryRequest(Integer retries, Boolean execute) {
    }

    /**
     * Outcome of firing a timer.
     *
     * @param timerJobId      the timer job that was made executable
     * @param executableJobId the executable job it became (a timer job gets a new id when it is moved)
     * @param executedBy      {@code request}: executed during the request; {@code executor}: the async executor got it first
     */
    @Schema(requiredProperties = {"timerJobId", "executableJobId", "executedBy"})
    public record FireResult(String timerJobId, String executableJobId, String executedBy) {
    }
}
