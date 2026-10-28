package io.github.kleash.activiti.rest.dev.service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.DeploymentBuilder;
import org.activiti.engine.repository.ProcessDefinition;

import io.github.kleash.activiti.rest.core.service.DecisionCatalog;
import io.github.kleash.activiti.rest.dev.DevProperties;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;
import io.github.kleash.activiti.rest.dev.validate.ProjectValidator;
import io.github.kleash.activiti.rest.dev.validate.TrialDeployer;

/** Validate a project, deploy it as one deployment, remove a deployment. */
public class DevDeploymentService {

    private final ProjectValidator validator;
    private final RepositoryService repository;
    private final DecisionCatalog decisions;
    private final DevProperties properties;

    public DevDeploymentService(ProjectValidator validator, RepositoryService repository, DecisionCatalog decisions, DevProperties properties) {
        this.validator = validator;
        this.repository = repository;
        this.decisions = decisions;
        this.properties = properties;
    }

    /** All checks, including the trial deployment into a scratch engine. */
    public DevDtos.ValidateResponse validate(List<DevDtos.FileEntry> files) {
        checkSize(files);
        ProjectValidator.Result result = validator.validate(files, true);
        return new DevDtos.ValidateResponse(!result.hasErrors(), validator.asyncExecutorActive(), result.checked(), result.problems());
    }

    /**
     * Deploys the project as one deployment, resources named as given. Errors found by the checks (the deployment itself is the trial)
     * or by the deployment refuse it with a {@link DevValidationException}; nothing is deployed then.
     */
    public DevDtos.DeployResponse deploy(String name, List<DevDtos.FileEntry> files) {
        checkSize(files);
        ProjectValidator.Result result = validator.validate(files, false);
        if (result.hasErrors()) {
            throw new DevValidationException("The project has errors; nothing was deployed", result.problems());
        }
        Deployment deployment = deployAll(name, files, result.problems());
        return response(deployment, result.problems());
    }

    /**
     * Deploys without the checks of {@link #deploy}: callers have made them already. A failure of the engine's deployment step is
     * reported as a {@link DevValidationException} with the finding, for the file it can be attributed to or for the project.
     */
    public Deployment deployAll(String name, List<DevDtos.FileEntry> files, List<DevDtos.Problem> warnings) {
        DeploymentBuilder builder = repository.createDeployment().name(name == null || name.isBlank() ? "modeler-" + Instant.now() : name);
        for (DevDtos.FileEntry file : files) {
            if (!"other".equals(io.github.kleash.activiti.rest.core.service.DefinitionService.kindOfName(file.path()))) {
                builder.addBytes(file.path(), file.content().getBytes(StandardCharsets.UTF_8));
            }
        }
        try {
            return builder.deploy();
        } catch (RuntimeException e) {
            List<DevDtos.Problem> problems = new ArrayList<>(warnings);
            problems.add(new DevDtos.Problem(null, null, "deploy", "error", "The engine refused the deployment: " + TrialDeployer.describeFailure(e), "trial-deploy", null, null));
            throw new DevValidationException("The engine refused the deployment", problems);
        }
    }

    /** Removes a deployment with its instances, jobs and history. */
    public void delete(String deploymentId, boolean cascade) {
        if (repository.createDeploymentQuery().deploymentId(deploymentId).count() == 0) {
            throw new ActivitiObjectNotFoundException("No deployment with id '" + deploymentId + "'", Deployment.class);
        }
        repository.deleteDeployment(deploymentId, cascade);
    }

    private DevDtos.DeployResponse response(Deployment deployment, List<DevDtos.Problem> problems) {
        List<DevDtos.DeployedDefinition> definitions = repository.createProcessDefinitionQuery().deploymentId(deployment.getId()).orderByProcessDefinitionKey().asc()
                .list().stream().map(DevDeploymentService::definition).toList();
        List<String> resources = repository.getDeploymentResourceNames(deployment.getId()).stream().sorted().toList();
        return new DevDtos.DeployResponse(deployment.getId(), deployment.getName(), resources, definitions, decisions.decisionsOf(deployment.getId()), problems);
    }

    private static DevDtos.DeployedDefinition definition(ProcessDefinition d) {
        return new DevDtos.DeployedDefinition(d.getId(), d.getKey(), d.getName(), d.getVersion(), d.getResourceName());
    }

    private void checkSize(List<DevDtos.FileEntry> files) {
        long total = 0;
        if (files != null) {
            for (DevDtos.FileEntry file : files) {
                total += file == null || file.content() == null ? 0 : file.content().length();
            }
        }
        if (total > properties.getMaxFilesCharacters()) {
            throw new IllegalArgumentException("The files are " + total + " characters in all; the limit is " + properties.getMaxFilesCharacters()
                    + " (activiti.rest.dev.max-files-characters)");
        }
    }
}
