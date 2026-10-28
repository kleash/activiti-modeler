package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Publishes the OpenAPI description of the whole server (core, dev and the server's own endpoints) to {@code docs/api/openapi-server.json}.
 * The runtime client's types are generated from the {@code docs/api/openapi-*.json} files.
 */
class OpenApiExportTest extends AbstractServerTest {

    @Test
    void theWholeApiIsExported() throws Exception {
        JsonNode api = send("modeler", HttpMethod.GET, "/v3/api-docs", null, 200);
        assertThat(api.path("paths").has("/api/health")).isTrue();
        assertThat(api.path("paths").has("/api/dev/mail")).isTrue();
        assertThat(api.path("paths").has("/api/process-instances")).isTrue();
        assertThat(api.path("paths").has("/api/dev/validate")).isTrue();

        ObjectNode canonical = (ObjectNode) canonical(api);
        canonical.remove("servers");
        Path directory = System.getProperty("docs.api.dir") != null ? Path.of(System.getProperty("docs.api.dir"))
                : Path.of("..", "..", "docs", "api").toAbsolutePath().normalize();
        Path file = directory.resolve("openapi-server.json");
        Files.createDirectories(directory);
        String text = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(canonical) + "\n";
        if (!Files.exists(file) || !Files.readString(file).equals(text)) {
            Files.writeString(file, text);
        }
        assertThat(Files.readString(file)).isEqualTo(text);
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
