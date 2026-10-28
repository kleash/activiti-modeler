package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;

class ValidateApiTest extends AbstractDevTest {

    private static String bpmn(String body) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn"
                             targetNamespace="http://example.org/dev">
                %s
                </definitions>""".formatted(body);
    }

    @Test
    void aGoodProjectIsValidAndEveryFileWasChecked() throws Exception {
        JsonNode result = validate(grading());

        assertThat(result.path("valid").asBoolean()).as(result.toString()).isTrue();
        assertThat(result.path("checked")).extracting(JsonNode::asText)
                .containsExactlyInAnyOrder("processes/grading.bpmn20.xml", "processes/grading-extensions.json", "processes/unique-grade.dmn");
        assertThat(result.path("asyncExecutorActive").asBoolean()).isTrue();
        assertThat(findings(result, null)).as("no problems at all").isEmpty();
    }

    @Test
    void anXsdViolationIsReportedWithItsLine() throws Exception {
        String broken = bpmn("""
                  <process id="p" isExecutable="true">
                    <startEvent id="s"/>
                    <bogusElement/>
                  </process>""");
        JsonNode result = validate(List.of(file("processes/broken.bpmn20.xml", broken)));

        assertThat(result.path("valid").asBoolean()).isFalse();
        JsonNode problem = problemOf(result, "xsd");
        assertThat(problem.path("path").asText()).isEqualTo("processes/broken.bpmn20.xml");
        assertThat(problem.path("severity").asText()).isEqualTo("error");
        assertThat(problem.path("source").asText()).isEqualTo("xsd");
        assertThat(problem.path("message").asText()).contains("bogusElement");
        assertThat(problem.path("line").asInt()).isEqualTo(6);
    }

    @Test
    void notXmlAtAllIsAParseError() throws Exception {
        JsonNode result = validate(List.of(file("processes/garbage.bpmn20.xml", "this is not xml")));

        assertThat(result.path("valid").asBoolean()).isFalse();
        assertThat(findings(result, "processes/garbage.bpmn20.xml")).hasSize(1).allMatch(f -> f.startsWith("xsd/error/"));
    }

    @Test
    void anEngineValidatorErrorNamesTheElementAndTheEnginesKey() throws Exception {
        String noImplementation = bpmn("""
                  <process id="p" isExecutable="true">
                    <startEvent id="s"/>
                    <sequenceFlow id="f1" sourceRef="s" targetRef="work"/>
                    <serviceTask id="work" name="Work"/>
                    <sequenceFlow id="f2" sourceRef="work" targetRef="e"/>
                    <endEvent id="e"/>
                  </process>""");
        JsonNode result = validate(List.of(file("processes/p.bpmn20.xml", noImplementation)));

        assertThat(result.path("valid").asBoolean()).isFalse();
        JsonNode problem = result.path("problems").get(0);
        assertThat(problem.path("source").asText()).isEqualTo("engine-validate");
        assertThat(problem.path("severity").asText()).isEqualTo("error");
        assertThat(problem.path("elementId").asText()).isEqualTo("work");
        assertThat(problem.path("key").asText()).isEqualTo("activiti-servicetask-missing-implementation");
        assertThat(problem.path("line").asInt()).isPositive();
    }

    @Test
    void aBusinessRuleTaskIsCaughtByTheTrialDeploymentBecauseOnlyDeploymentFailsOnIt() throws Exception {
        String businessRule = bpmn("""
                  <process id="p" isExecutable="true">
                    <startEvent id="s"/>
                    <sequenceFlow id="f1" sourceRef="s" targetRef="rule"/>
                    <businessRuleTask id="rule" name="Rule" activiti:resultVariable="r"/>
                    <sequenceFlow id="f2" sourceRef="rule" targetRef="e"/>
                    <endEvent id="e"/>
                  </process>""");
        List<Map<String, String>> files = List.of(file("processes/rule.bpmn20.xml", businessRule),
                file("processes/fine.bpmn20.xml", bpmn("""
                  <process id="fine" isExecutable="true"><startEvent id="s"/><sequenceFlow id="f" sourceRef="s" targetRef="e"/><endEvent id="e"/></process>""")));
        int deploymentsBefore = repository.createDeploymentQuery().list().size();

        JsonNode result = validate(files);

        assertThat(result.path("valid").asBoolean()).isFalse();
        JsonNode problem = problemOf(result, "trial-deploy");
        assertThat(problem.path("source").asText()).isEqualTo("trial-deploy");
        assertThat(problem.path("path").asText()).as("attributed to the file that fails on its own").isEqualTo("processes/rule.bpmn20.xml");
        assertThat(problem.path("message").asText()).contains("NullPointerException");
        // nothing reached the real engine
        assertThat(repository.createDeploymentQuery().list()).hasSize(deploymentsBefore);
        assertThat(findings(result, "processes/fine.bpmn20.xml")).isEmpty();
    }

    @Test
    void aFailureOnlyTheCombinationHasIsReportedForTheProject() throws Exception {
        String one = bpmn("<process id=\"same\" isExecutable=\"true\"><startEvent id=\"s\"/><sequenceFlow id=\"f\" sourceRef=\"s\" targetRef=\"e\"/><endEvent id=\"e\"/></process>");
        String two = bpmn("<process id=\"same\" isExecutable=\"true\"><startEvent id=\"s2\"/><sequenceFlow id=\"f2\" sourceRef=\"s2\" targetRef=\"e2\"/><endEvent id=\"e2\"/></process>");
        JsonNode result = validate(List.of(file("a.bpmn20.xml", one), file("b.bpmn20.xml", two)));

        // each file deploys on its own; together they define one process key twice, which a deployment refuses: a finding for the project
        assertThat(result.path("valid").asBoolean()).isFalse();
        JsonNode problem = problemOf(result, "trial-deploy");
        assertThat(problem.has("path")).as("not attributable to one file").isFalse();
        assertThat(problem.path("message").asText()).contains("same key");
    }

    @Test
    void malformedExtensionsJsonIsReportedWithLineAndColumn() throws Exception {
        List<Map<String, String>> files = with(grading(), file("processes/grading-extensions.json", "{\n  \"extensions\": {\n    \"devGrading\": { \"properties\": \n"));
        JsonNode result = validate(files);

        assertThat(result.path("valid").asBoolean()).isFalse();
        JsonNode problem = problemOf(result, "extensions-json");
        assertThat(problem.path("path").asText()).isEqualTo("processes/grading-extensions.json");
        assertThat(problem.path("source").asText()).isEqualTo("extensions");
        assertThat(problem.path("line").asInt()).isGreaterThanOrEqualTo(3);
        assertThat(problem.path("message").asText()).contains("Unexpected end-of-input");
    }

    @Test
    void jsonThatTheRuntimeCannotMapIsReportedToo() throws Exception {
        List<Map<String, String>> files = with(grading(), file("processes/grading-extensions.json", "{ \"extensions\": [1, 2] }"));
        JsonNode result = validate(files);

        assertThat(result.path("valid").asBoolean()).isFalse();
        assertThat(problemOf(result, "extensions-json").path("message").asText()).contains("cannot read");
    }

    @Test
    void extensionsThatPointAtNothingOrDropOutputsAreWarnings() throws Exception {
        String extensions = """
                { "id": "x", "extensions": {
                    "devGrading": {
                      "properties": { "p1": { "id": "p1", "name": "score", "type": "integer" } },
                      "constants": { "ghost": { "a": { "value": 1 } }, "decide": { "_activiti_dmn_table_": { "value": "noSuchDecision" } } },
                      "mappings": { "decide": { "outputs": { "undeclared": { "type": "variable", "value": "grade" } } } }
                    },
                    "otherProcess": { "properties": {} }
                } }""";
        JsonNode result = validate(with(grading(), file("processes/grading-extensions.json", extensions)));

        assertThat(result.path("valid").asBoolean()).as("warnings do not make a project invalid").isTrue();
        assertThat(problemOf(result, "extensions-unknown-element").path("elementId").asText()).isEqualTo("ghost");
        assertThat(problemOf(result, "extensions-undeclared-output").path("message").asText()).contains("undeclared").contains("drops");
        assertThat(problemOf(result, "extensions-unknown-process").path("message").asText()).contains("otherProcess");
        assertThat(problemOf(result, "dmn-decision-not-found").path("message").asText()).contains("noSuchDecision");
        assertThat(problemOf(result, "dmn-decision-not-found").path("elementId").asText()).isEqualTo("decide");
    }

    @Test
    void aDecisionTaskWithoutItsConstantIsAWarning() throws Exception {
        JsonNode result = validate(with(grading(), file("processes/grading-extensions.json",
                "{ \"id\": \"x\", \"extensions\": { \"devGrading\": { \"properties\": {} } } }")));

        assertThat(problemOf(result, "dmn-constant-missing").path("elementId").asText()).isEqualTo("decide");
    }

    @Test
    void aDmnParseErrorAndADmnTheEngineCannotRunAreErrors() throws Exception {
        JsonNode broken = validate(with(grading(), file("processes/unique-grade.dmn", "<definitions")));
        assertThat(broken.path("valid").asBoolean()).isFalse();
        assertThat(problemOf(broken, "dmn-parse").path("path").asText()).isEqualTo("processes/unique-grade.dmn");
        assertThat(problemOf(broken, "dmn-parse").path("source").asText()).isEqualTo("dmn");

        JsonNode kieOnly = validate(List.of(file("processes/pricing.dmn", corpus("C17-dmn-drd-kie", "pricing.dmn"))));
        assertThat(problemOf(kieOnly, "dmn-parse").path("message").asText()).contains("business knowledge model").contains("activiti.dmn.engine=kie");
    }

    @Test
    void requestMistakesAreFlaggedNotIgnored() throws Exception {
        JsonNode duplicate = validate(List.of(file("a.dmn", "x"), file("a.dmn", "y")));
        assertThat(findings(duplicate, "a.dmn")).contains("request/error/duplicate-path");

        JsonNode unknown = validate(List.of(file("notes.txt", "hello"), file("p.bpmn20.xml", bpmn("<process id=\"p\" isExecutable=\"true\"><startEvent id=\"s\"/></process>"))));
        assertThat(findings(unknown, "notes.txt")).containsExactly("request/info/unknown-file-type");

        problem(perform("admin", org.springframework.http.HttpMethod.POST, "/validate", Map.of("files", List.of())), 400);
        problem(perform("admin", org.springframework.http.HttpMethod.POST, "/validate", Map.of("files", List.of(Map.of("path", "", "content", "x")))), 400);
        problem(perform("admin", org.springframework.http.HttpMethod.POST, "/validate", Map.of("files", List.of(), "user", "bob")), 400);
    }

    @Test
    void asynchronousElementsGiveNoWarningsWhileTheExecutorRuns() throws Exception {
        String xml = bpmn("""
                  <process id="asyncP" isExecutable="true">
                    <startEvent id="s"/>
                    <sequenceFlow id="f1" sourceRef="s" targetRef="work"/>
                    <serviceTask id="work" activiti:async="true" activiti:class="java.lang.Object"/>
                    <sequenceFlow id="f2" sourceRef="work" targetRef="e"/>
                    <endEvent id="e"/>
                  </process>""");
        JsonNode result = validate(List.of(file("async.bpmn20.xml", xml)));

        assertThat(result.path("asyncExecutorActive").asBoolean()).isTrue();
        assertThat(findings(result, null)).isEmpty();
    }

    @Test
    void validationDoesNotTouchTheRunningEngine() throws Exception {
        long deployments = repository.createDeploymentQuery().count();
        validate(grading());
        assertThat(repository.createDeploymentQuery().count()).isEqualTo(deployments);
        assertThat(repository.createProcessDefinitionQuery().processDefinitionKey("devGrading").count()).isZero();
    }
}
