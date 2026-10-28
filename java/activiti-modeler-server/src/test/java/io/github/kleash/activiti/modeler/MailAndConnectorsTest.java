package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.modeler.mail.MailServer;

class MailAndConnectorsTest extends AbstractServerTest {

    @Autowired MailServer mail;

    @Test
    void aMailTaskSendsToTheEmbeddedSmtpServerAndTheMessageCanBeRead() throws Exception {
        send("modeler", HttpMethod.DELETE, "/api/dev/mail", null, 204);
        send("modeler", HttpMethod.POST, "/api/dev/deployments", Map.of("files", files(file("mail.bpmn20.xml", fixture("mail.bpmn20.xml")))), 201);

        JsonNode started = send("alice", HttpMethod.POST, "/api/process-instances", Map.of("processKey", "mailProcess"), 201);
        assertThat(started.path("state").asText()).isEqualTo("COMPLETED");

        JsonNode inbox = send("modeler", HttpMethod.GET, "/api/dev/mail", null, 200);
        assertThat(inbox.path("host").asText()).isEqualTo("127.0.0.1");
        assertThat(inbox.path("port").asInt()).isEqualTo(mail.port()).isPositive();
        assertThat(inbox.path("messages")).hasSize(1);
        JsonNode message = inbox.path("messages").get(0);
        assertThat(message.path("subject").asText()).isEqualTo("Your order");
        assertThat(message.path("to").get(0).asText()).isEqualTo("customer@example.org");
        assertThat(message.path("from").get(0).asText()).isEqualTo("modeler@localhost");
        assertThat(message.path("text").asText()).isEqualTo("Thank you for your order.");

        send("modeler", HttpMethod.DELETE, "/api/dev/mail", null, 204);
        assertThat(send("modeler", HttpMethod.GET, "/api/dev/mail", null, 200).path("messages")).isEmpty();
        // admin only
        assertThat(perform("alice", HttpMethod.GET, "/api/dev/mail", null).getResponse().getStatus()).isEqualTo(403);
    }

    @Test
    void theSampleConnectorsRunAndTheRecordingWrapperSeesTheirCalls() throws Exception {
        JsonNode result = send("modeler", HttpMethod.POST, "/api/dev/scenarios/run", Map.of(
                "files", files(file("processes/connectors.bpmn20.xml", fixture("connectors.bpmn20.xml")),
                        file("processes/connectors-extensions.json", fixture("connectors-extensions.json"))),
                "scenario", mapper.readTree(fixture("connectors.scenario.json"))), 200);

        assertThat(result.path("passed").asBoolean()).as(result.path("rendered").asText()).isTrue();
        assertThat(result.path("report").path("scenarios").get(0).path("steps")).hasSize(4);
    }

    @Test
    void theHttpGetConnectorIsAMockThatNeverTouchesTheNetwork() throws Exception {
        send("modeler", HttpMethod.POST, "/api/dev/deployments", Map.of("files", files(
                file("processes/connectors.bpmn20.xml", fixture("connectors.bpmn20.xml")),
                file("processes/connectors-extensions.json", fixture("connectors-extensions.json")))), 201);
        JsonNode started = send("modeler", HttpMethod.POST, "/api/process-instances",
                Map.of("processKey", "sampleConnectors", "variables", Map.of("greeting", "x", "customerId", "C-1")), 201);

        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("status") && v.path("value").asInt() == 200);
        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("tier") && v.path("value").asText().equals("standard"));
    }
}
