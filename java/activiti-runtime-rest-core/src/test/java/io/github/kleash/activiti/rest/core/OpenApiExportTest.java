package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Publishes the OpenAPI description of the core API to {@code docs/api/openapi-core.json} (keys sorted, no server URL, so that the file
 * only changes when the API does) and checks that every endpoint of the core API (docs/api/runtime-rest.md) is in it.
 */
class OpenApiExportTest extends AbstractApiTest {

    private static final List<String> EXPECTED = List.of(
            "GET /api/engine",
            "GET /api/deployments", "GET /api/deployments/{id}", "GET /api/deployments/{id}/resources", "GET /api/deployments/{id}/resource",
            "GET /api/process-definitions", "GET /api/process-definitions/{id}", "GET /api/process-definitions/{id}/xml",
            "GET /api/process-definitions/{id}/extensions", "GET /api/process-definitions/{id}/decisions",
            "POST /api/process-definitions/{id}/suspend", "POST /api/process-definitions/{id}/activate",
            "POST /api/process-instances", "GET /api/process-instances", "GET /api/process-instances/{id}", "GET /api/process-instances/{id}/path",
            "GET /api/process-instances/{id}/variables", "GET /api/process-instances/{id}/variables/history",
            "PUT /api/process-instances/{id}/variables", "DELETE /api/process-instances/{id}/variables",
            "POST /api/process-instances/{id}/suspend", "POST /api/process-instances/{id}/activate", "DELETE /api/process-instances/{id}",
            "GET /api/tasks", "GET /api/tasks/{id}", "POST /api/tasks/{id}/claim", "POST /api/tasks/{id}/release", "POST /api/tasks/{id}/assign",
            "POST /api/tasks/{id}/complete",
            "POST /api/messages", "POST /api/signals", "POST /api/executions/{id}/trigger",
            "GET /api/jobs", "GET /api/jobs/{id}", "POST /api/jobs/{id}/execute", "POST /api/jobs/{id}/retries",
            "POST /api/timers/{id}/fire", "POST /api/deadletter/{id}/retry");

    @Test
    void theOpenApiDescriptionIsExportedAndCoversEveryEndpointOfTheCoreApi() throws Exception {
        MvcResult docs = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v3/api-docs")).andReturn();
        expect(docs, 200);
        JsonNode api = mapper.readTree(docs.getResponse().getContentAsString());

        List<String> operations = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> paths = api.path("paths").fields();
        while (paths.hasNext()) {
            Map.Entry<String, JsonNode> path = paths.next();
            path.getValue().fieldNames().forEachRemaining(method -> operations.add(method.toUpperCase() + " " + path.getKey()));
        }
        assertThat(operations).containsAll(EXPECTED);
        assertThat(operations).as("nothing but the core API is described").allMatch(o -> o.contains(" /api/"));
        // every operation has a stable id
        api.path("paths").forEach(path -> path.forEach(operation -> assertThat(operation.path("operationId").asText()).isNotBlank()));

        ObjectNode canonical = (ObjectNode) canonical(api);
        canonical.remove("servers");
        Path file = docsDirectory().resolve("openapi-core.json");
        Files.createDirectories(file.getParent());
        String text = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(canonical) + "\n";
        if (!Files.exists(file) || !Files.readString(file).equals(text)) {
            Files.writeString(file, text);
        }
        assertThat(Files.readString(file)).isEqualTo(text);
    }

    static Path docsDirectory() {
        String configured = System.getProperty("docs.api.dir");
        return configured != null ? Path.of(configured) : Path.of("..", "..", "docs", "api").toAbsolutePath().normalize();
    }

    /** The document with object keys sorted (arrays keep their order). */
    static JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            ObjectNode out = new ObjectMapper().createObjectNode();
            new TreeMap<String, JsonNode>(toMap(node)).forEach((k, v) -> out.set(k, canonical(v)));
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = new ObjectMapper().createArrayNode();
            node.forEach(n -> out.add(canonical(n)));
            return out;
        }
        return node;
    }

    private static Map<String, JsonNode> toMap(JsonNode node) {
        Map<String, JsonNode> map = new java.util.LinkedHashMap<>();
        node.fields().forEachRemaining(e -> map.put(e.getKey(), e.getValue()));
        return map;
    }
}
