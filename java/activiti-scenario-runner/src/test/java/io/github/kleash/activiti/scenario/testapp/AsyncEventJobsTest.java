package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.activiti.engine.ManagementService;
import org.activiti.engine.RuntimeService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import io.github.kleash.activiti.scenario.report.ScenarioReport;

/**
 * An intermediate throw signal with {@code activiti:async="true"} creates an event job that has neither a process instance
 * nor an execution; the runner must still attribute it to the instance whose subscription it delivers to, drive it with
 * {@code executeJobs}, and remove it when the scenario ends without running it.
 */
class AsyncEventJobsTest extends ScenarioRunnerTestBase {

    @Autowired ManagementService management;
    @Autowired RuntimeService runtime;

    @Test
    void executeJobsRunsTheAsyncSignalJobOfTheScenariosInstance() {
        ScenarioReport report = run("""
                { "name": "async signal", "start": { "process": "asyncSignal", "user": "alice" },
                  "steps": [ { "expectActive": ["sCatch"] }, { "executeJobs": {} } ],
                  "expect": { "state": "COMPLETED", "endEvents": ["sEnd"], "path": { "contains": ["sCatch", "sThrow", "sJoin", "sEnd"] } } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void withoutExecuteJobsTheCatchStaysWaiting() {
        ScenarioReport report = run("""
                { "name": "not delivered yet", "start": { "process": "asyncSignal", "user": "alice" },
                  "steps": [ { "expectActive": ["sCatch"] } ],
                  "expect": { "state": "ACTIVE" } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void anUnrunEventJobIsDeletedWithTheScenarioSoNothingFailsLater() {
        ScenarioReport report = run("""
                { "name": "left behind", "start": { "process": "asyncSignal", "user": "alice" },
                  "steps": [ { "expectActive": { "contains": ["sCatch"] } } ] }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();

        assertThat(runtime.createProcessInstanceQuery().processDefinitionKey("asyncSignal").count()).isZero();
        assertThat(management.createJobQuery().messages().list()).as("orphaned event jobs").isEmpty();
    }

    @Test
    void anEventJobOfAnotherScenarioIsNotExecutedByThisOne() {
        // two scenarios of the same file: the second must not see (or run) the first one's job
        var file = runFile("""
                { "name": "first", "start": { "process": "asyncSignal", "user": "alice" }, "steps": [ { "expectActive": { "contains": ["sCatch"] } } ] },
                { "name": "second", "start": { "process": "asyncSignal", "user": "alice" },
                  "steps": [ { "executeJobs": {} } ], "expect": { "state": "COMPLETED" } }""");
        assertThat(file.passed()).describedAs(file.render()).isTrue();
    }
}
