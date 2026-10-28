package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.dev.web.DevController;
import io.github.kleash.activiti.rest.dev.web.WorkspaceController;

/** Every dev endpoint needs the admin access level of the core API. */
class DevSecurityTest extends AbstractDevTest {

    @Autowired ApplicationContext context;

    private static final List<String[]> ENDPOINTS = List.of(
            new String[] {"POST", "/validate"}, new String[] {"POST", "/deployments"}, new String[] {"DELETE", "/deployments/x"},
            new String[] {"POST", "/scenarios/run"}, new String[] {"POST", "/decisions/evaluate"},
            new String[] {"GET", "/workspace"}, new String[] {"GET", "/workspace/a.json"}, new String[] {"PUT", "/workspace/a.json"}, new String[] {"DELETE", "/workspace/a.json"});

    @Test
    void withoutAuthenticationEveryDevEndpointAnswers401() throws Exception {
        for (String[] endpoint : ENDPOINTS) {
            problem(perform(null, HttpMethod.valueOf(endpoint[0]), endpoint[1], "{}"), 401);
        }
    }

    @Test
    void aUserWithoutTheAdminLevelGets403OnEveryDevEndpoint() throws Exception {
        for (String[] endpoint : ENDPOINTS) {
            JsonNode refused = problem(perform("alice", HttpMethod.valueOf(endpoint[0]), endpoint[1], "{}"), 403);
            assertThat(refused.path("detail").asText()).contains("ADMIN").contains("ROLE_ACTIVITI_ADMIN");
        }
        assertThat(repository.createDeploymentQuery().count()).isZero();
    }

    @Test
    void theDevControllersAreRegisteredAndNothingInTheCoreApiIsAboutDeploying() {
        assertThat(context.getBeansOfType(DevController.class)).hasSize(1);
        assertThat(context.getBeansOfType(WorkspaceController.class)).hasSize(1);
    }

    @Test
    void thePrincipalDecidesWhoDeploys() throws Exception {
        String id = post("/deployments", Map.of("files", grading()), 201).path("deploymentId").asText();
        assertThat(repository.createDeploymentQuery().deploymentId(id).count()).isEqualTo(1);
    }
}
