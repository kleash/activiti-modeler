package io.github.kleash.activiti.modeler.mail;

import java.io.IOException;
import java.net.ServerSocket;

import org.activiti.spring.SpringProcessEngineConfiguration;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetup;

import io.github.kleash.activiti.modeler.ModelerServerProperties;

/**
 * Mail tasks need an SMTP server. The modeler server starts GreenMail on the loopback address (no authentication, mailboxes are
 * created on demand), and points the engine's mail settings at it, so a mail task runs and its message can be read at
 * {@code GET /api/dev/mail}. Switch off with {@code modeler.server.mail.enabled=false} and configure {@code spring.activiti.mail-server-*}.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "modeler.server.mail", name = "enabled", havingValue = "true", matchIfMissing = true)
public class MailConfiguration {

    @Bean(destroyMethod = "stop")
    public GreenMail greenMail(ModelerServerProperties properties) {
        int port = properties.getMail().getPort() > 0 ? properties.getMail().getPort() : freePort();
        ServerSetup smtp = new ServerSetup(port, "127.0.0.1", ServerSetup.PROTOCOL_SMTP);
        GreenMail greenMail = new GreenMail(smtp).withConfiguration(GreenMailConfiguration.aConfig().withDisabledAuthentication());
        greenMail.start();
        return greenMail;
    }

    @Bean
    public MailServer mailServer(GreenMail greenMail) {
        return new MailServer(greenMail);
    }

    @Bean
    public ProcessEngineConfigurationConfigurer mailServerConfigurer(GreenMail greenMail, ModelerServerProperties properties) {
        return (SpringProcessEngineConfiguration configuration) -> {
            configuration.setMailServerHost("127.0.0.1");
            configuration.setMailServerPort(greenMail.getSmtp().getPort());
            configuration.setMailServerDefaultFrom(properties.getMail().getDefaultFrom());
        };
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("No free port for the embedded SMTP server", e);
        }
    }
}
