package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import io.github.kleash.activiti.scenario.report.ScenarioReport;

/**
 * EXECUTOR mode with the executor's default timing: the
 * timer acquisition thread sleeps for its wait time (ten seconds by default) and does not notice that the scenario moved the engine
 * clock. A step that waited for the thread was as slow as that interval, and with a timeout of the same size (C05's repeating timers)
 * it failed now and then. The driver makes timers that are due on the engine clock executable itself, as the MANUAL driver does, so
 * the wait time of the executor does not matter. Here it is a minute: waiting for the thread would time out.
 */
@SpringBootTest(properties = {
        "spring.activiti.async-executor-activate=true",
        "spring.datasource.url=jdbc:h2:mem:runner-executor-slow;DB_CLOSE_DELAY=-1",
        "spring.activiti.async-executor.default-timer-job-acquire-wait-time-in-millis=60000",
        "spring.activiti.async-executor.default-async-job-acquire-wait-time-in-millis=60000",
        "activiti.scenario.executor-timeout=6s"
})
class ExecutorModeSlowAcquisitionTest extends ScenarioRunnerTestBase {

    @Test
    void aTimerThatIsDueOnTheAdvancedClockIsFiredWithoutWaitingForTheAcquisitionThread() {
        long began = System.nanoTime();
        ScenarioReport report = run("""
                { "name": "clock", "start": { "process": "escalating", "user": "alice" },
                  "steps": [ { "advanceClock": "PT3H" }, { "executeJobs": {} }, { "expectTask": { "activity": "manager", "assignee": "carol" } },
                             { "completeTask": { "activity": "manager", "user": "carol" } } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["escalatedEnd"] } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
        assertThat((System.nanoTime() - began) / 1_000_000).describedAs("milliseconds").isLessThan(5_000);
    }

    @Test
    void anInstanceThatTheExecutorEndsBetweenTheLastStepAndTheCleanupIsNotACleanupFailure() {
        // the async signal job is delivered by the executor at once, so the instance may end while the runner is still looking at it
        for (int i = 0; i < 25; i++) {
            ScenarioReport report = run("""
                    { "name": "race", "start": { "process": "asyncSignal", "user": "alice" },
                      "steps": [ { "expectActive": { "contains": ["sCatch"] } } ] }""");
            assertThat(report.failures()).describedAs("run %d: %s", i, report.render()).noneMatch(f -> f.startsWith("Cleanup failed"));
        }
    }
}
