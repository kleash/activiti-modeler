package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.ProcessDefinition;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;

import io.github.kleash.activiti.scenario.coverage.PathCoverage;
import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.modelexpect.ModelExpectChecker;
import io.github.kleash.activiti.scenario.report.FileReport;

class ModelExpectAndCoverageTest extends ScenarioRunnerTestBase {

    @Autowired ModelExpectChecker checker;
    @Autowired RepositoryService repository;

    @TempDir Path dir;

    private List<String> check(String json) throws Exception {
        Path file = dir.resolve("model-expect.json");
        Files.writeString(file, json);
        return checker.check(loader.loadModelExpectations(file));
    }

    // ---- model-expect -------------------------------------------------------------------------------------------------

    @Test
    void attributesAreCheckedAgainstTheModelTheEngineParsed() throws Exception {
        assertThat(check("""
                { "processes": {
                    "loan": {
                      "definition": { "name": "Loan", "category": "http://example.org/runner-test", "version": 1, "suspended": false },
                      "process": { "name": "Loan", "executable": true, "candidateStarterGroups": ["clerks"] },
                      "candidateStarters": { "groups": ["clerks"], "users": [] },
                      "elements": {
                        "review": { "type": "userTask", "attributes": {
                          "category": "credit", "priority": "80", "formKey": "reviewForm", "dueDate": "P1D",
                          "candidateGroups": ["reviewers"], "candidateUsers": [], "exclusive": true, "async": false } },
                        "lookup": { "type": "serviceTask", "attributes": { "implementation": "crm.LOOKUP" } },
                        "risk": { "type": "exclusiveGateway", "attributes": { "defaultFlow": "f_risk_review" } },
                        "f_risk_auto": { "type": "sequenceFlow", "attributes": { "conditionExpression": { "$regex": "amount" }, "targetRef": "autoApproved" } }
                      } },
                    "escalating": {
                      "elements": {
                        "timeout": { "type": "boundaryEvent", "attributes": {
                          "cancelActivity": true, "attachedToRefId": "work",
                          "eventDefinitions": [ { "@class": "TimerEventDefinition", "timeDuration": "PT2H" } ] } } } },
                    "flaky": {
                      "elements": {
                        "flakyCall": { "attributes": { "async": true, "exclusive": true, "failedJobRetryTimeCycleValue": "R2/PT10S", "implementationType": "delegateExpression" } } } }
                  } }""")).isEmpty();
    }

    @Test
    void mismatchesNameTheProcessElementAndProperty() throws Exception {
        assertThat(check("""
                { "processes": {
                    "loan": {
                      "definition": { "category": "http://elsewhere", "nonsense": 1 },
                      "candidateStarters": { "groups": ["clerks", "extra"], "users": ["u"] },
                      "elements": {
                        "review": { "type": "serviceTask", "attributes": { "category": "debit", "candidateGroups": ["a"], "bogus": 1, "exclusive": false } },
                        "ghost": { "type": "userTask" },
                        "start": { "attributes": { "name": { "$regex": "^X" } } }
                      } },
                    "notDeployed": { "elements": { "x": { "type": "task" } } }
                  } }"""))
                .contains(
                        "process 'loan' definition.category: expected \"http://elsewhere\" but was \"http://example.org/runner-test\"",
                        "process 'loan' definition.nonsense: ProcessDefinitionEntityImpl has no readable property 'nonsense'",
                        "process 'loan' candidateStarters.groups: expected exactly [clerks, extra] but identity links give [clerks]",
                        "process 'loan' candidateStarters.users: expected exactly [u] but identity links give []",
                        "process 'loan' element 'review'.type: expected serviceTask but the engine parsed a userTask",
                        "process 'loan' element 'review'.category: expected \"debit\" but was \"credit\"",
                        "process 'loan' element 'review'.candidateGroups[0]: expected \"a\" but was \"reviewers\"",
                        "process 'loan' element 'review'.bogus: UserTask has no readable property 'bogus'",
                        "process 'loan' element 'review'.exclusive: expected false but was true",
                        "process 'loan' element 'ghost': no such element in the parsed model",
                        "process 'loan' element 'start'.name: expected a value matching /^X/ but was null",
                        "process 'notDeployed': no process definition with this key is deployed");
    }

    // ---- model-expect: extensions ---------------------------------------------------------------------------------------

    @Test
    void extensionsAreCheckedAgainstWhatTheRuntimeReaderParsed() throws Exception {
        assertThat(check("""
                { "processes": { "loan": { "extensions": {
                    "properties": {
                      "amount": { "id": "p2", "type": "integer", "required": false },
                      "approved": { "type": "boolean" },
                      "ghost": { "$exists": false } },
                    "mappings": {
                      "lookup": { "mappingType": null, "ephemeral": false,
                        "inputs": { "customerId": { "type": "VARIABLE", "value": "customerId" } },
                        "outputs": { "customerName": { "type": "VARIABLE", "value": "name" }, "riskLevel": { "type": "VARIABLE", "value": "risk" } } },
                      "review": { "inputs": { "$size": 1 }, "outputs": { "$size": 1 } },
                      "start": { "$exists": false } },
                    "constants": {
                      "lookup": { "source": "scenario-test" },
                      "review": { "$exists": false } } } } } }""")).isEmpty();
    }

    @Test
    void extensionMismatchesNameTheProcessSectionEntryAndProperty() throws Exception {
        assertThat(check("""
                { "processes": { "loan": { "extensions": {
                    "properties": { "amount": { "type": "string" }, "missing": { "type": "string" }, "approved": { "nonsense": 1 } },
                    "mappings": {
                      "lookup": { "mappingType": "MAP_ALL", "inputs": { "customerId": { "type": "VALUE", "value": "other" } }, "bogus": 1 },
                      "review": { "outputs": { "$size": 2 } },
                      "nowhere": { "mappingType": null } },
                    "constants": {
                      "lookup": { "source": "scenario-test", "extra": 1 },
                      "review": { "k": 1 } } } } } }"""))
                .containsExactly(
                        "process 'loan' extensions.properties.amount.type: expected \"string\" but was \"integer\"",
                        "process 'loan' extensions.properties.missing: expected {\"type\":\"string\"} but the value is missing",
                        "process 'loan' extensions.properties.approved.nonsense: VariableDefinition has no readable property 'nonsense'",
                        "process 'loan' extensions.mappings.lookup.mappingType: expected \"MAP_ALL\" but was null",
                        "process 'loan' extensions.mappings.lookup.inputs.customerId.type: expected \"VALUE\" but was \"VARIABLE\"",
                        "process 'loan' extensions.mappings.lookup.inputs.customerId.value: expected \"other\" but was \"customerId\"",
                        "process 'loan' extensions.mappings.lookup.bogus: ProcessVariablesMapping has no readable property 'bogus'",
                        "process 'loan' extensions.mappings.review.outputs.size: expected 2 but was 1",
                        "process 'loan' extensions.mappings.nowhere: expected {\"mappingType\":null} but the value is missing",
                        "process 'loan' extensions.constants.lookup.extra: expected 1 but the value is missing",
                        "process 'loan' extensions.constants.review: expected {\"k\":1} but the value is missing");
    }

    @Test
    void anExtensionsExpectationNeedsAnExtensionService() throws Exception {
        Path file = dir.resolve("model-expect-no-service.json");
        Files.writeString(file, "{ \"processes\": { \"loan\": { \"extensions\": { \"constants\": { \"lookup\": { \"source\": \"x\" } } } } } }");
        assertThat(new ModelExpectChecker(repository).check(loader.loadModelExpectations(file)))
                .containsExactly("process 'loan' extensions: no ProcessExtensionService is available to read the extensions");
    }

    @Test
    void theSchemaRejectsUnknownSectionsOfAnExtensionsExpectation() throws Exception {
        assertThatThrownBy(() -> check("""
                { "processes": { "loan": { "extensions": { "templates": {} } } } }"""))
                .hasMessageContaining("model-expect");
    }

    // ---- coverage ------------------------------------------------------------------------------------------------------

    private List<ProcessDefinition> loanDefinitions() {
        return repository.createProcessDefinitionQuery().processDefinitionKey("loan").latestVersion().list();
    }

    @Test
    void theLoanScenariosVisitEveryNodeAndFlow() {
        FileReport report = runner.run(loader.load(ScenarioTestSupport.scenario("loan.scenario.json")));
        assertThat(report.passed()).describedAs(report.render()).isTrue();

        PathCoverage.Result result = PathCoverage.compute(repository, loanDefinitions(), report.visited(), CoverageExemptions.NONE);
        assertThat(result.problems()).isEmpty();
        assertThat(result.complete()).isTrue();
        assertThat(result.total()).isEqualTo(8 /* nodes: start, lookup, risk, review, decision, 3 ends */ + 7 /* flows */ - 0);
    }

    @Test
    void aSingleScenarioLeavesTheOtherBranchesMissing() {
        FileReport report = runFile("""
                { "name": "auto approved only", "start": { "process": "loan", "user": "alice", "variables": { "customerId": "C", "amount": 10 } },
                  "expect": { "state": "COMPLETED" } }""");
        PathCoverage.Result result = PathCoverage.compute(repository, loanDefinitions(), report.visited(), CoverageExemptions.NONE);
        assertThat(result.complete()).isFalse();
        assertThat(result.missing()).extracting(PathCoverage.Element::id)
                .containsExactlyInAnyOrder("review", "decision", "approvedEnd", "rejectedEnd", "f_risk_review", "f_review_decision", "f_decision_approved", "f_decision_rejected");
        assertThat(result.problems()).contains("Path coverage is incomplete (7 of 15 elements visited)").contains("node loan/review").contains("flow loan/f_decision_rejected");
    }

    @Test
    void exemptionsWithReasonsMakeAPartialRunComplete() {
        FileReport report = runFile("""
                { "name": "auto approved only", "start": { "process": "loan", "user": "alice", "variables": { "customerId": "C", "amount": 10 } },
                  "expect": { "state": "COMPLETED" } }""");
        List<CoverageExemptions.Exemption> all = loanDefinitions().stream().flatMap(d -> List.of("review", "decision", "approvedEnd", "rejectedEnd",
                "f_risk_review", "f_review_decision", "f_decision_approved", "f_decision_rejected").stream())
                .map(id -> new CoverageExemptions.Exemption("loan", id, "covered by the corpus project, not by this test")).toList();
        PathCoverage.Result result = PathCoverage.compute(repository, loanDefinitions(), report.visited(), new CoverageExemptions(all));
        assertThat(result.problems()).isEmpty();
        assertThat(result.exempt()).hasSize(8);
    }

    @Test
    void childProcessesCountTowardsTheirOwnDefinition() {
        FileReport report = runFile("""
                { "name": "parent and child", "start": { "process": "parent", "user": "alice", "variables": { "customerId": "C" } },
                  "steps": [ { "completeTask": { "activity": "kycCheck", "user": "alice", "variables": { "result": "ok" } } } ],
                  "expect": { "state": "COMPLETED" } }""");
        assertThat(report.passed()).describedAs(report.render()).isTrue();
        List<ProcessDefinition> definitions = repository.createProcessDefinitionQuery().latestVersion().list().stream()
                .filter(d -> d.getKey().equals("parent") || d.getKey().equals("kyc")).toList();
        PathCoverage.Result result = PathCoverage.compute(repository, definitions, report.visited(), CoverageExemptions.NONE);
        assertThat(result.problems()).isEmpty();
        assertThat(report.visited().byProcess()).containsOnlyKeys("parent", "kyc");
    }
}
