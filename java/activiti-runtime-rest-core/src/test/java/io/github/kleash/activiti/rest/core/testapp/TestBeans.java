package io.github.kleash.activiti.rest.core.testapp;

import org.activiti.api.process.runtime.connector.Connector;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** A connector and a bean for expressions, so that {@code GET /engine} has something to list. */
@Configuration
public class TestBeans {

    @Bean(name = "test.EXECUTE")
    public Connector testConnector() {
        return context -> context;
    }

    @Bean
    public Greeter greeter() {
        return new Greeter();
    }

    /** {@code ${greeter.greet(name)}}. */
    public static class Greeter {
        public String greet(String name) {
            return "Hello, " + name;
        }
    }
}
