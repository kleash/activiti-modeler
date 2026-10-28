package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.fasterxml.jackson.databind.JsonNode;

class WorkspaceApiTest extends AbstractDevTest {

    @Test
    void filesAreWrittenReadListedAndDeleted() throws Exception {
        String xml = "<definitions>one</definitions>";
        MvcResult created = perform("admin", HttpMethod.PUT, "/workspace/shop/processes/order.bpmn20.xml", xml, MediaType.APPLICATION_XML);
        assertThat(created.getResponse().getStatus()).isEqualTo(201);
        assertThat(Files.readString(WORKSPACE.resolve("shop/processes/order.bpmn20.xml"))).isEqualTo(xml);

        // replace: 204, atomically
        MvcResult replaced = perform("admin", HttpMethod.PUT, "/workspace/shop/processes/order.bpmn20.xml", "<definitions>two</definitions>", MediaType.APPLICATION_XML);
        assertThat(replaced.getResponse().getStatus()).isEqualTo(204);
        perform("admin", HttpMethod.PUT, "/workspace/shop/processes/order-extensions.json", "{\"extensions\":{}}", MediaType.APPLICATION_JSON);

        MvcResult read = perform("admin", HttpMethod.GET, "/workspace/shop/processes/order.bpmn20.xml", null);
        assertThat(read.getResponse().getStatus()).isEqualTo(200);
        assertThat(read.getResponse().getContentAsString()).isEqualTo("<definitions>two</definitions>");
        assertThat(read.getResponse().getContentType()).startsWith("application/xml");
        assertThat(perform("admin", HttpMethod.GET, "/workspace/shop/processes/order-extensions.json", null).getResponse().getContentType()).startsWith("application/json");

        JsonNode root = json(perform("admin", HttpMethod.GET, "/workspace", null));
        assertThat(root.path("path").asText()).isEmpty();
        assertThat(root.path("entries")).anyMatch(e -> e.path("path").asText().equals("shop") && e.path("type").asText().equals("directory"));
        JsonNode directory = json(perform("admin", HttpMethod.GET, "/workspace/shop/processes", null));
        assertThat(directory.path("entries")).extracting(e -> e.path("path").asText())
                .containsExactly("shop/processes/order-extensions.json", "shop/processes/order.bpmn20.xml");
        assertThat(directory.path("entries").get(0).path("size").asLong()).isPositive();
        JsonNode tree = json(perform("admin", HttpMethod.GET, "/workspace?recursive=true", null));
        assertThat(tree.path("entries")).extracting(e -> e.path("path").asText()).contains("shop", "shop/processes", "shop/processes/order.bpmn20.xml");

        // a directory with files needs recursive=true
        problem(perform("admin", HttpMethod.DELETE, "/workspace/shop", null), 409);
        assertThat(perform("admin", HttpMethod.DELETE, "/workspace/shop/processes/order.bpmn20.xml", null).getResponse().getStatus()).isEqualTo(204);
        problem(perform("admin", HttpMethod.GET, "/workspace/shop/processes/order.bpmn20.xml", null), 404);
        assertThat(perform("admin", HttpMethod.DELETE, "/workspace/shop?recursive=true", null).getResponse().getStatus()).isEqualTo(204);
        assertThat(WORKSPACE.resolve("shop")).doesNotExist();
    }

    @Test
    void onlyProjectFileTypesAreServedAndWritten() throws Exception {
        JsonNode refused = problem(perform("admin", HttpMethod.PUT, "/workspace/run.sh", "rm -rf /", MediaType.TEXT_PLAIN), 403);
        assertThat(refused.path("detail").asText()).contains("project files only");
        assertThat(WORKSPACE.resolve("run.sh")).doesNotExist();

        Files.writeString(WORKSPACE.resolve("secret.pem"), "-----BEGIN");
        problem(perform("admin", HttpMethod.GET, "/workspace/secret.pem", null), 403);
        assertThat(json(perform("admin", HttpMethod.GET, "/workspace", null)).path("entries")).noneMatch(e -> e.path("path").asText().equals("secret.pem"));
        Files.delete(WORKSPACE.resolve("secret.pem"));
    }

    @Test
    void pathsThatClimbOutOfTheWorkspaceAreRefused() throws Exception {
        Path outside = Files.createTempFile("outside", ".json");
        Files.writeString(outside, "{\"secret\":true}");
        try {
            for (String attack : new String[] {"/workspace/%2e%2e/" + outside.getFileName(), "/workspace/a/%2e%2e/%2e%2e/" + outside.getFileName(),
                "/workspace/..%2f" + outside.getFileName(), "/workspace/%2e%2e%2f%2e%2e%2fetc/passwd.json"}) {
                int status;
                String body = "";
                try {
                    MvcResult result = mvc.perform(MockMvcRequestBuilders.get(URI.create("/api/dev/workspace" + attack.substring("/workspace".length())))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic("admin", "admin"))).andReturn();
                    status = result.getResponse().getStatus();
                    body = result.getResponse().getContentAsString();
                } catch (Exception rejected) {
                    // the servlet container's or Spring Security's firewall refused the path before it reached the controller
                    status = 400;
                }
                assertThat(status).as(attack).isBetween(400, 404);
                assertThat(body).as(attack).doesNotContain("secret");
            }
            MvcResult put = null;
            try {
                put = perform("admin", HttpMethod.PUT, "/workspace/x/../../" + outside.getFileName(), "{}");
            } catch (Exception rejected) {
                // refused by the firewall in front of the controller
            }
            if (put != null) {
                assertThat(put.getResponse().getStatus()).isBetween(400, 404);
            }
            assertThat(Files.readString(outside)).isEqualTo("{\"secret\":true}");
        } finally {
            Files.deleteIfExists(outside);
        }
    }

    @Test
    void theWorkspaceRootCannotBeDeletedOrOverwritten() throws Exception {
        problem(perform("admin", HttpMethod.DELETE, "/workspace/", null), 400);
        problem(perform("admin", HttpMethod.PUT, "/workspace/.hidden.json", "{}"), 400);
        problem(perform("admin", HttpMethod.PUT, "/workspace/.git/config.json", "{}"), 400);
    }
}
