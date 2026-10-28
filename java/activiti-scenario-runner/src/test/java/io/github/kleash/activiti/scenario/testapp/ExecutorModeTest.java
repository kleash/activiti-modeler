package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.activiti.engine.ManagementService;
import org.activiti.engine.impl.jobexecutor.TimerStartEventJobHandler;
import org.activiti.engine.runtime.Job;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import io.github.kleash.activiti.scenario.jobs.ExecutorJobDriver;
import io.github.kleash.activiti.scenario.jobs.JobDriver;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;

/**
 * The same job steps against an engine whose async executor is running (EXECUTOR mode): the driver makes timers due and
 * waits for the executor instead of executing jobs itself.
 */
@SpringBootTest(properties = {
        "spring.activiti.async-executor-activate=true",
        "spring.datasource.url=jdbc:h2:mem:runner-executor;DB_CLOSE_DELAY=-1",
        "spring.activiti.async-executor.default-timer-job-acquire-wait-time-in-millis=100",
        "spring.activiti.async-executor.default-async-job-acquire-wait-time-in-millis=100",
        "activiti.scenario.executor-timeout=20s"
})
class ExecutorModeTest extends ScenarioRunnerTestBase {

    @Autowired JobDriver driver;

    @Autowired ManagementService management;

    @Test
    void theDriverFollowsTheAsyncExecutorSetting() {
        assertThat(driver).isInstanceOf(ExecutorJobDriver.class);
        assertThat(driver.mode()).isEqualTo(JobDriver.Mode.EXECUTOR);
    }

    @Test
    void executeJobsWaitsForTheExecutorToFinishAnAsyncServiceTask() {
        ScenarioReport report = run("""
                { "name": "async", "start": { "process": "asyncOk", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["aEnd"], "variables": { "done": true } } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void fireTimerMakesTheTimerDueAndWaitsUntilTheExecutorHasRunIt() {
        ScenarioReport report = run("""
                { "name": "timer", "start": { "process": "delayed", "user": "alice" },
                  "steps": [ { "expectActive": ["wait"] }, { "fireTimer": { "activity": "wait" } }, { "expectActive": ["afterWait"] },
                             { "completeTask": { "activity": "afterWait", "user": "alice" } } ],
                  "expect": { "state": "COMPLETED" } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void advanceClockLetsTheExecutorPickUpTheDueTimer() {
        ScenarioReport report = run("""
                { "name": "clock", "start": { "process": "escalating", "user": "alice" },
                  "steps": [ { "advanceClock": "PT3H" }, { "executeJobs": {} }, { "expectTask": { "activity": "manager", "assignee": "carol" } },
                             { "completeTask": { "activity": "manager", "user": "carol" } } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["escalatedEnd"] } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void aFailingJobIsRetriedUntilItReachesTheDeadLetterTable() {
        ScenarioReport report = run("""
                { "name": "dead letter", "start": { "process": "flaky", "user": "alice" },
                  "steps": [ { "failJobUntilDeadLetter": { "activity": "flakyCall" } } ],
                  "expect": { "state": "DEADLETTER", "deadLetterJobs": [ { "activity": "flakyCall", "exceptionMessageContains": "boom" } ] } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void aTimerStartEventIsFiredAndItsInstanceFollowed() {
        ScenarioReport report = run("""
                { "name": "timer start", "start": { "timer": "tStart", "process": "timerStarted" },
                  "steps": [ { "completeTask": { "activity": "report", "user": "alice" } } ], "expect": { "state": "COMPLETED" } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void aStartTimerTheExecutorIsRunningIsWaitedFor() {
        // a cycle that is due (an earlier scenario advanced the clock) is moved to the executable table by the executor, and its next
        // timer job exists only once that run is over: the start waits for it instead of finding no start timer job
        Job timer = management.createTimerJobQuery().list().stream()
                .filter(j -> TimerStartEventJobHandler.TYPE.equals(j.getJobHandlerType()) && j.getProcessDefinitionId().startsWith("timerStarted:"))
                .findFirst().orElseThrow();
        management.moveTimerToExecutableJob(timer.getId());
        ScenarioReport report = run("""
                { "name": "timer start while it runs", "start": { "timer": "tStart", "process": "timerStarted" },
                  "steps": [ { "completeTask": { "activity": "report", "user": "alice" } } ], "expect": { "state": "COMPLETED" } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void anAsyncSignalThrowIsDeliveredByTheExecutorAndExecuteJobsWaitsForIt() {
        ScenarioReport report = run("""
                { "name": "async signal", "start": { "process": "asyncSignal", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["sEnd"] } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void aJobThatFailedOnceIsRetriedAtOnceAndExecuteJobsWaitsForTheRetry() {
        // the failed job waits ten seconds in the retry table; the driver makes it executable, so the step takes far less
        long began = System.nanoTime();
        ScenarioReport report = run("""
                { "name": "retry timer", "start": { "process": "flakyOnce", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["oEnd"], "variables": { "attempts": 2 } } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
        assertThat((System.nanoTime() - began) / 1_000_000).describedAs("milliseconds").isLessThan(8_000);
    }

    @Test
    void aDeadLetterThatIsAnOptimisticLockingFailureIsRevivedAndWaitedFor() {
        ScenarioReport report = run("""
                { "name": "revive", "start": { "process": "lockedOnce", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["lockedEnd"], "variables": { "attempts": 2 } } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void aJobThatKeepsFailingMakesExecuteJobsReportTheDeadLetterAndItsFailure() {
        ScenarioReport report = run("""
                { "name": "dead letter", "start": { "process": "flaky", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ] }""");
        assertThat(report.passed()).isFalse();
        assertThat(report.failures().get(0)).contains("ended as dead letter").contains("'flakyCall' (boom)");
    }

    @Test
    void aStepThatWaitsForSomethingThatNeverHappensTimesOut() {
        FileReport file = runner.run(loader.parse("""
                { "name": "t", "users": { "alice": [] }, "scenarios": [ { "name": "never",
                  "start": { "process": "delayed", "user": "alice" },
                  "steps": [ { "advanceClock": "PT10M" }, { "executeJobs": { "timeoutMs": 300 } }, { "expectActive": ["afterWait"] } ] } ] }""", "inline"));
        // 10 minutes is not enough for the one hour timer: nothing is due, executeJobs returns at once, the expectation fails
        assertThat(file.passed()).isFalse();
        assertThat(file.scenarios().get(0).failures().get(0)).contains("expected exactly the active activities [afterWait] but they are [wait]");
    }
}
