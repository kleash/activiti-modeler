package io.github.kleash.activiti.rest.core.web;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

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
@RequestMapping(ApiPaths.BASE + "/deployments")
@Tag(name = "Deployments", description = "Deployments and the resources in them")
public class DeploymentController {

    private final DefinitionService definitions;
    private final RestCoreProperties properties;

    public DeploymentController(DefinitionService definitions, RestCoreProperties properties) {
        this.definitions = definitions;
        this.properties = properties;
    }

    @GetMapping
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listDeployments", summary = "Deployments, newest first")
    public PageDto<DefinitionDtos.Deployment> list(@RequestParam(required = false) String nameLike, @RequestParam(required = false) Integer page,
                                                   @RequestParam(required = false) Integer size) {
        return definitions.deployments(Paging.of(page, size, properties), nameLike);
    }

    @GetMapping("/{id}")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getDeployment", summary = "One deployment")
    public DefinitionDtos.Deployment get(@PathVariable String id) {
        return definitions.deployment(id);
    }

    @GetMapping("/{id}/resources")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "listDeploymentResources", summary = "Resource names of a deployment, with their kind (bpmn, dmn, extensions, image, other)")
    public List<DefinitionDtos.DeploymentResource> resources(@PathVariable String id) {
        return definitions.resources(id);
    }

    @GetMapping("/{id}/resource")
    @RequiresAccess(Access.READ)
    @Operation(operationId = "getDeploymentResource", summary = "The content of one resource of a deployment (name as listed, a query parameter because names may be paths)")
    public ResponseEntity<byte[]> resource(@PathVariable String id, @RequestParam String name) {
        byte[] content = definitions.resourceContent(id, name);
        String kind = DefinitionService.kindOfName(name);
        MediaType type = switch (kind) {
            case "bpmn", "dmn" -> MediaType.APPLICATION_XML;
            case "extensions" -> MediaType.APPLICATION_JSON;
            case "image" -> name.toLowerCase().endsWith(".svg") ? MediaType.parseMediaType("image/svg+xml") : MediaType.APPLICATION_OCTET_STREAM;
            default -> MediaType.APPLICATION_OCTET_STREAM;
        };
        return ResponseEntity.ok().contentType(type).body(content);
    }
}
