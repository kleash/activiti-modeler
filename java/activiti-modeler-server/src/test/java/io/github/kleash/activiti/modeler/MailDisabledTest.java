package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;

import io.github.kleash.activiti.modeler.mail.MailServer;

/** The embedded SMTP server can be switched off. */
@SpringBootTest(properties = {"modeler.server.mail.enabled=false", "spring.datasource.url=jdbc:h2:mem:server-nomail;DB_CLOSE_DELAY=-1"})
class MailDisabledTest extends AbstractServerTest {

    @Autowired ApplicationContext context;

    @Test
    void noSmtpServerIsStartedAndTheMailEndpointDoesNotExist() throws Exception {
        assertThat(context.getBeansOfType(MailServer.class)).isEmpty();
        assertThat(context.getBeanNamesForType(com.icegreen.greenmail.util.GreenMail.class)).isEmpty();
        assertThat(perform("modeler", HttpMethod.GET, "/api/dev/mail", null).getResponse().getStatus()).isEqualTo(404);
    }
}
