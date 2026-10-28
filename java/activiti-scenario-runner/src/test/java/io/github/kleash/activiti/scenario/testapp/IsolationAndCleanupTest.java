package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.activiti.engine.ManagementService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.impl.identity.Authentication;
import org.activiti.engine.runtime.ProcessInstance;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.provisioning.UserDetailsManager;

import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;

/** Instance-tree scoping, cleanup of leftovers, and restoring clock and identity. */
class IsolationAndCleanupTest extends ScenarioRunnerTestBase {

    @Autowired RuntimeService runtime;
    @Autowired ManagementService management;
    @Autowired ProcessEngineConfiguration configuration;
    @Autowired UserDetailsService users;

    private int activeInstances() {
        return (int) runtime.createProcessInstanceQuery().count();
    }

    @Test
    void instancesLeftActiveByAScenarioAreDeletedWithTheirJobsAndTimers() {
        int before = activeInstances();
        FileReport report = runFile("""
                { "name": "leaves a timer instance", "start": { "process": "delayed", "user": "alice" }, "steps": [ { "expectActive": ["wait"] } ] },
                { "name": "leaves a task instance", "start": { "process": "escalating", "user": "alice" }, "steps": [ { "expectActive": { "contains": ["work", "timeout"] } } ], "expect": { "state": "ACTIVE" } },
                { "name": "leaves a dead letter", "start": { "process": "flaky", "user": "alice" }, "steps": [ { "failJobUntilDeadLetter": { "activity": "flakyCall" } } ], "expect": { "state": "DEADLETTER" } }
                """);
        assertThat(report.passed()).describedAs(report.render()).isTrue();

        assertThat(activeInstances()).isEqualTo(before);
        for (ScenarioReport scenario : report.scenarios()) {
            String root = scenario.rootProcessInstanceId();
            assertThat(management.createJobQuery().processInstanceId(root).count()).isZero();
            assertThat(management.createTimerJobQuery().processInstanceId(root).count()).isZero();
            assertThat(management.createDeadLetterJobQuery().processInstanceId(root).count()).isZero();
        }
    }

    @Test
    void childInstancesOfCallActivitiesAreDeletedToo() {
        int before = activeInstances();
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"parent\", \"user\": \"alice\", \"variables\": { \"customerId\": \"C\" } },"
                + " \"steps\": [ { \"expectChildInstance\": { \"callActivity\": \"callKyc\", \"state\": \"ACTIVE\" } } ] }");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
        assertThat(activeInstances()).isEqualTo(before);
        assertThat(runtime.createProcessInstanceQuery().processDefinitionKey("kyc").count()).isZero();
    }

    @Test
    void cleanupAlsoRunsWhenTheScenarioFails() {
        int before = activeInstances();
        ScenarioReport report = loan("{ \"expectActive\": [\"nothing\"] }", null);
        assertThat(report.passed()).isFalse();
        assertThat(activeInstances()).isEqualTo(before);
    }

    @Test
    void instancesThatExistedBeforeTheRunAreLeftAlone() {
        ProcessInstance foreign = runtime.startProcessInstanceByKey("approvals", Map.of("people", List.of("bob", "carol", "dave")));
        try {
            // The foreign instance has three open tasks at approveEach; the scenario sees only its own two.
            ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"approvals\", \"user\": \"alice\", \"variables\": { \"people\": [\"bob\", \"carol\"] } },"
                    + " \"steps\": [ { \"expectTask\": { \"activity\": \"approveEach\", \"count\": 2 } } ] }");
            assertThat(report.passed()).describedAs(report.render()).isTrue();
            assertThat(runtime.createProcessInstanceQuery().processInstanceId(foreign.getId()).count()).isEqualTo(1);
        } finally {
            runtime.deleteProcessInstance(foreign.getId(), "test cleanup");
        }
    }

    @Test
    void scenariosOfOneFileDoNotSeeEachOthersTasksOrJobs() {
        FileReport report = runFile("""
                { "name": "first", "start": { "process": "approvals", "user": "alice", "variables": { "people": ["bob"] } },
                  "steps": [ { "expectTask": { "activity": "approveEach", "count": 1 } } ] },
                { "name": "second", "start": { "process": "approvals", "user": "alice", "variables": { "people": ["carol", "bob"] } },
                  "steps": [ { "expectTask": { "activity": "approveEach", "count": 2 } } ] },
                { "name": "third has no tasks of its own", "start": { "process": "asyncOk", "user": "alice" },
                  "steps": [ { "expectTask": { "activity": "approveEach", "count": 0 } }, { "executeJobs": {} } ], "expect": { "state": "COMPLETED" } }
                """);
        assertThat(report.passed()).describedAs(report.render()).isTrue();
    }

    @Test
    void theClockIsResetAfterEveryScenario() {
        ScenarioReport report = loan("{ \"advanceClock\": \"P400D\" }", null);
        assertThat(report.passed()).isTrue();
        long now = System.currentTimeMillis();
        assertThat(configuration.getClock().getCurrentTime()).isBetween(new Date(now - 60_000), new Date(now + 60_000));
    }

    @Test
    void identityIsClearedAfterTheRun() {
        loan("{ \"claim\": { \"activity\": \"review\", \"user\": \"alice\" } }", null);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(Authentication.getAuthenticatedUserId()).isNull();
    }

    @Test
    void usersOfAFileExistOnlyWhileItRuns() {
        runFile("{ \"name\": \"s\", \"start\": { \"process\": \"asyncOk\", \"user\": \"alice\" }, \"steps\": [ { \"executeJobs\": {} } ] }");
        assertThatThrownBy(() -> users.loadUserByUsername("alice")).isInstanceOf(UsernameNotFoundException.class);
        assertThat(users.loadUserByUsername("scenario-runner").getAuthorities()).extracting(Object::toString).containsExactly("ROLE_ACTIVITI_USER");
    }

    @Test
    void aPreExistingUserIsRestoredAfterTheFileRedefinedIt() {
        UserDetailsManager manager = (UserDetailsManager) users;
        manager.createUser(User.withUsername("zoe").password("{noop}x").authorities("ROLE_ACTIVITI_USER", "GROUP_original").build());
        try {
            FileReport report = runner.run(loader.parse("""
                    { "name": "redefines zoe", "users": { "zoe": ["changed"] },
                      "scenarios": [ { "name": "s", "start": { "process": "escalating", "user": "zoe" },
                                       "steps": [ { "expectActive": { "contains": ["work"] } } ] } ] }""", "inline"));
            assertThat(report.passed()).describedAs(report.render()).isTrue();
            assertThat(users.loadUserByUsername("zoe").getAuthorities()).extracting(Object::toString).contains("GROUP_original").doesNotContain("GROUP_changed");
        } finally {
            manager.deleteUser("zoe");
        }
    }

    @Test
    void aStartThatNeverProducedAnInstanceLeavesNothingBehind() {
        int before = activeInstances();
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"loan\", \"user\": \"bob\", \"variables\": { \"customerId\": \"C\", \"amount\": 1 } } }");
        assertThat(report.passed()).isFalse();
        assertThat(report.rootProcessInstanceId()).isNull();
        assertThat(activeInstances()).isEqualTo(before);
    }
}
