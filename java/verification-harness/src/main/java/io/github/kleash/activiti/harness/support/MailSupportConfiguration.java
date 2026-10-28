package io.github.kleash.activiti.harness.support;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;

import org.activiti.spring.SpringProcessEngineConfiguration;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetup;

import jakarta.mail.util.ByteArrayDataSource;

/**
 * The mail server of the mail corpus (C14). It exists only in a project context whose {@code harness.properties} contain
 * {@code harness.greenmail=true} (docs/corpus-support.md): a GreenMail SMTP server on a free local port with automatic user
 * creation, and a process engine configurer that points the engine's mail settings at it
 * ({@code mailServerHost}, {@code mailServerPort}, {@code mailServerDefaultFrom=noreply@corpus.test}). Every project context
 * has its own server, which stops with the context.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "harness.greenmail", havingValue = "true")
public class MailSupportConfiguration {

    public static final String DEFAULT_FROM = "noreply@corpus.test";

    /** The server; started on a free port chosen here so that the engine configuration can be built before it is used. */
    @Bean(destroyMethod = "stop")
    public GreenMail greenMail() {
        ServerSetup smtp = new ServerSetup(freePort(), "127.0.0.1", ServerSetup.PROTOCOL_SMTP);
        GreenMail greenMail = new GreenMail(smtp).withConfiguration(GreenMailConfiguration.aConfig().withDisabledAuthentication());
        greenMail.start();
        return greenMail;
    }

    @Bean
    public ProcessEngineConfigurationConfigurer mailServerConfigurer(GreenMail greenMail) {
        return (SpringProcessEngineConfiguration configuration) -> {
            configuration.setMailServerHost("127.0.0.1");
            configuration.setMailServerPort(greenMail.getSmtp().getPort());
            configuration.setMailServerDefaultFrom(DEFAULT_FROM);
        };
    }

    /** {@code mailbox}: see {@link Mailbox}. */
    @Bean
    public Mailbox mailbox(GreenMail greenMail) {
        return new Mailbox(greenMail);
    }

    /** {@code mailAttachments}: attachments for the {@code attachments} field of a mail task. */
    @Bean
    public MailAttachments mailAttachments() {
        return new MailAttachments();
    }

    /** {@code mailTemplates}: texts with unresolved expressions for the {@code textVar} / {@code htmlVar} fields. */
    @Bean
    public MailTemplates mailTemplates() {
        return new MailTemplates();
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("No free port for the corpus mail server", e);
        }
    }

    /** Bean {@code mailAttachments}: {@code ${mailAttachments.report()}} is a data source named {@code report.txt} (text/plain). */
    public static class MailAttachments {
        public ByteArrayDataSource report() {
            ByteArrayDataSource source = new ByteArrayDataSource("report body".getBytes(StandardCharsets.UTF_8), "text/plain");
            source.setName("report.txt");
            return source;
        }
    }

    /**
     * Bean {@code mailTemplates}: texts that still contain expressions. A start variable cannot carry them (the runtime
     * rejects expressions in payload values), so a service task stores one in a variable and the mail task's
     * {@code textVar} / {@code htmlVar} field, which names that variable, evaluates it at send time.
     */
    public static class MailTemplates {
        public String text() {
            return "Hello ${customerName}, order ${orderId} ships soon.";
        }

        public String html() {
            return "<p>Hello <b>${customerName}</b>, order ${orderId} ships soon.</p>";
        }
    }
}
