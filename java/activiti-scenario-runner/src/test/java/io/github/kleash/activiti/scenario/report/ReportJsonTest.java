package io.github.kleash.activiti.scenario.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Reports are returned as JSON by the modeler server, so they must serialize cleanly (and without stack traces). */
class ReportJsonTest {

    @Test
    void aFileReportSerializesWithStepsFailuresAndVisitedElements() throws Exception {
        VisitedElements visited = VisitedElements.empty();
        visited.add("loan", Set.of("start", "review"), Set.of("f1"));
        ScenarioReport scenario = new ScenarioReport("s", Status.FAILED, 12, "pi-1",
                List.of(new StepReport(0, "start", "start process 'loan'", Status.PASSED, null, 3),
                        new StepReport(1, "expectTask", "expectTask review", Status.FAILED, "task 'review'.name: expected \"a\" but was \"b\"", 4),
                        new StepReport(2, "claim", "claim review as alice", Status.SKIPPED, null, 0)),
                List.of("step 1 (expectTask review): task 'review'.name: expected \"a\" but was \"b\""), visited,
                new IllegalStateException("not serialized"));
        FileReport file = new FileReport("f", "f.scenario.json", 20, List.of(scenario),
                List.of(new DecisionReport("d", Status.PASSED, 1, List.of(), null)), visited);

        JsonNode json = new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(file));

        assertThat(json.get("name").asText()).isEqualTo("f");
        JsonNode s = json.get("scenarios").get(0);
        assertThat(s.get("status").asText()).isEqualTo("FAILED");
        assertThat(s.get("rootProcessInstanceId").asText()).isEqualTo("pi-1");
        assertThat(s.get("steps")).hasSize(3);
        assertThat(s.get("steps").get(1).get("message").asText()).contains("expected \"a\" but was \"b\"");
        assertThat(s.get("steps").get(2).get("status").asText()).isEqualTo("SKIPPED");
        assertThat(s.has("cause")).isFalse();
        assertThat(s.get("visited").get("byProcess").get("loan").get("nodes")).hasSize(2);
        assertThat(json.get("decisions").get(0).has("cause")).isFalse();
        assertThat(file.status()).isEqualTo(Status.FAILED);
        assertThat(file.render()).contains("Scenario file 'f' FAILED").contains("[FAIL] step 1: expectTask review").contains("Decision case 'd' passed");
    }
}
