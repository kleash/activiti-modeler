package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import io.github.kleash.activiti.scenario.report.DecisionReport;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.run.ScenarioEngine;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

class DecisionCasesTest extends ScenarioRunnerTestBase {

    @Autowired ScenarioEngine engine;

    private FileReport decisions(String casesJson) {
        return runner.run(loader.parse("{ \"name\": \"d\", \"decisions\": [" + casesJson + "] }", "inline"));
    }

    @Test
    void resultRowsAndMatchedRulesAreChecked() {
        FileReport report = decisions("""
                { "decision": "riskLevel", "inputs": { "amount": 5000 }, "expect": { "result": [ { "riskLevel": "high" } ], "matchedRules": ["R2"] } },
                { "name": "small", "decision": "riskLevel", "inputs": { "amount": 5 }, "expect": { "result": [ { "riskLevel": { "$regex": "^l" } } ], "matchedRules": ["R1"] } }
                """);
        assertThat(report.passed()).describedAs(report.render()).isTrue();
        assertThat(report.decisions()).extracting(DecisionReport::name).containsExactly("decision riskLevel", "small");
    }

    @Test
    void mismatchesNameTheRowAndTheRule() {
        FileReport report = decisions("""
                { "decision": "riskLevel", "inputs": { "amount": 5000 },
                  "expect": { "result": [ { "riskLevel": "low" }, { "riskLevel": "x" } ], "matchedRules": ["R1", "R2"] } },
                { "decision": "riskLevel", "inputs": { "amount": 5000 },
                  "expect": { "result": [ { "riskLevel": "low", "extra": 1 } ], "matchedRules": ["R1"] } }
                """);
        assertThat(report.passed()).isFalse();
        assertThat(report.decisions().get(0).failures()).containsExactly(
                "result: expected 2 row(s) but the decision returned 1: [{\"riskLevel\":\"high\"}]",
                "matchedRules: expected exactly [R1, R2] but were [R2]");
        assertThat(report.decisions().get(1).failures()).containsExactly(
                "result[0].riskLevel: expected \"low\" but was \"high\"",
                "result[0].extra: expected 1 but the value is missing",
                "matchedRules: expected exactly [R1] but were [R2]");
    }

    @Test
    void anEvaluatorFailureIsReportedWithItsCause() {
        FileReport report = decisions("{ \"decision\": \"unknown\", \"expect\": { \"matchedRules\": [] } }");
        assertThat(report.decisions().get(0).failures().get(0)).contains("Evaluating decision 'unknown' failed: IllegalArgumentException: unknown decision unknown");
        assertThat(report.decisions().get(0).cause()).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void withoutAnEvaluatorTheCasesFailWithAClearMessage() {
        ScenarioEngine none = new ScenarioEngine(engine.processRuntime(), engine.taskRuntime(), engine.repositoryService(), engine.runtimeService(),
                engine.taskService(), engine.historyService(), engine.managementService(), engine.configuration(), engine.users(),
                engine.connectorCalls(), engine.sequenceFlows(), engine.jobDriver(), null);
        FileReport report = new ScenarioRunner(none).run(loader.parse(
                "{ \"name\": \"d\", \"decisions\": [ { \"decision\": \"x\", \"expect\": { \"matchedRules\": [] } } ] }", "inline"));
        assertThat(report.decisions().get(0).failures()).containsExactly(
                "No DecisionEvaluator is configured; add the DMN connector module (or provide a DecisionEvaluator bean) to run decision cases");
    }
}
