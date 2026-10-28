package io.github.kleash.activiti.scenario.jobs;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BooleanSupplier;

import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.ActivitiOptimisticLockingException;
import org.activiti.engine.ManagementService;
import org.activiti.engine.runtime.Job;

/**
 * Job driver for an engine whose async executor is <em>on</em> (the modeler server, a host application). The executor
 * does the executing; the driver makes timers due and waits for the executor to settle, with a timeout.
 */
public final class ExecutorJobDriver extends AbstractJobDriver {

    private static final long POLL_MS = 20;

    /** How often one dead-letter job is revived after an optimistic locking failure before the failure is reported. */
    static final int MAX_RECOVERIES = 5;

    private static final int REVIVED_RETRIES = 3;

    private final long defaultTimeoutMs;

    private final ManagementService management;

    public ExecutorJobDriver(ManagementService management, JobSupport jobs, long defaultTimeoutMs) {
        super(jobs);
        this.management = management;
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    @Override
    public Mode mode() {
        return Mode.EXECUTOR;
    }

    @Override
    public int fireTimer(InstanceScope scope, String activityId, boolean all) {
        List<Job> timers = jobs.at(jobs.timerJobs(scope), activityId);
        if (timers.isEmpty()) {
            throw new JobDrivingException("No timer job at activity '" + activityId + "' in the scenario's instance tree. "
                    + "Timer jobs: " + jobs.describe(jobs.timerJobs(scope)) + ", executable jobs: " + jobs.describe(jobs.executableJobs(scope)));
        }
        List<Job> toFire = all ? timers : timers.subList(0, 1);
        for (Job timer : toFire) {
            moveAndAwait(timer, activityId);
        }
        return toFire.size();
    }

    @Override
    public void fireStartTimer(String processKey, String activityId) {
        moveAndAwait(jobs.startTimerJob(processKey, activityId), activityId);
    }

    @Override
    public void awaitStartTimer(String processKey, String activityId) {
        await("the async executor to finish running the start timer of '" + activityId + "'", defaultTimeoutMs,
                () -> !jobs.startTimerIsRunning(processKey, activityId));
    }

    private void moveAndAwait(Job timer, String activityId) {
        Job executable = management.moveTimerToExecutableJob(timer.getId());
        String id = executable.getId();
        await("the async executor to run the timer job of '" + activityId + "'", defaultTimeoutMs,
                () -> management.createJobQuery().jobId(id).count() == 0);
        if (management.createDeadLetterJobQuery().jobId(id).count() > 0 || management.createTimerJobQuery().jobId(id).count() > 0) {
            throw new JobDrivingException("The timer at '" + activityId + "' fired but its job failed: "
                    + management.createDeadLetterJobQuery().jobId(id).list().stream().map(Job::getExceptionMessage).toList());
        }
    }

    /**
     * Waits until the async executor has nothing left to do for the instance tree.
     *
     * <p>Jobs can fail on the way for a reason that has nothing to do with the model. The engine hands a new asynchronous
     * job to the executor twice: with a hint after the commit and through the acquisition thread, and when both run the job at
     * once the loser (and often the winner too) fails with an optimistic locking exception. Asynchronous event jobs (an async
     * signal throw) are created with zero retries, so that single failure ends in the dead-letter table; other jobs are turned
     * into a retry timer that waits for its retry delay. The driver therefore
     * <ul>
     *   <li>makes every <b>retry timer</b> of the tree executable at once instead of waiting for its delay,</li>
     *   <li>makes every <b>timer that is due on the engine clock</b> executable at once instead of waiting for the executor's timer
     *       acquisition thread (which sleeps for its wait time and ignores a clock that was advanced meanwhile),</li>
     *   <li>moves a <b>dead-letter job whose last failure was an optimistic locking failure</b> back to the executable table
     *       (at most {@value #MAX_RECOVERIES} times per job),</li>
     * </ul>
     * and waits again, bounded by the timeout. Any other job that ends as a dead letter, or an optimistic locking failure that
     * keeps coming back, fails the step with the job's activity and the failure of its last attempt.
     */
    @Override
    public void executeJobs(InstanceScope scope, int maxRounds, long timeoutMs) {
        long timeout = timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
        Set<String> knownDeadLetters = ids(jobs.deadLetterJobs(scope));
        Map<String, Integer> recoveries = new LinkedHashMap<>();
        int madeExecutable = 0;
        long deadline = System.nanoTime() + timeout * 1_000_000L;
        int quietPolls = 0;
        while (true) {
            boolean busy = false;
            List<Job> failed = new ArrayList<>();
            for (Job dead : jobs.deadLetterJobs(scope)) {
                // An optimistic locking failure is revived even if the dead letter was there when the wait began: the race can
                // run its course before the first look. Any other dead letter that was there before is none of this wait's business.
                if (isOptimisticLockingFailure(dead) && recoveries.merge(dead.getId(), 1, Integer::sum) <= MAX_RECOVERIES
                        && reviveDeadLetter(dead)) {
                    madeExecutable++;
                    busy = true;
                } else if (!knownDeadLetters.contains(dead.getId()) || recoveries.containsKey(dead.getId())) {
                    failed.add(dead);
                }
            }
            if (!failed.isEmpty()) {
                throw new JobDrivingException("Job(s) failed until the retries were exhausted and ended as dead letter: "
                        + failed.stream().map(j -> "'" + jobs.activityOf(j) + "' (" + j.getExceptionMessage() + ")").toList()
                        + (madeExecutable == 0 ? "" : "; " + madeExecutable + " failed job(s) were made executable again while waiting"));
            }
            for (Job retry : jobs.failedTimerJobs(scope)) {
                if (makeExecutable(retry)) {
                    madeExecutable++;
                }
                busy = true;
            }
            // A timer that is due on the engine clock (the scenario advanced it) is made executable here, as the MANUAL driver does. The
            // executor's own timer acquisition thread sleeps for its wait time (ten seconds by default) and does not look at a clock that
            // jumped meanwhile, so waiting for it made a step as slow as that interval, and a step with a timeout of the same size failed.
            for (Job due : jobs.dueTimerJobs(scope)) {
                if (makeExecutable(due)) {
                    madeExecutable++;
                }
                busy = true;
            }
            busy |= !jobs.executableJobs(scope).isEmpty();
            if (!busy) {
                // two quiet polls in a row: a job that moves between the job tables while we query is seen in one of them
                if (++quietPolls >= 2) {
                    return;
                }
            } else {
                quietPolls = 0;
            }
            if (System.nanoTime() > deadline) {
                throw new JobDrivingException("Timed out after " + timeout + " ms waiting for the async executor to finish the jobs of the instance tree. "
                        + "Executable: " + jobs.describe(jobs.executableJobs(scope)) + ", retry timers: " + jobs.describe(jobs.failedTimerJobs(scope))
                        + ", due timers: " + jobs.describe(jobs.dueTimerJobs(scope)));
            }
            pause("the async executor to finish the jobs of the instance tree");
        }
    }

    private boolean isOptimisticLockingFailure(Job deadLetter) {
        String message = deadLetter.getExceptionMessage();
        if (message != null && message.contains("was updated by another transaction concurrently")) {
            return true;
        }
        try {
            String stacktrace = management.getDeadLetterJobExceptionStacktrace(deadLetter.getId());
            return stacktrace != null && stacktrace.contains("ActivitiOptimisticLockingException");
        } catch (ActivitiObjectNotFoundException e) {
            return false;
        }
    }

    /** Moves a dead-letter job back to the executable table; {@code false} when it is gone already. */
    private boolean reviveDeadLetter(Job deadLetter) {
        try {
            management.moveDeadLetterJobToExecutableJob(deadLetter.getId(), REVIVED_RETRIES);
            return true;
        } catch (ActivitiObjectNotFoundException | ActivitiOptimisticLockingException e) {
            return false;
        }
    }

    /**
     * Moves a timer to the executable table; {@code false} when someone else (the executor) got there first: the timer is gone, or the
     * executor's acquisition locked it meanwhile (an optimistic locking failure). The executable job keeps the timer's id, so when both
     * move it at once the loser can also fail on the primary key of the job table: any failure after which the timer is gone counts as
     * lost to the executor. The caller looks again on its next poll.
     */
    private boolean makeExecutable(Job timer) {
        try {
            management.moveTimerToExecutableJob(timer.getId());
            return true;
        } catch (ActivitiObjectNotFoundException | ActivitiOptimisticLockingException e) {
            return false;
        } catch (RuntimeException e) {
            if (management.createTimerJobQuery().jobId(timer.getId()).count() == 0) {
                return false;
            }
            throw e;
        }
    }

    private static Set<String> ids(List<Job> list) {
        Set<String> ids = new HashSet<>();
        list.forEach(j -> ids.add(j.getId()));
        return ids;
    }

    @Override
    public void failJobUntilDeadLetter(InstanceScope scope, String activityId, int maxAttempts, long timeoutMs) {
        long timeout = timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
        await("the job at '" + activityId + "' to reach the dead-letter table", timeout, () -> {
            if (!jobs.at(jobs.deadLetterJobs(scope), activityId).isEmpty()) {
                return true;
            }
            // Retry timers wait for their delay: make them due now so that the executor retries immediately.
            for (Job timer : jobs.at(jobs.timerJobs(scope), activityId)) {
                makeExecutable(timer);
            }
            return false;
        });
    }

    private void await(String what, long timeoutMs, BooleanSupplier condition) {
        long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new JobDrivingException("Timed out after " + timeoutMs + " ms waiting for " + what);
            }
            pause(what);
        }
    }

    private static void pause(String what) {
        try {
            Thread.sleep(POLL_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new JobDrivingException("Interrupted while waiting for " + what, e);
        }
    }
}
