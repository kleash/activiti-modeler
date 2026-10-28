package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import io.github.kleash.activiti.scenario.report.ScenarioReport;

/**
 * Stability proof for EXECUTOR mode (docs/engine-findings.md 35): an asynchronous signal throw creates an event job that
 * the async executor races (the engine's after-commit hint against its acquisition thread). In about one run in forty
 * both attempts used to fail with an optimistic locking exception and the job moved to the retry table, out of the
 * driver's sight. The loop runs the scenario many times in one context and requires every run to pass.
 *
 * <p>The number of runs is {@code -Drunner.stress.iterations} (default 200).
 */
@SpringBootTest(properties = {
        "spring.activiti.async-executor-activate=true",
        "spring.datasource.url=jdbc:h2:mem:runner-executor;DB_CLOSE_DELAY=-1",
        "spring.activiti.async-executor.default-timer-job-acquire-wait-time-in-millis=100",
        "spring.activiti.async-executor.default-async-job-acquire-wait-time-in-millis=100",
        "activiti.scenario.executor-timeout=20s"
})
class AsyncSignalStressTest extends ScenarioRunnerTestBase {

    private static final String SCENARIO = """
            { "name": "async signal", "start": { "process": "asyncSignal", "user": "alice" },
              "steps": [ { "executeJobs": {} } ],
              "expect": { "state": "COMPLETED", "endEvents": ["sEnd"], "path": { "contains": ["sCatch", "sThrow", "sJoin", "sEnd"] } } }""";

    @Test
    void anAsyncSignalThrowIsDeliveredInEveryRun() {
        int iterations = Integer.getInteger("runner.stress.iterations", 200);
        List<String> failures = new ArrayList<>();
        for (int i = 1; i <= iterations; i++) {
            ScenarioReport report = run(SCENARIO);
            if (!report.passed()) {
                failures.add("run " + i + ": " + report.render());
            }
        }
        System.out.println("AsyncSignalStressTest: " + iterations + " runs, " + failures.size() + " failures");
        assertThat(failures).as("failed runs out of " + iterations).isEmpty();
    }
}
