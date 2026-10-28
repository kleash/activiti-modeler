package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.dev.testapp.TestApplication;

/** Scenario runs are one at a time; a second one that cannot get in answers 409. */
@SpringBootTest(classes = TestApplication.class, properties = {"activiti.rest.dev.scenario-lock-timeout=200ms",
    "spring.datasource.url=jdbc:h2:mem:rest-dev-lock;DB_CLOSE_DELAY=-1"})
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
class ScenarioLockTest extends AbstractDevTest {

    /** A scenario that waits for an asynchronous task that takes 1.5 seconds. */
    private static final String SLOW = """
            { "name": "slow", "users": { "u": [] }, "scenarios": [ { "name": "waits",
              "start": { "process": "devWaiting", "user": "u" },
              "steps": [ { "executeJobs": { "timeoutMs": 10000 } } ],
              "expect": { "state": "COMPLETED" } } ] }""";

    private static final String WAITING = """
            <?xml version="1.0" encoding="UTF-8"?>
            <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/dev">
              <process id="devWaiting" isExecutable="true">
                <startEvent id="s"/>
                <sequenceFlow id="f1" sourceRef="s" targetRef="wait"/>
                <serviceTask id="wait" xmlns:activiti="http://activiti.org/bpmn" activiti:async="true" activiti:delegateExpression="${slowDelegate}"/>
                <sequenceFlow id="f2" sourceRef="wait" targetRef="e"/>
                <endEvent id="e"/>
              </process>
            </definitions>""";

    @Test
    void aSecondRunWhileOneIsInProgressAnswers409AfterTheLockTimeout() throws Exception {
        Map<String, Object> request = Map.of("files", java.util.List.of(file("waiting.bpmn20.xml", WAITING)), "scenario", mapper.readTree(SLOW));
        CompletableFuture<JsonNode> first = CompletableFuture.supplyAsync(() -> {
            try {
                return post("/scenarios/run", request, 200);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        Thread.sleep(500);

        JsonNode conflict = problem(perform("admin", HttpMethod.POST, "/scenarios/run", request), 409);
        assertThat(conflict.path("detail").asText()).contains("Another scenario run is in progress");

        JsonNode done = first.get(30, TimeUnit.SECONDS);
        assertThat(done.path("passed").asBoolean()).as(done.path("rendered").asText()).isTrue();
        // and the lock is free again
        assertThat(post("/scenarios/run", request, 200).path("passed").asBoolean()).isTrue();
    }
}
