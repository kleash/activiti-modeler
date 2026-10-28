package io.github.kleash.activiti.scenario.jobs;

/**
 * Drives timers and asynchronous jobs of a scenario's instance tree (docs/adr/0005-scenario-format.md, "Job
 * driving"). Two implementations exist: {@link ManualJobDriver} for an engine whose async executor is off and
 * {@link ExecutorJobDriver} for an engine whose async executor is running.
 */
public interface JobDriver {

    /** Which kind of engine the driver is for. */
    enum Mode { MANUAL, EXECUTOR }

    Mode mode();

    /**
     * Fires the timer job(s) of the timer event {@code activityId}: moves the timer job to the executable table and
     * executes it (MANUAL) or waits until the executor has consumed it (EXECUTOR).
     *
     * @param all fire every matching timer job instead of the earliest one
     * @return the number of timers fired
     * @throws JobDrivingException when there is no such timer or its execution fails
     */
    int fireTimer(InstanceScope scope, String activityId, boolean all);

    /**
     * Fires the start timer job of the timer start event {@code activityId} in the latest definition of
     * {@code processKey}. The caller finds the instance it created.
     */
    void fireStartTimer(String processKey, String activityId);

    /**
     * Waits until the start timer job of {@code activityId} is not running (EXECUTOR: the executor runs a start timer that is due, and a
     * cycle's next timer job exists only after that run), so that the caller can tell its own instance from the one that run created.
     */
    default void awaitStartTimer(String processKey, String activityId) {
    }

    /**
     * Runs all due work of the instance tree: timers whose due date has passed on the engine clock (MANUAL: moved
     * to executable here; EXECUTOR: picked up by the executor) and executable jobs, until none are left.
     *
     * @param maxRounds  bound of the loop (MANUAL)
     * @param timeoutMs  how long to wait for the executor (EXECUTOR)
     */
    void executeJobs(InstanceScope scope, int maxRounds, long timeoutMs);

    /**
     * Lets the job at {@code activityId} fail until its retries are exhausted and it becomes a dead-letter job.
     * MANUAL: executes it, then moves each retry timer to executable and executes it again. EXECUTOR: moves retry
     * timers to executable and waits for the executor to fail them.
     */
    void failJobUntilDeadLetter(InstanceScope scope, String activityId, int maxAttempts, long timeoutMs);
}
