package io.github.kleash.activiti.rest.dev.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;

import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.dev.DevApi;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;
import io.github.kleash.activiti.rest.dev.service.DecisionService;
import io.github.kleash.activiti.rest.dev.service.DevDeploymentService;
import io.github.kleash.activiti.rest.dev.service.ScenarioRunService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Development-only endpoints: validate a project, deploy it, run a scenario against it, evaluate a decision. They deploy and run
 * arbitrary models, which is remote code execution, so they need the admin access level and are registered only with
 * {@code activiti.rest.dev.enabled=true}.
 */
@RuntimeRestController
@RequestMapping(DevApi.MAPPING)
@RequiresAccess(Access.ADMIN)
@Tag(name = "Dev", description = "Development-only endpoints (activiti.rest.dev.enabled=true): validate, deploy, run scenarios, evaluate decisions, workspace files")
public class DevController {

    private final DevDeploymentService deployments;
    private final ScenarioRunService scenarios;
    private final DecisionService decisions;

    public DevController(DevDeploymentService deployments, ScenarioRunService scenarios, DecisionService decisions) {
        this.deployments = deployments;
        this.scenarios = scenarios;
        this.decisions = decisions;
    }

    @PostMapping("/validate")
    @Operation(operationId = "devValidate",
            summary = "Check a project: BPMN XSD, RepositoryService.validateProcess, a trial deployment into a scratch engine, a dry load of the extensions JSON, a DMN parse")
    public DevDtos.ValidateResponse validate(@RequestBody DevDtos.ValidateRequest request) {
        return deployments.validate(request.files());
    }

    @PostMapping("/deployments")
    @Operation(operationId = "devDeploy", summary = "Deploy the files as one deployment, with their names as given; refused with 422 and the findings when the project has errors")
    public ResponseEntity<DevDtos.DeployResponse> deploy(@RequestBody DevDtos.DeployRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(deployments.deploy(request.name(), request.files()));
    }

    @DeleteMapping("/deployments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(operationId = "devDeleteDeployment", summary = "Delete a deployment with its instances, jobs and history")
    public void deleteDeployment(@PathVariable String id, @RequestParam(required = false, defaultValue = "true") boolean cascade) {
        deployments.delete(id, cascade);
    }

    @PostMapping("/scenarios/run")
    @Operation(operationId = "devRunScenario",
            summary = "Run a scenario file against the files, on the running engine in EXECUTOR mode; the files are deployed for the run and removed afterwards")
    public DevDtos.ScenarioRunResponse runScenario(@RequestBody DevDtos.ScenarioRunRequest request) {
        return scenarios.run(request.files(), request.scenario());
    }

    @PostMapping("/decisions/evaluate")
    @Operation(operationId = "devEvaluateDecision", summary = "Evaluate a decision of an uploaded DMN document or of a deployment: result rows and matched rule ids")
    public DevDtos.DecisionOutcome evaluate(@RequestBody DevDtos.DecisionRequest request) {
        return decisions.evaluate(request);
    }
}
