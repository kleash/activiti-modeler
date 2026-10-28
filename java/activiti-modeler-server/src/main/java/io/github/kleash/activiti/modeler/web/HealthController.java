package io.github.kleash.activiti.modeler.web;

import java.time.Instant;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** {@code GET /api/health}: is the server there? Public (no sign-in), so the modeler can tell "server down" from "wrong credentials". */
@RuntimeRestController
@RequestMapping(ApiPaths.BASE + "/health")
@Tag(name = "Server", description = "The modeler server itself")
public class HealthController {

    /**
     * @param status always {@code UP}
     * @param time   server time
     * @param app    {@code activiti-modeler-server}
     */
    public record Health(String status, Instant time, String app) {
    }

    @GetMapping
    @Operation(operationId = "getHealth", summary = "Liveness; public")
    public Health health() {
        return new Health("UP", Instant.now(), "activiti-modeler-server");
    }
}
