package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import io.github.kleash.activiti.rest.dev.testapp.TestApplication;

/** Enabling the dev endpoints logs a warning at startup. */
@ExtendWith(OutputCaptureExtension.class)
class DevWarningTest {

    @Test
    void enablingTheDevEndpointsLogsAWarning(CapturedOutput output) {
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(TestApplication.class).web(WebApplicationType.SERVLET)
                .run("--server.port=0", "--spring.datasource.url=jdbc:h2:mem:rest-dev-warn;DB_CLOSE_DELAY=-1", "--activiti.rest.dev.enabled=true")) {
            assertThat(context.isActive()).isTrue();
        }
        assertThat(output.getAll()).contains("WARN").contains("DEV ENDPOINTS ARE ON").contains("remote code execution");
    }
}
