package io.github.kleash.activiti.rest.core.web;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.RestCoreProperties;
import io.github.kleash.activiti.rest.core.dto.DefinitionDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.DefinitionService;
import io.github.kleash.activiti.rest.core.service.Paging;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RuntimeRestController
@RequestMapping(ApiPaths.BASE + "/process-definitions")
@Tag(name = "Process definitions", description = "Definitions and their BPMN, extensions JSON and DMN decisions")
public class ProcessDefinitionController {

    private final DefinitionService definitions;
    private final RestCoreProperties properties;

    public ProcessDefinitionController(DefinitionService definitions, RestCoreProperties properties) {
        this.definitions = definitions;
        this.properties = properties;
    }

    @GetMapping
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listProcessDefinitions", summary = "Process definitions (latest versions by default)")
    public PageDto<DefinitionDtos.ProcessDefinition> list(
            @RequestParam(required = false) String key,
            @RequestParam(required = false) String nameLike,
            @RequestParam(required = false, defaultValue = "true") boolean latest,
            @RequestParam(required = false) String deploymentId,
            @RequestParam(required = false) Boolean suspended,
            @RequestParam(required = false, defaultValue = "false") boolean includeCounts,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return definitions.definitions(Paging.of(page, size, properties), key, nameLike, latest, deploymentId, suspended, includeCounts);
    }

    @GetMapping("/{id}")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessDefinition", summary = "One definition, by id or by key (the latest version)")
    public DefinitionDtos.ProcessDefinition get(@PathVariable String id, @RequestParam(required = false, defaultValue = "true") boolean includeCounts) {
        return definitions.definition(id, includeCounts);
    }

    @GetMapping(value = "/{id}/xml", produces = MediaType.APPLICATION_XML_VALUE)
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessDefinitionXml", summary = "The BPMN XML of a definition")
    public ResponseEntity<String> xml(@PathVariable String id) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_XML).body(definitions.xml(id));
    }

    @GetMapping("/{id}/extensions")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessDefinitionExtensions", summary = "The entry of the definition in the *-extensions.json of its deployment")
    public DefinitionDtos.DefinitionExtensions extensions(@PathVariable String id) {
        return definitions.extensions(id);
    }

    @GetMapping("/{id}/decisions")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getProcessDefinitionDecisions", summary = "The DMN decisions in the definition's deployment")
    public DefinitionDtos.DefinitionDecisions decisions(@PathVariable String id) {
        return definitions.decisions(id);
    }

    @PostMapping("/{id}/suspend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "suspendProcessDefinition", summary = "Suspend a definition: no new instances")
    public void suspend(@PathVariable String id) {
        definitions.suspend(id);
    }

    @PostMapping("/{id}/activate")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "activateProcessDefinition", summary = "Activate a suspended definition")
    public void activate(@PathVariable String id) {
        definitions.activate(id);
    }
}
