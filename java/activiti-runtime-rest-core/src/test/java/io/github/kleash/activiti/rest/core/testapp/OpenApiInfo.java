package io.github.kleash.activiti.rest.core.testapp;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.info.Info;

/** The title and description of the published OpenAPI file (docs/api/openapi-core.json); a host that publishes the API sets its own. */
@Configuration
public class OpenApiInfo {

    @Bean
    public OpenApiCustomizer coreApiInfo() {
        return openApi -> openApi.info(new Info().title("Activiti runtime REST (core)").version("0.1.0").description(
                "Production-safe REST API over ProcessRuntime and TaskRuntime: definitions, instances (state, path, variables), history, tasks, messages, signals, "
                        + "jobs and timers, dead letters. The acting user is the authenticated principal; the library adds no security of its own "
                        + "(access levels read, operate and admin map to authorities through activiti.rest.roles.*). Errors are application/problem+json."));
    }
}
