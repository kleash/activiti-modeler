package io.github.kleash.activiti.rest.dev.testapp;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.info.Info;

/** The title and description of the published OpenAPI file (docs/api/openapi-dev.json). */
@Configuration
public class OpenApiInfo {

    @Bean
    public OpenApiCustomizer devApiInfo() {
        return openApi -> openApi.info(new Info().title("Activiti runtime REST (dev)").version("1.0.0").description(
                "Development-only endpoints, registered with activiti.rest.dev.enabled=true and open to the admin access level only: validate a project "
                        + "(with a trial deployment into a scratch engine), deploy it, run scenarios against it on the running engine, evaluate decisions, "
                        + "and read and write the project files of the workspace folder."));
    }
}
