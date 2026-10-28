package io.github.kleash.activiti.modeler;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import io.github.kleash.activiti.modeler.launch.ServerBanner;
import io.github.kleash.activiti.modeler.mail.MailServer;

/** Beans of the server that belong nowhere else. */
@Configuration(proxyBeanMethods = false)
public class ServerConfiguration {

    @Bean
    public ServerBanner serverBanner(Environment environment, ModelerServerProperties properties, ObjectProvider<MailServer> mail) {
        return new ServerBanner(environment, properties, mail);
    }
}
