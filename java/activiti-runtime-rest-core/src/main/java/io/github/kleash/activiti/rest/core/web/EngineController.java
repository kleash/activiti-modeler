package io.github.kleash.activiti.rest.core.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.dto.EngineDtos;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.EngineInfoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RuntimeRestController
@RequestMapping(ApiPaths.BASE + "/engine")
@Tag(name = "Engine", description = "What the embedded runtime is and what a model can rely on")
public class EngineController {

    private final EngineInfoService info;

    public EngineController(EngineInfoService info) {
        this.info = info;
    }

    @GetMapping
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getEngine", summary = "Versions, history level, async executor, DMN engine, connector names, bean names and script engines")
    public EngineDtos.EngineInfo engine() {
        return info.info();
    }
}
