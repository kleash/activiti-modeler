package io.github.kleash.activiti.scenario.load;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.model.ModelExpectations;
import io.github.kleash.activiti.scenario.model.Scenario;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.model.Start;
import io.github.kleash.activiti.scenario.model.Step;
import io.github.kleash.activiti.scenario.testapp.ScenarioTestSupport;

class ScenarioLoaderTest {

    private final ScenarioLoader loader = new ScenarioLoader();

    private static String wrap(String scenarioBody) {
        return "{\"name\": \"t\", \"scenarios\": [" + scenarioBody + "]}";
    }

    private static String withStep(String step) {
        return wrap("{\"name\": \"s\", \"start\": {\"process\": \"p\"}, \"steps\": [" + step + "]}");
    }

    @Test
    void parsesAFileUsingEveryStepTypeAndMatcher() {
        ScenarioFile file = loader.load(ScenarioTestSupport.scenario("all-steps.example.json"));

        assertThat(file.name()).isEqualTo("every step type");
        assertThat(file.users()).containsEntry("alice", List.of("reviewers")).containsEntry("bob", List.of("managers"));
        assertThat(file.clock()).isEqualTo(Instant.parse("2030-01-01T09:00:00Z"));
        assertThat(file.scenarios()).hasSize(5);
        assertThat(file.decisions()).hasSize(1);
        assertThat(file.decisions().get(0).matchedRules()).containsExactly("Rule_medium");
        assertThat(file.decisions().get(0).result()).containsExactly(Map.of("riskLevel", "medium"));

        Scenario all = file.scenarios().get(0);
        assertThat(all.clock()).isEqualTo(Instant.parse("2031-01-01T08:00:00Z"));
        assertThat(all.start().kind()).isEqualTo(Start.Kind.PROCESS);
        assertThat(all.start().variables()).containsEntry("amount", 5000);
        assertThat(all.steps()).extracting(Step::type).containsExactly(
                "expectTask", "claim", "release", "assign", "completeTask", "completeTask", "completeTask",
                "expectConnectorCall", "expectChildInstance", "message", "signal", "triggerReceiveTask", "expectTimer", "fireTimer",
                "advanceClock", "executeJobs", "failJobUntilDeadLetter", "expectActive", "expectActive", "setVariables");

        Step.ExpectTask task = (Step.ExpectTask) all.steps().get(0);
        assertThat(task.fields()).containsEntry("assignee", null).containsKey("owner").doesNotContainKey("description-x");
        assertThat(task.fields().get("priority")).isEqualTo(80);
        assertThat(task.partial()).isTrue();
        assertThat(task.count()).isEqualTo(1);
        assertThat(task.match().fields()).containsEntry("index", 1);
        assertThat(task.visibleTo()).containsExactly("alice");

        Step.CompleteTask failing = (Step.CompleteTask) all.steps().get(6);
        assertThat(failing.expectFailure().exception()).isEqualTo("ActivitiException");
        assertThat(failing.expectFailure().messageContains()).isEqualTo("No outgoing");

        assertThat(all.expect().state()).isEqualTo("COMPLETED");
        assertThat(all.expect().path().order()).containsExactly(List.of("start", "riskCheck"), List.of("riskCheck", "review"));
        assertThat(all.expect().deadLetterJobs()).singleElement().satisfies(j -> assertThat(j.activity()).isEqualTo("flakyCall"));

        assertThat(file.scenarios().get(1).start().kind()).isEqualTo(Start.Kind.MESSAGE);
        assertThat(file.scenarios().get(2).start().kind()).isEqualTo(Start.Kind.SIGNAL);
        assertThat(file.scenarios().get(3).start().kind()).isEqualTo(Start.Kind.TIMER);
        assertThat(file.scenarios().get(4).start().expectFailure().messageContains()).isEqualTo("required variables");
    }

    @Test
    void anAbsentAssigneeAndAnExplicitNullAreDistinguishable() {
        ScenarioFile file = loader.parse(withStep("{\"expectTask\": {\"activity\": \"a\"}}, {\"expectTask\": {\"activity\": \"a\", \"assignee\": null}}"), "t");
        List<Step> steps = file.scenarios().get(0).steps();
        assertThat(((Step.ExpectTask) steps.get(0)).fields()).doesNotContainKey("assignee");
        assertThat(((Step.ExpectTask) steps.get(1)).fields()).containsKey("assignee");
    }

    @Test
    void aReceiveTaskTriggerPicksItsExecutionByVariablesOnly() {
        ScenarioFile file = loader.parse(withStep("{\"triggerReceiveTask\": {\"activity\": \"a\", \"match\": {\"localVariables\": {\"parcel\": \"b\"}}}}"), "t");
        Step.TriggerReceiveTask step = (Step.TriggerReceiveTask) file.scenarios().get(0).steps().get(0);
        assertThat(step.match().fields()).containsEntry("localVariables", java.util.Map.of("parcel", "b"));

        assertThatThrownBy(() -> loader.parse(withStep("{\"triggerReceiveTask\": {\"activity\": \"a\", \"match\": {\"assignee\": \"ann\"}}}"), "t"))
                .hasMessageContaining("is not valid");
    }

    @Test
    void identityLinksOfAnExpectedTaskAreLoadedAndValidated() {
        ScenarioFile file = loader.parse(withStep("{\"expectTask\": {\"activity\": \"a\", \"identityLinks\": [{\"type\": \"supervisor\", \"user\": \"dave\"}, {\"type\": \"supervisor\", \"group\": \"managers\"}]}}"), "t");
        Step.ExpectTask step = (Step.ExpectTask) file.scenarios().get(0).steps().get(0);
        assertThat(step.fields()).containsKey("identityLinks");

        assertThatThrownBy(() -> loader.parse(withStep("{\"expectTask\": {\"activity\": \"a\", \"identityLinks\": [{\"type\": \"supervisor\"}]}}"), "t"))
                .isInstanceOf(InvalidScenarioException.class).hasMessageContaining("identityLinks");
        assertThatThrownBy(() -> loader.parse(withStep("{\"expectTask\": {\"activity\": \"a\", \"identityLinks\": [{\"type\": \"s\", \"user\": \"u\", \"group\": \"g\"}]}}"), "t"))
                .isInstanceOf(InvalidScenarioException.class).hasMessageContaining("identityLinks");
    }

    @Test
    void loadsModelExpectationsAndExemptions(@TempDir Path dir) throws Exception {
        Path modelExpect = dir.resolve("model-expect.json");
        Files.writeString(modelExpect, """
                { "processes": { "p": {
                    "definition": { "category": "http://x" },
                    "candidateStarters": { "users": ["u"], "groups": ["g"] },
                    "elements": { "t": { "type": "userTask", "attributes": { "category": "c" } } } } } }""");
        ModelExpectations expectations = loader.loadModelExpectations(modelExpect);
        assertThat(expectations.processes()).containsOnlyKeys("p");
        ModelExpectations.ProcessExpectation p = expectations.processes().get("p");
        assertThat(p.starterUsers()).containsExactly("u");
        assertThat(p.starterGroups()).containsExactly("g");
        assertThat(p.definition()).containsEntry("category", "http://x");
        assertThat(p.elements().get("t").type()).isEqualTo("userTask");

        Path exemptions = dir.resolve("coverage-exemptions.json");
        Files.writeString(exemptions, "{ \"exemptions\": [ { \"process\": \"p\", \"element\": \"e\", \"reason\": \"cannot be reached\" } ] }");
        CoverageExemptions loaded = loader.loadExemptions(exemptions);
        assertThat(loaded.exemptions()).singleElement().satisfies(e -> {
            assertThat(e.process()).isEqualTo("p");
            assertThat(e.element()).isEqualTo("e");
        });
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', textBlock = """
            missing file name                  | {"scenarios": []}                                                                                   | required property 'name' not found
            unknown top-level key              | {"name": "t", "steps": []}                                                                          | property 'steps' is not defined
            scenario without start             | {"name": "t", "scenarios": [{"name": "s"}]}                                                         | /scenarios/0: required property 'start' not found
            bad clock                          | {"name": "t", "clock": "tomorrow"}                                                                  | /clock
            """)
    void reportsTopLevelProblemsWithTheirPath(String title, String json, String expected) {
        assertThatThrownBy(() -> loader.parse(json, "file.scenario.json"))
                .isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining("file.scenario.json (schema scenario.schema.json) is not valid")
                .hasMessageContaining(expected);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', textBlock = """
            unknown step type                  | {"complete": {"activity": "a", "user": "u"}}                                          | /scenarios/0/steps/0: property 'complete' is not defined
            completeTask without user          | {"completeTask": {"activity": "a"}}                                                   | /scenarios/0/steps/0/completeTask: required property 'user' not found
            two keys in one step               | {"claim": {"activity": "a", "user": "u"}, "release": {"activity": "a", "user": "u"}}  | /scenarios/0/steps/0
            claim without activity             | {"claim": {"user": "u"}}                                                              | required property 'activity' not found
            expectTask unknown field           | {"expectTask": {"activity": "a", "assigne": "x"}}                                     | property 'assigne' is not defined
            negative count                     | {"expectTask": {"activity": "a", "count": -1}}                                        | /scenarios/0/steps/0/expectTask/count
            bad duration                       | {"advanceClock": "25 hours"}                                                          | /scenarios/0/steps/0/advanceClock
            unknown matcher operator           | {"expectTask": {"activity": "a", "name": {"$like": "x"}}}                             | property '$like' is not defined
            matcher mixed with plain keys      | {"expectTask": {"activity": "a", "localVariables": {"v": {"$gt": 1, "x": 2}}}}        | /scenarios/0/steps/0/expectTask/localVariables/v
            bad $type                          | {"expectTask": {"activity": "a", "name": {"$type": "text"}}}                          | /scenarios/0/steps/0/expectTask/name/$type
            empty $any                         | {"expectTask": {"activity": "a", "name": {"$any": []}}}                               | /scenarios/0/steps/0/expectTask/name/$any
            match without keys                 | {"claim": {"activity": "a", "user": "u", "match": {}}}                               | /scenarios/0/steps/0/claim/match
            expectActive wrong type            | {"expectActive": "review"}                                                            | /scenarios/0/steps/0/expectActive
            order pair of three                | {"expectChildInstance": {"callActivity": "c", "path": {"order": [["a", "b", "c"]]}}}  | /scenarios/0/steps/0/expectChildInstance/path/order/0
            """)
    void reportsStepProblemsWithTheirPath(String title, String step, String expected) {
        assertThatThrownBy(() -> loader.parse(withStep(step), "file.scenario.json"))
                .isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining(expected);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', textBlock = """
            no trigger                         | {"name": "s", "start": {"businessKey": "x"}}                                          | /scenarios/0/start
            message with process               | {"name": "s", "start": {"message": "m", "process": "p"}}                              | /scenarios/0/start
            timer without process              | {"name": "s", "start": {"timer": "t"}}                                                | required property 'process' not found
            signal and timer                   | {"name": "s", "start": {"signal": "g", "timer": "t", "process": "p"}}                 | /scenarios/0/start
            expectFailure with steps           | {"name": "s", "start": {"process": "p", "expectFailure": {}}, "steps": []}             | /scenarios/0
            unknown start field                | {"name": "s", "start": {"process": "p", "user_": "u"}}                                | property 'user_' is not defined
            """)
    void reportsStartProblemsWithTheirPath(String title, String scenario, String expected) {
        assertThatThrownBy(() -> loader.parse(wrap(scenario), "file.scenario.json"))
                .isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining(expected);
    }

    @Test
    void reportsEveryProblemNotJustTheFirst() {
        String json = withStep("{\"claim\": {\"user\": \"u\"}}, {\"completeTask\": {\"activity\": \"a\"}}");
        assertThatThrownBy(() -> loader.parse(json, "f"))
                .isInstanceOfSatisfying(InvalidScenarioException.class, e -> assertThat(e.problems()).hasSize(2))
                .hasMessageContaining("2 problems")
                .hasMessageContaining("steps/0/claim").hasMessageContaining("steps/1/completeTask");
    }

    @Test
    void invalidJsonIsReportedAsSuch() {
        assertThatThrownBy(() -> loader.parse("{ not json", "broken.scenario.json"))
                .isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining("broken.scenario.json is not valid")
                .hasMessageContaining("not valid JSON");
    }

    @Test
    void modelExpectAndExemptionFilesAreValidatedToo(@TempDir Path dir) throws Exception {
        Path noProcesses = dir.resolve("a.json");
        Files.writeString(noProcesses, "{ \"processes\": {} }");
        assertThatThrownBy(() -> loader.loadModelExpectations(noProcesses)).isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining("model-expect.schema.json");

        Path emptyElement = dir.resolve("b.json");
        Files.writeString(emptyElement, "{ \"processes\": { \"p\": { \"elements\": { \"t\": {} } } } }");
        assertThatThrownBy(() -> loader.loadModelExpectations(emptyElement)).isInstanceOf(InvalidScenarioException.class);

        Path noReason = dir.resolve("c.json");
        Files.writeString(noReason, "{ \"exemptions\": [ { \"element\": \"e\" } ] }");
        assertThatThrownBy(() -> loader.loadExemptions(noReason)).isInstanceOf(InvalidScenarioException.class)
                .hasMessageContaining("required property 'reason' not found");

        Path shortReason = dir.resolve("d.json");
        Files.writeString(shortReason, "{ \"exemptions\": [ { \"element\": \"e\", \"reason\": \"no\" } ] }");
        assertThatThrownBy(() -> loader.loadExemptions(shortReason)).isInstanceOf(InvalidScenarioException.class);
    }
}
