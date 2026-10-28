package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

class EngineAndDefinitionsApiTest extends AbstractApiTest {

    @Test
    void engineReportsVersionsHistoryExecutorDmnConnectorsBeansAndScriptEngines() throws Exception {
        JsonNode engine = get("alice", "/engine");

        // the build says which engine it runs (surefire: ${activiti.version}, 8.8.1 under -Pactiviti8); 9.0.0 when run from an IDE
        assertThat(engine.path("activitiVersion").asText()).isEqualTo(System.getProperty("expected.activiti.version", "9.0.0"));
        assertThat(engine.path("springBootVersion").asText()).startsWith("3.5.");
        // the JVM running the test, which must be at least the profile's minimum (25 for Activiti 9.0.0, 21 for 8.8.1)
        assertThat(engine.path("javaVersion").asText()).startsWith(String.valueOf(Runtime.version().feature()));
        assertThat(Runtime.version().feature()).isGreaterThanOrEqualTo(Integer.getInteger("expected.java.minimum", 25));
        assertThat(engine.path("historyLevel").asText()).isEqualTo("full");
        assertThat(engine.path("dbHistoryUsed").asBoolean()).isTrue();
        assertThat(engine.path("deploymentMode").asText()).isEqualTo("default");
        assertThat(engine.path("asyncExecutor").path("configured").asBoolean()).isFalse();
        assertThat(engine.path("asyncExecutor").path("active").asBoolean()).isFalse();
        assertThat(engine.path("dmn").path("available").asBoolean()).isTrue();
        assertThat(engine.path("dmn").path("engine").asText()).isEqualTo("operaton");
        assertThat(strings(engine.path("connectors"))).contains("test.EXECUTE", "dmn-connector.EXECUTE_TABLE");
        assertThat(strings(engine.path("beans"))).contains("greeter").doesNotContain("test.EXECUTE");
        List<String> languages = new ArrayList<>();
        engine.path("scriptEngines").forEach(e -> e.path("languages").forEach(l -> languages.add(l.asText())));
        assertThat(languages).contains("juel");
        assertThat(engine.path("basePath").asText()).isEqualTo("/api");
    }

    @Test
    void deploymentsAndTheirResourcesAreListed() throws Exception {
        String id = fixtures.deploy();

        JsonNode page = get("alice", "/deployments?nameLike=rest-fix");
        assertThat(page.path("total").asLong()).isEqualTo(1);
        assertThat(page.path("items").get(0).path("id").asText()).isEqualTo(id);
        assertThat(page.path("items").get(0).path("name").asText()).isEqualTo("rest-fixtures");

        JsonNode resources = get("alice", "/deployments/" + id + "/resources");
        Map<String, String> kinds = new java.util.LinkedHashMap<>();
        resources.forEach(r -> kinds.put(r.path("name").asText(), r.path("kind").asText()));
        assertThat(kinds).containsEntry("rest-review.bpmn20.xml", "bpmn").containsEntry("rest-review-extensions.json", "extensions");

        var content = perform("alice", HttpMethod.GET, "/deployments/" + id + "/resource?name=rest-review-extensions.json", null);
        expect(content, 200);
        assertThat(content.getResponse().getContentType()).startsWith("application/json");
        assertThat(content.getResponse().getContentAsString()).contains("restReview");

        JsonNode missing = problem(perform("alice", HttpMethod.GET, "/deployments/nope/resources", null), 404);
        assertThat(missing.path("engineException").asText()).isEqualTo("org.activiti.engine.ActivitiObjectNotFoundException");
        assertThat(missing.path("detail").asText()).contains("nope");
        problem(perform("alice", HttpMethod.GET, "/deployments/" + id + "/resource?name=absent.txt", null), 404);
    }

    @Test
    void processDefinitionsCarryTheirBpmnExtensionsAndDecisions() throws Exception {
        JsonNode page = get("alice", "/process-definitions?key=restReview&includeCounts=true");
        assertThat(page.path("items")).hasSize(1);
        JsonNode definition = page.path("items").get(0);
        assertThat(definition.path("key").asText()).isEqualTo("restReview");
        assertThat(definition.path("name").asText()).isEqualTo("Review");
        assertThat(definition.path("suspended").asBoolean()).isFalse();
        assertThat(definition.path("runningInstances").asLong()).isZero();

        // by id and by key
        assertThat(get("alice", "/process-definitions/" + definition.path("id").asText()).path("key").asText()).isEqualTo("restReview");
        assertThat(get("alice", "/process-definitions/restReview").path("id").asText()).isEqualTo(definition.path("id").asText());

        var xml = perform("alice", HttpMethod.GET, "/process-definitions/restReview/xml", null);
        expect(xml, 200);
        assertThat(xml.getResponse().getContentType()).startsWith("application/xml");
        assertThat(xml.getResponse().getContentAsString()).contains("<process id=\"restReview\"").contains("f_decide_approved");

        JsonNode extensions = get("alice", "/process-definitions/restReview/extensions");
        assertThat(extensions.path("resourceName").asText()).isEqualTo("rest-review-extensions.json");
        assertThat(extensions.path("extensions").path("properties").path("p1").path("name").asText()).isEqualTo("amount");
        problem(perform("alice", HttpMethod.GET, "/process-definitions/restWaitsNoSuch/extensions", null), 404);
        // a definition whose deployment has no entry for it
        problem(perform("alice", HttpMethod.GET, "/process-definitions/restFlaky/extensions", null), 404);

        JsonNode decisions = get("alice", "/process-definitions/restReview/decisions");
        assertThat(decisions.path("dmnAvailable").asBoolean()).isTrue();
        assertThat(decisions.path("resources")).isEmpty();
    }

    @Test
    void aSuspendedDefinitionRefusesNewInstances() throws Exception {
        post("admin", "/process-definitions/restTerminate/suspend", null, 204);
        try {
            assertThat(get("alice", "/process-definitions/restTerminate").path("suspended").asBoolean()).isTrue();
            JsonNode refused = problem(perform("alice", HttpMethod.POST, "/process-instances", Map.of("processKey", "restTerminate")), 422);
            assertThat(refused.path("detail").asText()).containsIgnoringCase("suspended");
        } finally {
            post("admin", "/process-definitions/restTerminate/activate", null, 204);
        }
        post("alice", "/process-instances", Map.of("processKey", "restTerminate"), 201);
    }

    @Test
    void listsArePagedAndTheSizeIsBounded() throws Exception {
        JsonNode first = get("alice", "/process-definitions?size=2&page=0");
        assertThat(first.path("items")).hasSize(2);
        assertThat(first.path("size").asInt()).isEqualTo(2);
        assertThat(first.path("page").asInt()).isZero();
        long total = first.path("total").asLong();
        assertThat(total).isGreaterThan(2);

        List<String> keys = new ArrayList<>();
        for (int page = 0; page * 2 < total; page++) {
            get("alice", "/process-definitions?size=2&page=" + page).path("items").forEach(d -> keys.add(d.path("key").asText()));
        }
        assertThat(keys).hasSize((int) total).doesNotHaveDuplicates();

        JsonNode tooBig = problem(perform("alice", HttpMethod.GET, "/process-definitions?size=100000", null), 400);
        assertThat(tooBig.path("detail").asText()).contains("max-page-size");
        problem(perform("alice", HttpMethod.GET, "/process-definitions?page=-1", null), 400);
        problem(perform("alice", HttpMethod.GET, "/process-definitions?size=abc", null), 400);
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

}
