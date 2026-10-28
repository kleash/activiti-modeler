package io.github.kleash.activiti.rest.dev;

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

/** Publishes the OpenAPI description of the dev endpoints to {@code docs/api/openapi-dev.json}. */
class OpenApiExportTest extends AbstractDevTest {

    private static final List<String> EXPECTED = List.of("POST /api/dev/validate", "POST /api/dev/deployments", "DELETE /api/dev/deployments/{id}",
            "POST /api/dev/scenarios/run", "POST /api/dev/decisions/evaluate", "GET /api/dev/workspace", "GET /api/dev/workspace/{path}",
            "PUT /api/dev/workspace/{path}", "DELETE /api/dev/workspace/{path}");

    @Test
    void theOpenApiDescriptionIsExportedAndCoversEveryDevEndpoint() throws Exception {
        MvcResult docs = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v3/api-docs")).andReturn();
        assertThat(docs.getResponse().getStatus()).isEqualTo(200);
        JsonNode api = mapper.readTree(docs.getResponse().getContentAsString());

        List<String> operations = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> paths = api.path("paths").fields();
        while (paths.hasNext()) {
            Map.Entry<String, JsonNode> path = paths.next();
            path.getValue().fieldNames().forEachRemaining(method -> operations.add(method.toUpperCase() + " " + path.getKey()));
        }
        assertThat(operations).as(operations.toString()).containsAll(EXPECTED.stream().filter(e -> !e.contains("{path}")).toList());
        assertThat(operations).anyMatch(o -> o.startsWith("GET /api/dev/workspace/")).anyMatch(o -> o.startsWith("PUT /api/dev/workspace/"));
        assertThat(operations).as("only the dev API is described").allMatch(o -> o.contains(" /api/dev/"));
        api.path("paths").forEach(path -> path.forEach(operation -> assertThat(operation.path("operationId").asText()).isNotBlank()));

        ObjectNode canonical = (ObjectNode) canonical(api);
        canonical.remove("servers");
        Path file = docsDirectory().resolve("openapi-dev.json");
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

    static JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            ObjectNode out = new ObjectMapper().createObjectNode();
            Map<String, JsonNode> sorted = new TreeMap<>();
            node.fields().forEachRemaining(e -> sorted.put(e.getKey(), e.getValue()));
            sorted.forEach((k, v) -> out.set(k, canonical(v)));
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = new ObjectMapper().createArrayNode();
            node.forEach(n -> out.add(canonical(n)));
            return out;
        }
        return node;
    }
}
