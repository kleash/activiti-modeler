package io.github.kleash.activiti.scenario.testapp;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/** Shared helpers: run a scenario written inline as JSON against the embedded engine. */
@SpringBootTest
abstract class ScenarioRunnerTestBase {

    static final String USERS = "\"users\": { \"alice\": [\"clerks\", \"reviewers\"], \"bob\": [\"managers\"], \"carol\": [\"reviewers\"] }";

    @Autowired protected ScenarioRunner runner;
    @Autowired protected ScenarioLoader loader;

    /** Runs a file with the standard users and the given scenario objects (comma separated JSON). */
    protected FileReport runFile(String scenariosJson) {
        return runner.run(loader.parse("{ \"name\": \"inline\", " + USERS + ", \"clock\": \"2030-01-01T09:00:00Z\", \"scenarios\": [" + scenariosJson + "] }", "inline.scenario.json"));
    }

    /** Runs one scenario with the standard users. */
    protected ScenarioReport run(String scenarioJson) {
        return runFile(scenarioJson).scenarios().get(0);
    }

    /** A loan scenario at the review task, with the given extra steps and expect block ({@code null} for none). */
    protected ScenarioReport loan(String steps, String expect) {
        return run("{ \"name\": \"s\", \"start\": { \"process\": \"loan\", \"businessKey\": \"L-1\", \"user\": \"alice\", \"variables\": { \"customerId\": \"C-7\", \"amount\": 5000 } },"
                + " \"steps\": [" + steps + "]" + (expect == null ? "" : ", \"expect\": " + expect) + " }");
    }
}
