package io.github.kleash.compat;

import java.util.List;

import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.JavaDelegate;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;

@SpringBootApplication
public class CompatApplication {

    public static void main(String[] args) {
        SpringApplication.run(CompatApplication.class, args);
    }

    /** Activiti's ProcessRuntime/TaskRuntime resolve users and groups through Spring Security. */
    @Bean
    public UserDetailsService userDetailsService() {
        return new InMemoryUserDetailsManager(
            User.withUsername("alice").password("{noop}password")
                .authorities(List.of(
                    new SimpleGrantedAuthority("ROLE_ACTIVITI_USER"),
                    new SimpleGrantedAuthority("GROUP_reviewers")))
                .build(),
            User.withUsername("admin").password("{noop}password")
                .authorities(List.of(new SimpleGrantedAuthority("ROLE_ACTIVITI_ADMIN")))
                .build());
    }

    /** Activiti 7+ style connector, bound by name through serviceTask/@implementation. */
    @Bean
    public Connector greetingConnector() {
        return integrationContext -> {
            Object name = integrationContext.getInBoundVariables().get("customerName");
            integrationContext.addOutBoundVariable("greeting", "Hello " + name);
            return integrationContext;
        };
    }

    /** Classic engine-level delegate, bound through activiti:delegateExpression. */
    @Bean
    public JavaDelegate scoreDelegate() {
        return (DelegateExecution execution) -> {
            Number amount = (Number) execution.getVariable("amount");
            execution.setVariable("score", amount.intValue() > 1000 ? "high" : "low");
        };
    }
}
