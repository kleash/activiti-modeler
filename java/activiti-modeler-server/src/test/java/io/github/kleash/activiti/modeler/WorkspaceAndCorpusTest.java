package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

/** The workspace through the real security, and corpus projects run through the dev endpoints on the server's engine. */
class WorkspaceAndCorpusTest extends AbstractServerTest {

    @Test
    void theWorkspaceFolderIsServedOnlyToAnAdmin() throws Exception {
        assertThat(perform("modeler", HttpMethod.PUT, "/api/dev/workspace/shop/processes/a.bpmn20.xml", "<definitions/>").getResponse().getStatus()).isEqualTo(201);
        assertThat(Files.readString(WORKSPACE.resolve("shop/processes/a.bpmn20.xml"))).isEqualTo("<definitions/>");
        assertThat(perform("alice", HttpMethod.GET, "/api/dev/workspace/shop/processes/a.bpmn20.xml", null).getResponse().getStatus()).isEqualTo(403);
        assertThat(perform(null, HttpMethod.GET, "/api/dev/workspace/shop/processes/a.bpmn20.xml", null).getResponse().getStatus()).isEqualTo(401);
        assertThat(perform("modeler", HttpMethod.GET, "/api/dev/workspace/shop/processes/a.bpmn20.xml", null).getResponse().getContentAsString()).isEqualTo("<definitions/>");
        assertThat(perform("modeler", HttpMethod.DELETE, "/api/dev/workspace/shop?recursive=true", null).getResponse().getStatus()).isEqualTo(204);
    }

    @TestFactory
    List<DynamicTest> corpusScenariosRunOnTheServersEngine() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        for (String project : List.of("C16-dmn-hit-policies", "C17-dmn-drd")) {
            Path processes = Path.of("..", "..", "corpus", project, "seed", "processes");
            List<Map<String, String>> files = new ArrayList<>();
            try (Stream<Path> list = Files.list(processes)) {
                for (Path path : list.sorted().toList()) {
                    String name = path.getFileName().toString();
                    if (name.endsWith(".bpmn20.xml") || name.endsWith(".dmn") || name.endsWith("-extensions.json")) {
                        files.add(file("processes/" + name, Files.readString(path)));
                    }
                }
            }
            try (Stream<Path> scenarios = Files.list(Path.of("..", "..", "corpus", project, "scenarios"))) {
                for (Path scenario : scenarios.filter(p -> p.getFileName().toString().endsWith(".scenario.json")).sorted().toList()) {
                    tests.add(DynamicTest.dynamicTest(project + "/" + scenario.getFileName(), () -> {
                        JsonNode result = send("modeler", HttpMethod.POST, "/api/dev/scenarios/run",
                                Map.of("files", files, "scenario", mapper.readTree(Files.readString(scenario))), 200);
                        assertThat(result.path("passed").asBoolean()).as(result.path("rendered").asText()).isTrue();
                    }));
                }
            }
        }
        return tests;
    }
}
