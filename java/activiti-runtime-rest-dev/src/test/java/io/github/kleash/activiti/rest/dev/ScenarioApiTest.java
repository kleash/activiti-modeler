package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

import com.fasterxml.jackson.databind.JsonNode;

class ScenarioApiTest extends AbstractDevTest {

    @Autowired UserDetailsService users;

    private JsonNode scenario(String resource) throws Exception {
        return mapper.readTree(resource(resource));
    }

    @Test
    void aPassingScenarioReturnsAStepByStepReportAndLeavesNothingBehind() throws Exception {
        long deployments = repository.createDeploymentQuery().count();

        JsonNode result = post("/scenarios/run", Map.of("files", grading(), "scenario", scenario("/projects/grading/grading.scenario.json")), 200);

        assertThat(result.path("passed").asBoolean()).as(result.path("rendered").asText()).isTrue();
        JsonNode report = result.path("report");
        assertThat(report.path("scenarios")).hasSize(2);
        JsonNode high = report.path("scenarios").get(0);
        assertThat(high.path("status").asText()).isEqualTo("PASSED");
        assertThat(high.path("steps")).extracting(s -> s.path("type").asText()).containsExactly("start", "expectConnectorCall", "expectTask", "completeTask");
        assertThat(high.path("steps")).allMatch(s -> s.path("status").asText().equals("PASSED"));
        assertThat(high.path("visited").path("byProcess").path("devGrading").path("nodes")).extracting(JsonNode::asText).contains("decide", "review", "done");
        assertThat(report.path("decisions").get(0).path("status").asText()).isEqualTo("PASSED");
        assertThat(result.path("rendered").asText()).contains("Scenario file 'grading' passed").contains("[ok]");

        // isolation: the run's deployment, its instances and its users are gone
        assertThat(repository.createDeploymentQuery().count()).isEqualTo(deployments);
        assertThat(runtime.createProcessInstanceQuery().count()).isZero();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> users.loadUserByUsername("rita")).isInstanceOf(UsernameNotFoundException.class);
        assertThat(org.activiti.engine.impl.identity.Authentication.getAuthenticatedUserId()).isNull();
    }

    @Test
    void aBrokenScenarioReturnsAFailingReportWithPreciseMessages() throws Exception {
        JsonNode scenario = scenario("/projects/grading/grading.scenario.json");
        ((com.fasterxml.jackson.databind.node.ObjectNode) scenario.get("scenarios").get(0).get("expect").get("variables")).put("grade", "mid");
        ((com.fasterxml.jackson.databind.node.ObjectNode) scenario.get("scenarios").get(0).get("steps").get(1).get("expectTask")).put("name", "Wrong name");

        JsonNode result = post("/scenarios/run", Map.of("files", grading(), "scenario", scenario), 200);

        assertThat(result.path("passed").asBoolean()).isFalse();
        JsonNode high = result.path("report").path("scenarios").get(0);
        assertThat(high.path("status").asText()).isEqualTo("FAILED");
        JsonNode failedStep = high.path("steps").get(2);
        assertThat(failedStep.path("status").asText()).isEqualTo("FAILED");
        assertThat(failedStep.path("message").asText()).contains("name").contains("Wrong name").contains("Review the high grade");
        assertThat(high.path("steps").get(3).path("status").asText()).isEqualTo("SKIPPED");
        // the second scenario of the file still ran and passed
        assertThat(result.path("report").path("scenarios").get(1).path("status").asText()).isEqualTo("PASSED");
        assertThat(result.path("rendered").asText()).contains("[FAIL]").contains("Wrong name");
        // and the failed run cleaned up as well
        assertThat(runtime.createProcessInstanceQuery().count()).isZero();
        assertThat(repository.createDeploymentQuery().count()).isZero();
    }

    @Test
    void theScenarioCanBeGivenAsText() throws Exception {
        JsonNode result = post("/scenarios/run", Map.of("files", grading(), "scenario", resource("/projects/grading/grading.scenario.json")), 200);

        assertThat(result.path("passed").asBoolean()).as(result.path("rendered").asText()).isTrue();
    }

    @Test
    void aScenarioThatDoesNotFollowTheSchemaIsRefusedWithItsViolations() throws Exception {
        JsonNode refused = problem(perform("admin", HttpMethod.POST, "/scenarios/run",
                Map.of("files", grading(), "scenario", Map.of("name", "x", "scenarios", java.util.List.of(Map.of("name", "no start"))))), 400);

        assertThat(refused.path("problems")).isNotEmpty();
        assertThat(refused.path("problems").get(0).asText()).contains("start");
        problem(perform("admin", HttpMethod.POST, "/scenarios/run", Map.of("files", grading())), 400);
    }

    @Test
    void aProjectWithErrorsIsNotRun() throws Exception {
        JsonNode refused = problem(perform("admin", HttpMethod.POST, "/scenarios/run", Map.of(
                "files", with(grading(), file("processes/unique-grade.dmn", "<definitions")),
                "scenario", scenario("/projects/grading/grading.scenario.json"))), 422);

        assertThat(refused.path("problems")).anyMatch(p -> p.path("key").asText().equals("dmn-parse"));
        assertThat(repository.createDeploymentQuery().count()).isZero();
    }

    @Test
    void aScenarioUserIsNeverAKnownLoginDuringTheRun() throws Exception {
        // the runner defines its users with random passwords: "rita:rita" cannot log in while a run has her defined
        String file = """
                { "name": "login", "users": { "rita": ["reviewers"] },
                  "scenarios": [ { "name": "wait", "start": { "process": "devGrading", "user": "rita", "variables": { "score": 90 } },
                                   "steps": [ { "expectTask": { "activity": "review" } } ] } ] }""";
        java.util.concurrent.atomic.AtomicInteger status = new java.util.concurrent.atomic.AtomicInteger();
        Thread prober = new Thread(() -> {
            try {
                for (int i = 0; i < 200 && status.get() == 0; i++) {
                    int code = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/engine")
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic("rita", "rita")))
                            .andReturn().getResponse().getStatus();
                    if (code != 401) {
                        status.set(code);
                    }
                    Thread.sleep(2);
                }
            } catch (Exception e) {
                status.set(-1);
            }
        });
        prober.start();
        JsonNode result = post("/scenarios/run", Map.of("files", grading(), "scenario", mapper.readTree(file)), 200);
        prober.join();

        assertThat(result.path("passed").asBoolean()).as(result.path("rendered").asText()).isTrue();
        assertThat(status.get()).as("rita:rita never authenticated").isZero();
    }
}
