package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.activiti.engine.impl.identity.Authentication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;

/** The REST library owns no security: it checks the host's authentication, maps authorities to access levels, and bridges the principal. */
class SecurityApiTest extends AbstractApiTest {

    @Autowired ApplicationContext context;

    @Test
    void withoutAuthenticationEveryEndpointAnswers401() throws Exception {
        for (String path : List.of("/engine", "/deployments", "/process-definitions", "/process-instances", "/tasks", "/jobs")) {
            MvcResult result = perform(null, HttpMethod.GET, path, null);
            JsonNode problem = problem(result, 401);
            assertThat(problem.path("detail").asText()).contains("authenticated");
        }
        problem(perform(null, HttpMethod.POST, "/process-instances", Map.of("processKey", "restReview")), 401);
        problem(perform(null, HttpMethod.POST, "/signals", Map.of("name", "x")), 401);
        // wrong credentials are the host's business: Spring's HTTP Basic answers 401 itself
        MvcResult bad = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/engine")
                .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic("alice", "wrong"))).andReturn();
        assertThat(bad.getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void anAuthenticatedUserWithoutTheConfiguredAuthorityGets403() throws Exception {
        JsonNode problem = problem(perform("nobody", HttpMethod.GET, "/engine", null), 403);
        assertThat(problem.path("detail").asText()).contains("ROLE_ACTIVITI_USER").contains("nobody");
        problem(perform("nobody", HttpMethod.GET, "/tasks", null), 403);
        problem(perform("nobody", HttpMethod.POST, "/process-instances", Map.of("processKey", "restReview")), 403);
        // the admin-only operation: a normal user is refused, an admin passes
        String id = start("alice", "restTerminate", Map.of());
        problem(perform("alice", HttpMethod.DELETE, "/process-instances/" + id + "?purgeHistory=true", null), 403);
        send("admin", HttpMethod.DELETE, "/process-instances/" + id + "?purgeHistory=true", null, 204);
    }

    @Test
    void theLibraryContributesNoSecurityFilterChain() throws IOException {
        // the only chain in the context is the host's
        assertThat(context.getBeansOfType(SecurityFilterChain.class)).containsOnlyKeys("hostSecurityChain");

        // and no class of the module even mentions the types one is built from
        Path classes = Path.of(RestCoreAutoConfiguration.class.getProtectionDomain().getCodeSource().getLocation().getPath());
        try (Stream<Path> files = Files.walk(classes)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".class")).toList()) {
                String content = new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1);
                assertThat(content).as(file.getFileName().toString())
                        .doesNotContain("SecurityFilterChain").doesNotContain("HttpSecurity").doesNotContain("EnableWebSecurity");
            }
        }
    }

    @Test
    void thePrincipalIsTheActorAndTheThreadLocalIdentityIsClearedAfterTheRequest() throws Exception {
        // an initiator variable shows the identity that was bridged for the request
        String id = start("alice", "restReview", Map.of());
        JsonNode started = get("alice", "/process-instances/" + id);
        assertThat(started.path("startUserId").asText()).isEqualTo("alice");
        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("startedBy") && v.path("value").asText().equals("alice"));

        String other = start("bob", "restReview", Map.of());
        assertThat(get("alice", "/process-instances/" + other).path("startUserId").asText()).isEqualTo("bob");

        // MockMvc runs on this thread: nothing may remain after the requests, also not after a failing one
        assertThat(Authentication.getAuthenticatedUserId()).isNull();
        perform("alice", HttpMethod.POST, "/process-instances", Map.of("processKey", "doesNotExist"));
        assertThat(Authentication.getAuthenticatedUserId()).isNull();
        perform(null, HttpMethod.GET, "/engine", null);
        assertThat(Authentication.getAuthenticatedUserId()).isNull();

        // the task actor is the principal too: claiming records the claimer, not anybody named in the request
        String taskId = get("alice", "/tasks?processInstanceId=" + id).path("items").get(0).path("id").asText();
        assertThat(post("alice", "/tasks/" + taskId + "/claim", null, 200).path("assignee").asText()).isEqualTo("alice");
    }

    @Test
    void errorsAreProblemDocumentsWithTheEngineExceptionClass() throws Exception {
        JsonNode notFound = problem(perform("alice", HttpMethod.GET, "/process-instances/unknown", null), 404);
        assertThat(notFound.path("title").asText()).isEqualTo("Not found");
        assertThat(notFound.path("engineException").asText()).isEqualTo("org.activiti.engine.ActivitiObjectNotFoundException");
        assertThat(notFound.path("instance").asText()).isEqualTo("/api/process-instances/unknown");

        JsonNode unknownKey = problem(perform("alice", HttpMethod.POST, "/process-instances", Map.of("processKey", "doesNotExist")), 404);
        assertThat(unknownKey.path("detail").asText()).contains("doesNotExist");

        // standard MVC failures that happen once a controller is chosen have the same shape
        JsonNode unreadable = problem(perform("alice", HttpMethod.POST, "/messages", "{\"name\": "), 400);
        assertThat(unreadable.path("engineException").asText()).contains("HttpMessageNotReadableException");
        JsonNode mismatch = problem(perform("alice", HttpMethod.GET, "/process-instances?page=x", null), 400);
        assertThat(mismatch.path("engineException").asText()).contains("TypeMismatch");
        JsonNode missing = problem(perform("alice", HttpMethod.DELETE, "/process-instances/some/variables", null), 400);
        assertThat(missing.path("engineException").asText()).contains("MissingServletRequestParameterException");
    }
}
