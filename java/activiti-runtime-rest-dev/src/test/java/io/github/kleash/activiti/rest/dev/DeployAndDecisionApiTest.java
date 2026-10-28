package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import com.fasterxml.jackson.databind.JsonNode;

class DeployAndDecisionApiTest extends AbstractDevTest {

    @Autowired ProcessRuntime processRuntime;
    @Autowired org.springframework.security.core.userdetails.UserDetailsService users;

    @Test
    void theFilesAreDeployedAsOneDeploymentWithTheirNamesAsGiven() throws Exception {
        JsonNode result = post("/deployments", Map.of("name", "grading project", "files", grading()), 201);

        assertThat(result.path("name").asText()).isEqualTo("grading project");
        assertThat(result.path("resources")).extracting(JsonNode::asText)
                .containsExactly("processes/grading-extensions.json", "processes/grading.bpmn20.xml", "processes/unique-grade.dmn");
        assertThat(result.path("definitions")).hasSize(1);
        JsonNode definition = result.path("definitions").get(0);
        assertThat(definition.path("key").asText()).isEqualTo("devGrading");
        assertThat(definition.path("resourceName").asText()).isEqualTo("processes/grading.bpmn20.xml");
        assertThat(result.path("decisions").get(0).path("resourceName").asText()).isEqualTo("processes/unique-grade.dmn");
        assertThat(result.path("decisions").get(0).path("decisions").get(0).path("id").asText()).isEqualTo("uniqueGrade");
        assertThat(repository.createDeploymentQuery().deploymentId(result.path("deploymentId").asText()).count()).isEqualTo(1);

        // the deployed project runs: the decision task finds its decision through the extensions and the DMN of the deployment
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(users.loadUserByUsername("admin"), null,
                users.loadUserByUsername("admin").getAuthorities()));
        try {
            var instance = processRuntime.start(ProcessPayloadBuilder.start().withProcessDefinitionKey("devGrading").withVariables(Map.of("score", 95)).build());
            assertThat(runtime.getVariable(instance.getId(), "grade")).isEqualTo("high");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void aDeploymentIsDeletedWithItsInstances() throws Exception {
        String id = post("/deployments", Map.of("files", grading()), 201).path("deploymentId").asText();

        MvcResultHolder.delete(this, "/deployments/" + id, 204);
        assertThat(repository.createDeploymentQuery().deploymentId(id).count()).isZero();
        problem(perform("admin", HttpMethod.DELETE, "/deployments/" + id, null), 404);
    }

    @Test
    void aProjectWithErrorsIsRefusedWithTheFindingsAndNothingIsDeployed() throws Exception {
        long before = repository.createDeploymentQuery().count();
        List<Map<String, String>> files = with(grading(), file("processes/unique-grade.dmn", "<definitions"));

        JsonNode refused = problem(perform("admin", HttpMethod.POST, "/deployments", Map.of("files", files)), 422);

        assertThat(refused.path("problems")).anyMatch(p -> p.path("key").asText().equals("dmn-parse"));
        assertThat(refused.path("engineException").asText()).contains("DevValidationException");
        assertThat(repository.createDeploymentQuery().count()).isEqualTo(before);
    }

    @Test
    void aDeploymentTheEngineRefusesIsReportedAsAFinding() throws Exception {
        // valid for every static check, refused by the engine when it deploys: two definitions of one message start name are fine
        // in one deployment, but a business rule task fails the deployment step itself
        String rule = """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" targetNamespace="http://example.org/dev">
                  <process id="rule" isExecutable="true"><startEvent id="s"/><sequenceFlow id="f1" sourceRef="s" targetRef="r"/>
                  <businessRuleTask id="r"/><sequenceFlow id="f2" sourceRef="r" targetRef="e"/><endEvent id="e"/></process>
                </definitions>""";
        JsonNode refused = problem(perform("admin", HttpMethod.POST, "/deployments", Map.of("files", List.of(file("rule.bpmn20.xml", rule)))), 422);

        assertThat(refused.path("problems")).anyMatch(p -> p.path("key").asText().equals("deploy") && p.path("message").asText().contains("NullPointerException"));
        assertThat(repository.createDeploymentQuery().list()).isEmpty();
    }

    @Test
    void aDecisionOfAnUploadedDmnIsEvaluatedWithRowsAndMatchedRules() throws Exception {
        JsonNode result = post("/decisions/evaluate", Map.of("dmn", corpus("C16-dmn-hit-policies", "unique-grade.dmn"), "decisionRef", "uniqueGrade",
                "inputs", Map.of("score", 65)), 200);

        assertThat(result.path("decisionId").asText()).isEqualTo("uniqueGrade");
        assertThat(result.path("matched").asBoolean()).isTrue();
        assertThat(result.path("rows")).hasSize(1);
        assertThat(result.path("rows").get(0).path("grade").asText()).isEqualTo("mid");
        assertThat(result.path("matchedRules")).extracting(JsonNode::asText).containsExactly("uniqueGrade_mid");
        assertThat(result.path("engine").asText()).isEqualTo("operaton");
        assertThat(result.path("decisions").get(0).path("hitPolicy").asText()).isEqualTo("UNIQUE");
    }

    @Test
    void aDecisionOfADeploymentIsFoundByFileNameModelNameOrDecisionId() throws Exception {
        String id = post("/deployments", Map.of("files", grading()), 201).path("deploymentId").asText();

        for (String reference : List.of("uniqueGrade", "unique-grade")) {
            JsonNode result = post("/decisions/evaluate", Map.of("deploymentId", id, "decisionRef", reference, "inputs", Map.of("score", 85)), 200);
            assertThat(result.path("rows").get(0).path("grade").asText()).as(reference).isEqualTo("high");
            assertThat(result.path("matchedRules").get(0).asText()).isEqualTo("uniqueGrade_high");
        }
        // no match: matched is false, no rows
        JsonNode none = post("/decisions/evaluate", Map.of("deploymentId", id, "decisionRef", "uniqueGrade", "inputs", Map.of("score", "n/a")), 200);
        assertThat(none.path("matched").asBoolean()).isFalse();
        assertThat(none.path("rows")).isEmpty();
    }

    @Test
    void decisionErrorsHaveTheirOwnStatuses() throws Exception {
        String dmn = corpus("C16-dmn-hit-policies", "unique-grade.dmn");
        String id = post("/deployments", Map.of("files", grading()), 201).path("deploymentId").asText();

        problem(perform("admin", HttpMethod.POST, "/decisions/evaluate", Map.of("deploymentId", id, "decisionRef", "nope", "inputs", Map.of())), 404);
        problem(perform("admin", HttpMethod.POST, "/decisions/evaluate", Map.of("dmn", "<definitions", "inputs", Map.of())), 422);
        problem(perform("admin", HttpMethod.POST, "/decisions/evaluate", Map.of("dmn", dmn, "deploymentId", id)), 400);
        problem(perform("admin", HttpMethod.POST, "/decisions/evaluate", Map.of("inputs", Map.of())), 400);
        problem(perform("admin", HttpMethod.POST, "/decisions/evaluate", Map.of("dmn", dmn, "decisionRef", "uniqueGrade", "user", "x")), 400);
    }

    /** DELETE helper. */
    private static final class MvcResultHolder {
        static void delete(AbstractDevTest test, String path, int status) throws Exception {
            var result = test.perform("admin", HttpMethod.DELETE, path, null);
            assertThat(result.getResponse().getStatus()).isEqualTo(status);
        }
    }
}
