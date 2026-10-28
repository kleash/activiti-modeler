package io.github.kleash.activiti.scenario.spring;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.activiti.core.common.spring.identity.ExtendedInMemoryUserDetailsManager;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.ManagementService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.TaskService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.spring.SpringProcessEngineConfiguration;
import org.activiti.validation.ProcessValidatorFactory;
import org.activiti.validation.ProcessValidatorImpl;
import org.activiti.validation.validator.ValidatorSet;
import org.activiti.spring.boot.ActivitiProperties;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.activiti.spring.process.ProcessExtensionService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Role;
import org.springframework.security.core.userdetails.UserDetailsService;

import io.github.kleash.activiti.scenario.jobs.JobDriver;
import io.github.kleash.activiti.scenario.jobs.JobSupport;
import io.github.kleash.activiti.scenario.jobs.ExecutorJobDriver;
import io.github.kleash.activiti.scenario.jobs.ManualJobDriver;
import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.modelexpect.ModelExpectChecker;
import io.github.kleash.activiti.scenario.recording.ConnectorCallRecorder;
import io.github.kleash.activiti.scenario.recording.RecordingConnectorPostProcessor;
import io.github.kleash.activiti.scenario.recording.SequenceFlowRecorder;
import io.github.kleash.activiti.scenario.run.DecisionEvaluator;
import io.github.kleash.activiti.scenario.run.ScenarioEngine;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/**
 * Wires the scenario runner into a Spring Boot application that embeds Activiti: a host application only adds the
 * dependency.
 *
 * <ul>
 *   <li>a {@link RecordingConnectorPostProcessor} that wraps every {@code Connector} bean;</li>
 *   <li>a {@link SequenceFlowRecorder} registered as a global {@code SEQUENCEFLOW_TAKEN} listener;</li>
 *   <li>a {@link JobDriver} matching the async executor setting;</li>
 *   <li>a {@link ScenarioRunner}, which fails the application start unless history is {@code full} with database
 *       history on;</li>
 *   <li>a default {@code ExtendedInMemoryUserDetailsManager} when the application has no {@code UserDetailsService}.</li>
 * </ul>
 *
 * Switch off with {@code activiti.scenario.enabled=false}.
 */
@AutoConfiguration(
        beforeName = {
            "org.activiti.core.common.spring.identity.config.ActivitiSpringIdentityAutoConfiguration",
            "org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration"
        },
        afterName = "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration")
@ConditionalOnProperty(prefix = "activiti.scenario", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ScenarioRunnerProperties.class)
public class ScenarioRunnerAutoConfiguration {

    private static final String STANDARD_VALIDATOR_SET = "activiti-executable-process";

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    @ConditionalOnMissingBean
    public static ConnectorCallRecorder connectorCallRecorder() {
        return new ConnectorCallRecorder();
    }

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    public static RecordingConnectorPostProcessor recordingConnectorPostProcessor(ConnectorCallRecorder recorder) {
        return new RecordingConnectorPostProcessor(recorder);
    }

    @Bean
    @ConditionalOnMissingBean
    public SequenceFlowRecorder sequenceFlowRecorder() {
        return new SequenceFlowRecorder();
    }

    @Bean
    public ProcessEngineConfigurationConfigurer sequenceFlowRecorderConfigurer(SequenceFlowRecorder recorder) {
        return (SpringProcessEngineConfiguration configuration) -> {
            Map<String, List<ActivitiEventListener>> typed = configuration.getTypedEventListeners();
            if (typed == null) {
                typed = new HashMap<>();
            }
            typed.computeIfAbsent(ActivitiEventType.SEQUENCEFLOW_TAKEN.name(), k -> new ArrayList<>()).add(recorder);
            configuration.setTypedEventListeners(typed);
        };
    }

    /**
     * Keeps Activiti's standard process validation when the async executor is off. The Boot starter then installs a
     * {@code ProcessValidatorImpl} that holds <em>only</em> its async-property validator (it is created before the engine
     * would build the default one), so the standard rules (missing service task implementation, gateway rules, ...) never
     * run and invalid models deploy silently. Disable with {@code activiti.scenario.full-validation=false}.
     */
    @Bean
    @ConditionalOnProperty(prefix = "activiti.scenario", name = "full-validation", havingValue = "true", matchIfMissing = true)
    public ProcessEngineConfigurationConfigurer fullProcessValidationConfigurer() {
        return (SpringProcessEngineConfiguration configuration) -> {
            if (configuration.getProcessValidator() instanceof ProcessValidatorImpl validator
                    && validator.getValidatorSets().stream().noneMatch(set -> STANDARD_VALIDATOR_SET.equals(set.getName()))) {
                List<ValidatorSet> sets = new ArrayList<>(((ProcessValidatorImpl) new ProcessValidatorFactory().createDefaultProcessValidator()).getValidatorSets());
                sets.addAll(validator.getValidatorSets());
                validator.setValidatorSets(sets);
            }
        };
    }

    @Bean
    @ConditionalOnMissingBean(UserDetailsService.class)
    @ConditionalOnProperty(prefix = "activiti.scenario", name = "default-user-details-service", havingValue = "true", matchIfMissing = true)
    public ExtendedInMemoryUserDetailsManager scenarioUserDetailsManager() {
        return new ExtendedInMemoryUserDetailsManager();
    }

    @Bean
    @ConditionalOnMissingBean
    public JobDriver scenarioJobDriver(ScenarioRunnerProperties properties, ActivitiProperties activiti, ManagementService management,
                                       RuntimeService runtime, RepositoryService repository, ProcessEngineConfiguration configuration) {
        JobSupport support = new JobSupport(management, runtime, repository, configuration.getClock());
        ScenarioRunnerProperties.JobDriverMode mode = properties.getJobDriver();
        boolean executor = mode == ScenarioRunnerProperties.JobDriverMode.EXECUTOR
                || (mode == ScenarioRunnerProperties.JobDriverMode.AUTO && activiti.isAsyncExecutorActivate());
        return executor
                ? new ExecutorJobDriver(management, support, properties.getExecutorTimeout().toMillis())
                : new ManualJobDriver(management, support);
    }

    @Bean
    @ConditionalOnMissingBean
    public ScenarioLoader scenarioLoader() {
        return new ScenarioLoader();
    }

    @Bean
    @ConditionalOnMissingBean
    public ModelExpectChecker modelExpectChecker(RepositoryService repository, ObjectProvider<ProcessExtensionService> extensions) {
        return new ModelExpectChecker(repository, extensions.getIfAvailable());
    }

    @Bean
    @ConditionalOnMissingBean
    public ScenarioEngine scenarioEngine(ProcessRuntime processRuntime, TaskRuntime taskRuntime, RepositoryService repository,
                                         RuntimeService runtime, TaskService tasks, HistoryService history, ManagementService management,
                                         ProcessEngineConfiguration configuration, UserDetailsService users,
                                         ConnectorCallRecorder connectorCalls, SequenceFlowRecorder sequenceFlows, JobDriver jobDriver,
                                         ObjectProvider<DecisionEvaluator> decisions) {
        return new ScenarioEngine(processRuntime, taskRuntime, repository, runtime, tasks, history, management, configuration, users,
                connectorCalls, sequenceFlows, jobDriver, decisions.getIfAvailable());
    }

    @Bean
    @ConditionalOnMissingBean
    public ScenarioRunner scenarioRunner(ScenarioEngine engine, ScenarioRunnerProperties properties) {
        return new ScenarioRunner(engine, new ScenarioRunner.Options(properties.getExecutorTimeout().toMillis()));
    }
}
