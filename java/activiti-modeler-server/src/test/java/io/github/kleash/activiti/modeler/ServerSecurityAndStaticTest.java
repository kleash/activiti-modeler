package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.fasterxml.jackson.databind.JsonNode;

class ServerSecurityAndStaticTest extends AbstractServerTest {

    @Autowired ServerProperties serverProperties;

    @Test
    void theServerListensOnTheLoopbackAddressByDefault() {
        assertThat(serverProperties.getAddress()).isNotNull();
        assertThat(serverProperties.getAddress().getHostAddress()).isEqualTo("127.0.0.1");
    }

    @Test
    void healthIsPublicAndEverythingElseOfTheApiNeedsAUser() throws Exception {
        assertThat(send(null, HttpMethod.GET, "/api/health", null, 200).path("status").asText()).isEqualTo("UP");

        MvcResult anonymous = perform(null, HttpMethod.GET, "/api/engine", null);
        assertThat(anonymous.getResponse().getStatus()).isEqualTo(401);
        assertThat(anonymous.getResponse().getHeader("WWW-Authenticate")).startsWith("Basic");
        assertThat(anonymous.getResponse().getContentType()).startsWith("application/problem+json");

        // a script (Accept: json) gets the 401 without the browser's sign-in dialog
        MvcResult script = mvc.perform(MockMvcRequestBuilders.get("/api/engine").accept("application/json")).andReturn();
        assertThat(script.getResponse().getStatus()).isEqualTo(401);
        assertThat(script.getResponse().getHeader("WWW-Authenticate")).isNull();

        MvcResult wrong = mvc.perform(MockMvcRequestBuilders.get("/api/engine").with(httpBasic("modeler", "wrong"))).andReturn();
        assertThat(wrong.getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void theDemoUsersHaveTheirAuthorities() throws Exception {
        JsonNode engine = send("modeler", HttpMethod.GET, "/api/engine", null, 200);
        // surefire sets expected.activiti.version from ${activiti.version} (8.8.1 under -Pactiviti8); 9.0.0 when run from an IDE
        assertThat(engine.path("activitiVersion").asText()).isEqualTo(System.getProperty("expected.activiti.version", "9.0.0"));
        assertThat(engine.path("historyLevel").asText()).isEqualTo("full");
        assertThat(engine.path("asyncExecutor").path("active").asBoolean()).as("the async executor runs").isTrue();
        assertThat(engine.path("dmn").path("engine").asText()).isEqualTo("operaton");
        assertThat(engine.path("connectors")).extracting(JsonNode::asText).contains("echo.EXECUTE", "http.GET", "crm.LOOKUP", "dmn-connector.EXECUTE_TABLE");

        // alice may use the API but not the dev endpoints (admin)
        send("alice", HttpMethod.GET, "/api/engine", null, 200);
        assertThat(perform("alice", HttpMethod.POST, "/api/dev/validate", "{\"files\":[]}").getResponse().getStatus()).isEqualTo(403);
        assertThat(perform("alice", HttpMethod.GET, "/api/dev/workspace", null).getResponse().getStatus()).isEqualTo(403);
        send("modeler", HttpMethod.GET, "/api/dev/workspace", null, 200);
    }

    @Test
    void theOpenApiDescriptionCoversCoreDevAndServerAndNeedsAUser() throws Exception {
        assertThat(perform(null, HttpMethod.GET, "/v3/api-docs", null).getResponse().getStatus()).isEqualTo(401);
        JsonNode api = send("modeler", HttpMethod.GET, "/v3/api-docs", null, 200);
        assertThat(api.path("info").path("title").asText()).isEqualTo("Activiti modeler server API");
        java.util.List<String> paths = new java.util.ArrayList<>();
        api.path("paths").fieldNames().forEachRemaining(paths::add);
        assertThat(paths).contains("/api/engine", "/api/process-instances", "/api/tasks/{id}/complete", "/api/timers/{id}/fire", "/api/health",
                "/api/dev/validate", "/api/dev/scenarios/run", "/api/dev/mail");
    }

    private static boolean isIndexPage(String html) {
        return html.contains("Activiti modeler server") || html.contains("<div id=\"root\">");
    }

    @Test
    void theStaticAppAndItsRoutesArePublicAndTheApiNeverFallsBackToIt() throws Exception {
        MvcResult index = perform(null, HttpMethod.GET, "/index.html", null);
        assertThat(index.getResponse().getStatus()).isEqualTo(200);
        // the app looks for this header on its own page before it asks for /api/health (a failed request would be a console error elsewhere)
        assertThat(index.getResponse().getHeader("X-Activiti-Modeler-Server")).isEqualTo("1");
        // the placeholder page, or the modeler app when target/classes holds a build made with -Pbundle-modeler
        assertThat(index.getResponse().getContentAsString()).matches(ServerSecurityAndStaticTest::isIndexPage);
        // the root is the welcome page: the container forwards it to index.html (MockMvc does not follow the forward)
        assertThat(perform(null, HttpMethod.GET, "/", null).getResponse().getForwardedUrl()).isEqualTo("index.html");
        // a client-side route: index.html
        assertThat(perform(null, HttpMethod.GET, "/projects/shop/order", null).getResponse().getContentAsString()).matches(ServerSecurityAndStaticTest::isIndexPage);
        // a missing asset is a 404, not the app
        assertThat(perform(null, HttpMethod.GET, "/assets/missing.js", null).getResponse().getStatus()).isEqualTo(404);
        // an unknown API address is a 404 problem for a signed-in user, never the app
        MvcResult unknown = perform("modeler", HttpMethod.GET, "/api/nothing-here", null);
        assertThat(unknown.getResponse().getStatus()).isEqualTo(404);
        assertThat(unknown.getResponse().getContentAsString()).doesNotContain("<html");
    }

    @Test
    void corsAllowsTheViteDevOriginOnly() throws Exception {
        MvcResult allowed = mvc.perform(MockMvcRequestBuilders.options("/api/engine").header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "authorization")).andReturn();
        assertThat(allowed.getResponse().getStatus()).isEqualTo(200);
        assertThat(allowed.getResponse().getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:5173");
        assertThat(allowed.getResponse().getHeader("Access-Control-Allow-Headers")).containsIgnoringCase("authorization");

        MvcResult preview = mvc.perform(MockMvcRequestBuilders.options("/api/engine").header("Origin", "http://localhost:4173")
                .header("Access-Control-Request-Method", "GET")).andReturn();
        assertThat(preview.getResponse().getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:4173");

        MvcResult foreign = mvc.perform(MockMvcRequestBuilders.options("/api/engine").header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "GET")).andReturn();
        assertThat(foreign.getResponse().getStatus()).isEqualTo(403);
        assertThat(foreign.getResponse().getHeader("Access-Control-Allow-Origin")).isNull();

        // a real request from the dev origin carries the header; one from another origin does not
        MvcResult actual = mvc.perform(MockMvcRequestBuilders.get("/api/engine").header("Origin", "http://localhost:5173").with(httpBasic("modeler", "modeler"))).andReturn();
        assertThat(actual.getResponse().getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:5173");
        MvcResult other = mvc.perform(MockMvcRequestBuilders.get("/api/engine").header("Origin", "https://evil.example").with(httpBasic("modeler", "modeler"))).andReturn();
        assertThat(other.getResponse().getStatus()).isEqualTo(403);
    }

    @Test
    void errorsBeforeAControllerIsChosenAreProblemDocumentsToo() throws Exception {
        MvcResult method = perform("modeler", HttpMethod.PATCH, "/api/process-instances", null);
        assertThat(method.getResponse().getStatus()).isEqualTo(405);
        assertThat(method.getResponse().getContentType()).startsWith("application/problem+json");
    }
}
