package io.github.kleash.activiti.dmn.e2e;

import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;

/**
 * Host application of the end-to-end tests: embedded Activiti 9.0.0 on H2 plus the DMN connector, which is picked up
 * by its Spring Boot auto-configuration like in any host application. Each test class chooses the folder it deploys
 * with {@code spring.activiti.process-definition-location-prefix}.
 */
@SpringBootApplication
public class E2eApplication {

    /**
     * Activiti's runtime APIs authenticate through Spring Security: {@code ROLE_ACTIVITI_USER} grants access.
     *
     * @return an in-memory identity store with the user {@code alice}
     */
    @Bean
    public UserDetailsService userDetailsService() {
        return new InMemoryUserDetailsManager(
            User.withUsername("alice").password("{noop}password")
                .authorities(List.of(new SimpleGrantedAuthority("ROLE_ACTIVITI_USER"))).build());
    }

    /** @return records every sequence flow the engine takes */
    @Bean
    public SequenceFlowRecorder sequenceFlowRecorder() {
        return new SequenceFlowRecorder();
    }

    /**
     * @param recorder the sequence flow recorder
     * @return a configurer that registers the recorder as a global engine event listener
     */
    @Bean
    public ProcessEngineConfigurationConfigurer recorderConfigurer(SequenceFlowRecorder recorder) {
        return configuration -> {
            List<ActivitiEventListener> listeners = new ArrayList<>();
            if (configuration.getEventListeners() != null) {
                listeners.addAll(configuration.getEventListeners());
            }
            listeners.add(recorder);
            configuration.setEventListeners(listeners);
        };
    }
}
