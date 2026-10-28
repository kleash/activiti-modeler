package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

/** The opt-in: with {@code modeler.server.allow-shell-tasks=true} the same model validates, deploys and runs. */
@SpringBootTest(properties = {"modeler.server.allow-shell-tasks=true", "spring.datasource.url=jdbc:h2:mem:server-shell;DB_CLOSE_DELAY=-1"})
class ShellTasksAllowedTest extends AbstractServerTest {

    @Test
    void theShellTaskDeploysAndRuns() throws Exception {
        List<Map<String, String>> project = files(file("shell.bpmn20.xml", fixture("shell.bpmn20.xml")));

        JsonNode validation = send("modeler", HttpMethod.POST, "/api/dev/validate", Map.of("files", project), 200);
        assertThat(validation.path("valid").asBoolean()).as(validation.toString()).isTrue();

        send("modeler", HttpMethod.POST, "/api/dev/deployments", Map.of("files", project), 201);
        JsonNode started = send("modeler", HttpMethod.POST, "/api/process-instances", Map.of("processKey", "shellProcess"), 201);

        assertThat(started.path("state").asText()).isEqualTo("COMPLETED");
        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("shellOutput") && v.path("value").asText().contains("hello from the shell"));
    }
}
