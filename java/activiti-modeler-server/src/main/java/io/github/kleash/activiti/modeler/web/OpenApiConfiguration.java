package io.github.kleash.activiti.modeler.web;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

/** The description of the whole API at {@code /v3/api-docs} (behind sign-in). */
@Configuration(proxyBeanMethods = false)
public class OpenApiConfiguration {

    @Bean
    public OpenApiCustomizer modelerServerApiInfo() {
        return openApi -> {
            openApi.info(new Info().title("Activiti modeler server API").version("1.0.0")
                    .description("Runtime REST core (definitions, instances, tasks, events, jobs), dev endpoints (validate, deploy, scenarios, decisions, workspace, mail) "
                            + "and the server's own endpoints. HTTP Basic."));
            Components components = openApi.getComponents() == null ? new Components() : openApi.getComponents();
            components.addSecuritySchemes("basic", new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("basic"));
            openApi.components(components);
            openApi.addSecurityItem(new SecurityRequirement().addList("basic"));
        };
    }
}
