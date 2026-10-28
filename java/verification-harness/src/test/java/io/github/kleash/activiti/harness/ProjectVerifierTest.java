package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.verify.Check;
import io.github.kleash.activiti.harness.verify.CheckResult;
import io.github.kleash.activiti.harness.verify.ProjectVerifier;

/** The harness itself: it must pass a good project and say precisely what is wrong with a broken one. */
class ProjectVerifierTest {

    @TempDir Path dir;

    /** Runs every check in order, like the dynamic tests do. */
    private static Map<String, CheckResult> runAll(Project project, DeployMode mode) {
        Map<String, CheckResult> results = new LinkedHashMap<>();
        try (ProjectVerifier verifier = new ProjectVerifier(project, mode)) {
            for (Check check : verifier.checks()) {
                results.put(check.name(), check.run());
            }
        }
        return results;
    }

    private static List<String> failedNames(Map<String, CheckResult> results) {
        return results.entrySet().stream().filter(e -> !e.getValue().passed()).map(Map.Entry::getKey).toList();
    }

    private Project mini() {
        return TestProjects.copy("mini", dir);
    }

    private static void replaceIn(Path file, String from, String to) throws IOException {
        String content = Files.readString(file);
        assertThat(content).contains(from);
        Files.writeString(file, content.replace(from, to));
    }

    @ParameterizedTest
    @EnumSource(DeployMode.class)
    void aGoodProjectPassesEveryCheck(DeployMode mode) {
        Map<String, CheckResult> results = runAll(mini(), mode);
        assertThat(failedNames(results)).isEmpty();
        assertThat(results.keySet()).containsExactly(
                "application context starts and the project deploys",
                "deployment: resources, definitions and content",
                "model validation: no warnings other than the expected ones",
                "mini.scenario.json: accepted",
                "mini.scenario.json: rejected",
                "mini.scenario.json: only starters can start",
                "mini.scenario.json: a passing score",
                "mini.scenario.json: a failing score, addressed by the file name",
                "DMN cross-check: every decision evaluated here gives the same rows and matched rules on KIE",
                "model-expect.json",
                "path coverage: every flow node and sequence flow is visited");
    }

    @Test
    void aWrongScenarioExpectationFailsOnlyThatScenarioWithAPreciseMessage() throws IOException {
        Project project = mini();
        replaceIn(project.scenarioFiles().get(0), "\"endEvents\": [\"acceptedEnd\"]", "\"endEvents\": [\"rejectedEnd\"]");

        Map<String, CheckResult> results = runAll(project, DeployMode.AUTO_DEPLOY);

        assertThat(failedNames(results)).containsExactly("mini.scenario.json: accepted");
        assertThat(results.get("mini.scenario.json: accepted").message())
                .contains("Scenario 'accepted' FAILED")
                .contains("endEvents: expected exactly [rejectedEnd] but the instance reached [acceptedEnd]");
    }

    @Test
    void aScenarioFileThatViolatesTheSchemaIsReportedWithTheJsonPath() throws IOException {
        Project project = mini();
        replaceIn(project.scenarioFiles().get(0), "\"user\": \"ben\", \"variables\"", "\"variables\"");

        Map<String, CheckResult> results = runAll(project, DeployMode.AUTO_DEPLOY);

        assertThat(failedNames(results)).contains("mini.scenario.json: valid scenario file");
        assertThat(results.get("mini.scenario.json: valid scenario file").message())
                .contains("mini.scenario.json").contains("/scenarios/0/steps/1/completeTask: required property 'user' not found");
    }

    @Test
    void missingCoverageNamesTheElementsAndTheExemptionFile() throws IOException {
        Project project = mini();
        // drop the "rejected" scenario: rejectedEnd and f_gate_rejected are never visited
        Path scenario = project.scenarioFiles().get(0);
        String content = Files.readString(scenario);
        int from = content.indexOf("    {\n      \"name\": \"rejected\"");
        int to = content.indexOf("    {\n      \"name\": \"only starters");
        Files.writeString(scenario, content.substring(0, from) + content.substring(to));

        Map<String, CheckResult> results = runAll(project, DeployMode.AUTO_DEPLOY);

        assertThat(failedNames(results)).containsExactly("path coverage: every flow node and sequence flow is visited");
        assertThat(results.get("path coverage: every flow node and sequence flow is visited").message())
                .contains("Path coverage is incomplete").contains("node mini/rejectedEnd").contains("flow mini/f_gate_rejected")
                .contains("coverage-exemptions.json");
    }

    @Test
    void exemptionsWithReasonsRestoreCoverageAndStaleOnesFail() throws IOException {
        Project project = mini();
        Path scenario = project.scenarioFiles().get(0);
        String content = Files.readString(scenario);
        Files.writeString(scenario, content.substring(0, content.indexOf("    {\n      \"name\": \"rejected\"")) + content.substring(content.indexOf("    {\n      \"name\": \"only starters")));
        Path exemptions = Files.writeString(project.dir().resolve("scenarios/coverage-exemptions.json"), """
                { "exemptions": [
                  { "process": "mini", "element": "rejectedEnd", "reason": "the rejection path is covered by another project" },
                  { "process": "mini", "element": "f_gate_rejected", "reason": "the rejection path is covered by another project" } ] }""");
        Project withExemptions = new Project(project.id(), project.origin(), project.dir(), project.processesDir(), null, project.scenarioFiles(),
                project.modelExpect(), exemptions);
        assertThat(failedNames(runAll(withExemptions, DeployMode.AUTO_DEPLOY))).isEmpty();

        Files.writeString(exemptions, """
                { "exemptions": [
                  { "process": "mini", "element": "rejectedEnd", "reason": "the rejection path is covered by another project" },
                  { "process": "mini", "element": "f_gate_rejected", "reason": "the rejection path is covered by another project" },
                  { "process": "mini", "element": "typoed", "reason": "an element that does not exist at all" } ] }""");
        Map<String, CheckResult> results = runAll(withExemptions, DeployMode.AUTO_DEPLOY);
        assertThat(failedNames(results)).containsExactly("path coverage: every flow node and sequence flow is visited");
        assertThat(results.get("path coverage: every flow node and sequence flow is visited").message()).contains("names elements that do not exist").contains("mini/typoed");
    }

    @Test
    void aModelExpectMismatchIsReportedAgainstTheParsedModel() throws IOException {
        Project project = mini();
        replaceIn(project.modelExpect(), "\"category\": \"quality\"", "\"category\": \"speed\"");

        Map<String, CheckResult> results = runAll(project, DeployMode.PROGRAMMATIC);

        assertThat(failedNames(results)).containsExactly("model-expect.json");
        assertThat(results.get("model-expect.json").message())
                .contains("process 'mini' element 'check'.category: expected \"speed\" but was \"quality\"");
    }

    @Test
    void aBrokenBpmnFileFailsTheContextCheckAndExplainsTheRestAsUnavailable() throws IOException {
        Project project = mini();
        Files.writeString(project.processesDir().resolve("mini.bpmn20.xml"), "<definitions><process id=\"mini\"");

        for (DeployMode mode : DeployMode.values()) {
            Map<String, CheckResult> results = runAll(project, mode);
            assertThat(failedNames(results)).hasSizeGreaterThanOrEqualTo(8);
            assertThat(results.get("application context starts and the project deploys").message())
                    .contains("did not start or the project did not deploy");
            assertThat(results.get("mini.scenario.json: accepted").message()).contains("failed to start");
        }
    }

    @Test
    void aProjectWithoutScenarioFilesFails() throws IOException {
        Project project = mini();
        Files.delete(project.scenarioFiles().get(0));
        Project empty = new Project(project.id(), project.origin(), project.dir(), project.processesDir(), null, List.of(), project.modelExpect(), null);

        Map<String, CheckResult> results = runAll(empty, DeployMode.AUTO_DEPLOY);

        assertThat(results.get("project has scenario files").message()).contains("No *.scenario.json file found for project");
    }

    @Test
    void anUnexpectedValidatorWarningFailsTheValidationCheck() throws IOException {
        Project project = mini();
        // the exclusive gateway now has an unconditional, non-default flow next to a conditional one
        replaceIn(project.processesDir().resolve("mini.bpmn20.xml"), "<exclusiveGateway id=\"gate\" default=\"f_gate_rejected\"/>", "<exclusiveGateway id=\"gate\"/>");

        Map<String, CheckResult> results = runAll(project, DeployMode.AUTO_DEPLOY);

        CheckResult validation = results.get("model validation: no warnings other than the expected ones");
        assertThat(validation.passed()).isFalse();
        assertThat(validation.message()).contains("validator warning:").contains("gate");
    }

    private static String shapeOf(String element) {
        return "<bpmndi:BPMNDiagram id=\"d\" xmlns:bpmndi=\"http://www.omg.org/spec/BPMN/20100524/DI\" xmlns:dc=\"http://www.omg.org/spec/DD/20100524/DC\">"
                + "<bpmndi:BPMNPlane id=\"p\" bpmnElement=\"mini\"><bpmndi:BPMNShape id=\"s_di\" bpmnElement=\"" + element + "\">"
                + "<dc:Bounds x=\"10\" y=\"10\" width=\"50\" height=\"50\"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</definitions>";
    }

    @Test
    void theDiagramOfADataStoreReferenceIsAnExpectedWarningNote() throws IOException {
        Project project = mini();
        Path model = project.processesDir().resolve("mini.bpmn20.xml");
        replaceIn(model, "    <endEvent id=\"rejectedEnd\"/>\n", "    <endEvent id=\"rejectedEnd\"/>\n    <dataStoreReference id=\"store\" name=\"Store\"/>\n");
        replaceIn(model, "</definitions>", shapeOf("store"));

        CheckResult validation = runAll(project, DeployMode.AUTO_DEPLOY).get("model validation: no warnings other than the expected ones");

        assertThat(validation.passed()).isTrue();
        assertThat(validation.notes()).anyMatch(n -> n.contains("DI_DOES_NOT_REFERENCE_FLOWNODE") && n.contains("store does not reference a flow node"));
    }

    @Test
    void aDiagramShapeOfAnUnknownElementIsStillAFailure() throws IOException {
        Project project = mini();
        replaceIn(project.processesDir().resolve("mini.bpmn20.xml"), "</definitions>", shapeOf("ghost"));

        CheckResult validation = runAll(project, DeployMode.AUTO_DEPLOY).get("model validation: no warnings other than the expected ones");

        assertThat(validation.passed()).isFalse();
        assertThat(validation.message()).contains("DI_INVALID_REFERENCE").contains("ghost");
    }

    @Test
    void theAsyncExecutorWarningsAreNotesNotFailures() {
        Map<String, CheckResult> results = runAll(TestProjects.fixture("async"), DeployMode.AUTO_DEPLOY);

        assertThat(failedNames(results)).isEmpty();
        CheckResult validation = results.get("model validation: no warnings other than the expected ones");
        assertThat(validation.notes()).anyMatch(n -> n.contains("FLOW_ELEMENT_ASYNC_NOT_AVAILABLE"))
                .anyMatch(n -> n.contains("EVENT_TIMER_ASYNC_NOT_AVAILABLE"))
                .allMatch(n -> n.startsWith("expected validator warning (the async executor is off)"));
    }

    @Test
    void aMissingDmnSuffixCannotHideADeploymentProblem() throws IOException {
        // an extra file that is not deployable is simply not expected; an extra .dmn is expected and must be deployed
        Project project = mini();
        Files.writeString(project.processesDir().resolve("more.dmn"), Files.readString(project.processesDir().resolve("rules.dmn"))
                .replace("\"grade\"", "\"gradeToo\"").replace("name=\"rules\"", "name=\"more\"").replace("id=\"rules\"", "id=\"more\""));
        Files.writeString(project.processesDir().resolve("notes.txt"), "not deployed");
        assertThat(failedNames(runAll(project, DeployMode.AUTO_DEPLOY))).isEmpty();
    }
}
