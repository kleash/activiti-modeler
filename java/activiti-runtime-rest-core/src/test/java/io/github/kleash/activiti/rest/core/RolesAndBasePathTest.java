package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.core.testapp.TestApplication;

/** {@code activiti.rest.base-path} moves the API, {@code activiti.rest.roles.*} maps authorities to access levels. */
@SpringBootTest(classes = TestApplication.class, properties = {
        "activiti.rest.base-path=/rt",
        "activiti.rest.roles.read=ROLE_VIEWER",
        "activiti.rest.roles.operate=ROLE_OPERATOR",
        "activiti.rest.roles.admin=ROLE_BOSS",
        "spring.datasource.url=jdbc:h2:mem:rest-roles;DB_CLOSE_DELAY=-1"
})
class RolesAndBasePathTest extends AbstractApiTest {

    @Override
    protected String base() {
        return "/rt";
    }

    @Test
    void theApiLivesUnderTheConfiguredBasePath() throws Exception {
        assertThat(get("viewer", "/engine").path("basePath").asText()).isEqualTo("/rt");
        // nothing answers under the default path
        assertThat(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/engine")).andReturn().getResponse().getStatus())
                .isEqualTo(404);
    }

    @Test
    void theAuthorityOfALevelGrantsThatLevelAndTheOnesBelowIt() throws Exception {
        // read: may look, may not act
        get("viewer", "/process-definitions");
        problem(perform("viewer", HttpMethod.POST, "/process-instances", Map.of("processKey", "restReview")), 403);

        // operate includes read, and acts (the runtime still wants ROLE_ACTIVITI_USER, which this user also has)
        get("operator", "/process-definitions");
        JsonNode started = post("operator", "/process-instances", Map.of("processKey", "restReview"), 201);
        assertThat(started.path("startUserId").asText()).isEqualTo("operator");
        // the identity bridge works under the moved base path
        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("startedBy") && v.path("value").asText().equals("operator"));

        // the default authority no longer opens anything
        problem(perform("alice", HttpMethod.GET, "/engine", null), 403);
        // nobody has the new admin authority: history cannot be purged
        problem(perform("operator", HttpMethod.DELETE, "/process-instances/" + started.path("id").asText() + "?purgeHistory=true", null), 403);
    }
}
