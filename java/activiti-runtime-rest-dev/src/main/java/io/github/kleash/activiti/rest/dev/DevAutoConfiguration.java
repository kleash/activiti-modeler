package io.github.kleash.activiti.rest.dev;

import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.spring.process.ProcessExtensionResourceReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DmnEvaluationService;
import io.github.kleash.activiti.rest.core.error.ProblemMapping;
import io.github.kleash.activiti.rest.core.service.DecisionCatalog;
import io.github.kleash.activiti.rest.dev.service.DecisionService;
import io.github.kleash.activiti.rest.dev.service.DevDeploymentService;
import io.github.kleash.activiti.rest.dev.service.ScenarioRunService;
import io.github.kleash.activiti.rest.dev.validate.ProjectValidator;
import io.github.kleash.activiti.rest.dev.validate.TrialDeployer;
import io.github.kleash.activiti.rest.dev.web.DevController;
import io.github.kleash.activiti.rest.dev.web.DevProblemMapping;
import io.github.kleash.activiti.rest.dev.web.WorkspaceController;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceProperties;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceService;
import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/**
 * The development-only endpoints. Registered <b>only</b> with {@code activiti.rest.dev.enabled=true}, and logs a warning when they
 * are: deploying and running arbitrary models is remote code execution (docs/adr/0007-runtime-rest-split-and-security.md). Every
 * endpoint needs the admin access level of the core API.
 */
@AutoConfiguration(afterName = {
    "io.github.kleash.activiti.rest.core.RestCoreAutoConfiguration",
    "io.github.kleash.activiti.scenario.spring.ScenarioRunnerAutoConfiguration",
    "io.github.kleash.activiti.dmn.DmnConnectorAutoConfiguration"
})
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(ScenarioRunner.class)
@ConditionalOnProperty(prefix = "activiti.rest.dev", name = "enabled", havingValue = "true")
@EnableConfigurationProperties({DevProperties.class, WorkspaceProperties.class})
@Import({DevController.class, WorkspaceController.class})
public class DevAutoConfiguration {

    private static final Logger LOG = LoggerFactory.getLogger(DevAutoConfiguration.class);

    @Bean
    public static DevModeWarning devModeWarning() {
        return new DevModeWarning();
    }

    @Bean
    public ProblemMapping devProblemMapping() {
        return new DevProblemMapping();
    }

    @Bean
    public TrialDeployer devTrialDeployer() {
        return new TrialDeployer();
    }

    @Bean
    public ProjectValidator devProjectValidator(RepositoryService repository, ProcessEngineConfiguration configuration,
                                                ProcessExtensionResourceReader extensionsReader, DmnEvaluationService dmn, ObjectMapper mapper,
                                                TrialDeployer trial) {
        return new ProjectValidator(repository, configuration, extensionsReader, dmn, mapper, trial);
    }

    @Bean
    public DevDeploymentService devDeploymentService(ProjectValidator validator, RepositoryService repository, DecisionCatalog decisions,
                                                     DevProperties properties) {
        return new DevDeploymentService(validator, repository, decisions, properties);
    }

    @Bean
    public ScenarioRunService devScenarioRunService(ProjectValidator validator, DevDeploymentService deployments, RepositoryService repository,
                                                    ScenarioRunner runner, ScenarioLoader loader, DevProperties properties) {
        return new ScenarioRunService(validator, deployments, repository, runner, loader, properties);
    }

    @Bean
    public DecisionService devDecisionService(DmnEvaluationService dmn) {
        return new DecisionService(dmn);
    }

    @Bean
    public WorkspaceService devWorkspaceService(WorkspaceProperties properties) {
        return new WorkspaceService(properties);
    }

    /** Logs the warning at startup. */
    public static final class DevModeWarning implements org.springframework.beans.factory.InitializingBean {
        @Override
        public void afterPropertiesSet() {
            LOG.warn("DEV ENDPOINTS ARE ON (activiti.rest.dev.enabled=true): anyone with the admin access level can deploy and run arbitrary models "
                    + "(remote code execution), validate projects, run scenarios and read and write the workspace files. Use them on a development machine only.");
        }
    }
}
