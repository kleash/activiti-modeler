package io.github.kleash.activiti.rest.dev.service;

import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.dev.DevProperties;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;
import io.github.kleash.activiti.rest.dev.validate.ProjectValidator;
import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/**
 * Runs a scenario file against the project's files, on the running engine.
 *
 * <p><b>Design: the live engine, one run at a time.</b> The scenario runner needs everything the running server has (its
 * connectors, delegates and beans, its mail server, its async executor), so the run happens on the live engine, in EXECUTOR mode, not
 * in a scratch engine. The files are deployed as a deployment of their own for the duration of the run and removed afterwards
 * with everything the run created. Isolation is therefore a matter of discipline, and has limits (docs/api/runtime-rest.md):
 * <ul>
 *   <li>runs are serialized (a second one waits, then answers 409), because the engine clock and the runner's recorders are global;</li>
 *   <li>everything the runner queries is scoped to the scenario's instance tree, and what a run leaves behind is deleted - but the
 *       runner deletes <em>every</em> instance that appeared during the run, also one that somebody else started meanwhile;</li>
 *   <li>a scenario that sets a {@code clock} moves the clock of the whole engine for the run, so timers of other instances look due;</li>
 *   <li>while the run lasts, its definitions are the latest versions of their keys (a call activity of another project resolves to them),
 *       and its message and signal start events are live;</li>
 *   <li>the users a scenario file defines exist in the server's user store for the run, with random passwords.</li>
 * </ul>
 */
public class ScenarioRunService {

    private static final Logger LOG = LoggerFactory.getLogger(ScenarioRunService.class);

    private final ReentrantLock lock = new ReentrantLock();
    private final ProjectValidator validator;
    private final DevDeploymentService deployments;
    private final RepositoryService repository;
    private final ScenarioRunner runner;
    private final ScenarioLoader loader;
    private final DevProperties properties;

    public ScenarioRunService(ProjectValidator validator, DevDeploymentService deployments, RepositoryService repository, ScenarioRunner runner,
                              ScenarioLoader loader, DevProperties properties) {
        this.validator = validator;
        this.deployments = deployments;
        this.repository = repository;
        this.runner = runner;
        this.loader = loader;
        this.properties = properties;
    }

    public DevDtos.ScenarioRunResponse run(List<DevDtos.FileEntry> files, JsonNode scenario) {
        if (scenario == null || scenario.isNull() || scenario.isMissingNode()) {
            throw new IllegalArgumentException("scenario is required: a scenario file as a JSON object or as text");
        }
        ScenarioFile file = scenario.isTextual() ? loader.parse(scenario.asText(), "scenario") : loader.parse(scenario, "scenario");
        long began = System.nanoTime();
        boolean acquired;
        try {
            acquired = lock.tryLock(properties.getScenarioLockTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DevConflictException("Interrupted while waiting for the running scenario to finish");
        }
        if (!acquired) {
            throw new DevConflictException("Another scenario run is in progress and did not finish within " + properties.getScenarioLockTimeout()
                    + " (activiti.rest.dev.scenario-lock-timeout); runs are one at a time because the engine clock is shared");
        }
        Deployment deployment = null;
        try {
            ProjectValidator.Result checks = validator.validate(files, false);
            if (checks.hasErrors()) {
                throw new DevValidationException("The project has errors; the scenario was not run", checks.problems());
            }
            deployment = deployments.deployAll("scenario-run-" + java.util.UUID.randomUUID(), files, checks.problems());
            FileReport report = runner.run(file);
            return new DevDtos.ScenarioRunResponse(report.passed(), report, report.render(), (System.nanoTime() - began) / 1_000_000);
        } finally {
            if (deployment != null) {
                try {
                    repository.deleteDeployment(deployment.getId(), true);
                } catch (RuntimeException e) {
                    LOG.warn("Could not remove the deployment {} of a scenario run", deployment.getId(), e);
                }
            }
            lock.unlock();
        }
    }
}
