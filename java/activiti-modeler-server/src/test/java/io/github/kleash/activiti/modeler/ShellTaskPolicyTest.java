package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;

/** Shell tasks are refused at every door unless {@code modeler.server.allow-shell-tasks=true}. */
class ShellTaskPolicyTest extends AbstractServerTest {

    @Test
    void aShellTaskIsAnErrorForValidateDeployAndScenarioRun() throws Exception {
        List<Map<String, String>> project = files(file("shell.bpmn20.xml", fixture("shell.bpmn20.xml")));

        JsonNode validation = send("modeler", HttpMethod.POST, "/api/dev/validate", Map.of("files", project), 200);
        assertThat(validation.path("valid").asBoolean()).isFalse();
        JsonNode problem = validation.path("problems").get(0);
        assertThat(problem.path("key").asText()).isEqualTo("modeler-shell-task-not-allowed");
        assertThat(problem.path("elementId").asText()).isEqualTo("run");
        assertThat(problem.path("message").asText()).contains("modeler.server.allow-shell-tasks=true");

        MvcResult deploy = perform("modeler", HttpMethod.POST, "/api/dev/deployments", Map.of("files", project));
        assertThat(deploy.getResponse().getStatus()).isEqualTo(422);
        assertThat(json(deploy).path("problems")).anyMatch(p -> p.path("key").asText().equals("modeler-shell-task-not-allowed"));

        String scenario = "{ \"name\": \"s\", \"scenarios\": [ { \"name\": \"x\", \"start\": { \"process\": \"shellProcess\" } } ] }";
        MvcResult run = perform("modeler", HttpMethod.POST, "/api/dev/scenarios/run", Map.of("files", project, "scenario", mapper.readTree(scenario)));
        assertThat(run.getResponse().getStatus()).isEqualTo(422);

        assertThat(userDeployments()).isEmpty();
    }

    @Test
    void theEngineItselfRefusesAShellTaskToo() {
        // not only the dev endpoints: a deployment made directly against the engine goes through the same validation
        assertThatThrownBy(() -> repository.createDeployment().addString("shell.bpmn20.xml", fixture("shell.bpmn20.xml")).deploy())
                .hasMessageContaining("modeler-shell-task-not-allowed");
        assertThat(userDeployments()).isEmpty();
    }

    /** Deployments other than the engine's own (empty) auto-deployment at startup. */
    private List<String> userDeployments() {
        return repository.createDeploymentQuery().list().stream().map(d -> d.getName()).filter(n -> !"SpringAutoDeployment".equals(n)).toList();
    }
}
