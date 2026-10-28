package io.github.kleash.activiti.scenario.jobs;

import java.util.List;

import org.activiti.engine.ManagementService;
import org.activiti.engine.ActivitiException;
import org.activiti.engine.runtime.Job;

/**
 * Job driver for an engine whose async executor is <em>off</em> (the verification harness). Nothing happens unless the
 * driver executes it, so scenarios are deterministic.
 */
public final class ManualJobDriver extends AbstractJobDriver {

    private final ManagementService management;

    public ManualJobDriver(ManagementService management, JobSupport jobs) {
        super(jobs);
        this.management = management;
    }

    @Override
    public Mode mode() {
        return Mode.MANUAL;
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
            run(timer, activityId);
        }
        return toFire.size();
    }

    @Override
    public void fireStartTimer(String processKey, String activityId) {
        run(jobs.startTimerJob(processKey, activityId), activityId);
    }

    private void run(Job timer, String activityId) {
        Job executable = management.moveTimerToExecutableJob(timer.getId());
        try {
            management.executeJob(executable.getId());
        } catch (RuntimeException e) {
            throw new JobDrivingException("The timer at '" + activityId + "' fired but its job failed: " + describe(e), e);
        }
    }

    @Override
    public void executeJobs(InstanceScope scope, int maxRounds, long timeoutMs) {
        for (int round = 1; round <= maxRounds; round++) {
            List<Job> due = jobs.dueTimerJobs(scope);
            for (Job timer : due) {
                management.moveTimerToExecutableJob(timer.getId());
            }
            List<Job> executable = jobs.executableJobs(scope);
            if (executable.isEmpty()) {
                return;
            }
            for (Job job : executable) {
                try {
                    management.executeJob(job.getId());
                } catch (RuntimeException e) {
                    throw new JobDrivingException("Job " + job.getId() + " at activity '" + jobs.activityOf(job) + "' failed: " + describe(e), e);
                }
            }
        }
        throw new JobDrivingException("executeJobs did not settle after " + maxRounds + " rounds; still executable: "
                + jobs.describe(jobs.executableJobs(scope)));
    }

    @Override
    public void failJobUntilDeadLetter(InstanceScope scope, String activityId, int maxAttempts, long timeoutMs) {
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            if (!jobs.at(jobs.deadLetterJobs(scope), activityId).isEmpty()) {
                return;
            }
            Job job;
            List<Job> executable = jobs.at(jobs.executableJobs(scope), activityId);
            if (!executable.isEmpty()) {
                job = executable.get(0);
            } else {
                List<Job> timers = jobs.at(jobs.timerJobs(scope), activityId);
                if (timers.isEmpty()) {
                    throw new JobDrivingException("No job at activity '" + activityId + "' to fail (attempt " + attempt + "). "
                            + "Executable jobs: " + jobs.describe(jobs.executableJobs(scope)) + ", timer jobs: " + jobs.describe(jobs.timerJobs(scope))
                            + ", dead-letter jobs: " + jobs.describe(jobs.deadLetterJobs(scope)));
                }
                job = management.moveTimerToExecutableJob(timers.get(0).getId());
            }
            try {
                management.executeJob(job.getId());
            } catch (RuntimeException e) {
                if (!(e instanceof ActivitiException)) {
                    throw e;
                }
                continue;
            }
            throw new JobDrivingException("The job at activity '" + activityId + "' succeeded on attempt " + attempt
                    + " but was expected to keep failing until it reaches the dead-letter table");
        }
        if (jobs.at(jobs.deadLetterJobs(scope), activityId).isEmpty()) {
            throw new JobDrivingException("The job at activity '" + activityId + "' did not reach the dead-letter table after "
                    + maxAttempts + " failed attempts. Timer jobs: " + jobs.describe(jobs.timerJobs(scope)));
        }
    }
}
