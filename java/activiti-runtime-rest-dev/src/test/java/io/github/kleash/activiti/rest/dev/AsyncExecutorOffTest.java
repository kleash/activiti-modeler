package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.dev.testapp.TestApplication;

/** With the async executor off the engine warns about asynchronous elements; validate labels those warnings. */
@SpringBootTest(classes = TestApplication.class, properties = {"spring.activiti.async-executor-activate=false", "spring.datasource.url=jdbc:h2:mem:rest-dev-async-off;DB_CLOSE_DELAY=-1"})
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
class AsyncExecutorOffTest extends AbstractDevTest {

    @Test
    void asynchronousElementsGetLabelledWarnings() throws Exception {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" targetNamespace="http://example.org/dev">
                  <signal id="sig" name="go"/>
                  <process id="asyncP" isExecutable="true">
                    <startEvent id="s"/>
                    <sequenceFlow id="f1" sourceRef="s" targetRef="work"/>
                    <serviceTask id="work" activiti:async="true" activiti:class="java.lang.Object"/>
                    <sequenceFlow id="f2" sourceRef="work" targetRef="timer"/>
                    <intermediateCatchEvent id="timer"><timerEventDefinition><timeDuration>PT1H</timeDuration></timerEventDefinition></intermediateCatchEvent>
                    <sequenceFlow id="f3" sourceRef="timer" targetRef="e"/>
                    <endEvent id="e"/>
                  </process>
                </definitions>""";

        JsonNode result = validate(List.of(file("async.bpmn20.xml", xml)));

        assertThat(result.path("asyncExecutorActive").asBoolean()).isFalse();
        assertThat(result.path("valid").asBoolean()).as("these are warnings").isTrue();
        JsonNode flow = problemOf(result, "activiti-flow-element-async-not-available");
        assertThat(flow.path("severity").asText()).isEqualTo("warning");
        assertThat(flow.path("elementId").asText()).isEqualTo("work");
        assertThat(flow.path("message").asText()).contains("only because the async executor");
        assertThat(problemOf(result, "activiti-event-timer-async-not-available").path("message").asText()).contains("only because the async executor");
    }
}
