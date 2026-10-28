package io.github.kleash.activiti.rest.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.api.runtime.shared.security.SecurityManager;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.ManagementService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.TaskService;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.runtime.api.impl.ProcessVariablesPayloadValidator;
import org.activiti.spring.SpringProcessEngineConfiguration;
import org.activiti.spring.boot.ActivitiProperties;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.rest.core.error.ProblemMapping;
import io.github.kleash.activiti.rest.core.error.ProblemWriter;
import io.github.kleash.activiti.rest.core.error.RestExceptionHandler;
import io.github.kleash.activiti.rest.core.error.StrictRequestBodyAdvice;
import io.github.kleash.activiti.rest.core.security.AccessInterceptor;
import io.github.kleash.activiti.rest.core.security.AccessPolicy;
import io.github.kleash.activiti.rest.core.security.AuthenticationBridgeFilter;
import io.github.kleash.activiti.rest.core.service.DecisionCatalog;
import io.github.kleash.activiti.rest.core.service.DefinitionService;
import io.github.kleash.activiti.rest.core.service.DmnDecisionCatalog;
import io.github.kleash.activiti.rest.core.service.EngineInfoService;
import io.github.kleash.activiti.rest.core.service.InstanceService;
import io.github.kleash.activiti.rest.core.service.JobService;
import io.github.kleash.activiti.rest.core.service.SequenceFlowTracker;
import io.github.kleash.activiti.rest.core.service.TaskViews;
import io.github.kleash.activiti.rest.core.web.DeploymentController;
import io.github.kleash.activiti.rest.core.web.EngineController;
import io.github.kleash.activiti.rest.core.web.EventController;
import io.github.kleash.activiti.rest.core.web.JobController;
import io.github.kleash.activiti.rest.core.web.ProcessDefinitionController;
import io.github.kleash.activiti.rest.core.web.ProcessInstanceController;
import io.github.kleash.activiti.rest.core.web.TaskController;
import jakarta.servlet.DispatcherType;

/**
 * Adds the core runtime REST API to a Spring Boot web application that embeds Activiti 9 (docs/adr/0007-runtime-rest-split-and-security.md).
 *
 * <p>What it contributes: the controllers under {@code activiti.rest.base-path} (default {@code /api}), the error model, an interceptor
 * that enforces the access levels {@code activiti.rest.roles.read|operate|admin}, a filter that bridges the Spring Security principal to
 * Activiti's {@code Authentication} thread-local, a recorder of taken sequence flows and a startup check for the history settings.
 * What it never contributes: a {@code SecurityFilterChain}. Authentication, sessions, CSRF and CORS are the host application's.
 *
 * <p>Switch off with {@code activiti.rest.enabled=false}.
 */
@AutoConfiguration(afterName = {
    "org.activiti.spring.boot.ProcessEngineAutoConfiguration",
    "org.activiti.runtime.api.conf.ProcessRuntimeAutoConfiguration",
    "org.activiti.runtime.api.conf.TaskRuntimeAutoConfiguration",
    "io.github.kleash.activiti.dmn.DmnConnectorAutoConfiguration"
})
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass({ProcessRuntime.class, TaskRuntime.class})
@ConditionalOnProperty(prefix = "activiti.rest", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(RestCoreProperties.class)
@Import({
    EngineController.class,
    DeploymentController.class,
    ProcessDefinitionController.class,
    ProcessInstanceController.class,
    TaskController.class,
    EventController.class,
    JobController.class
})
public class RestCoreAutoConfiguration {

    // ---- startup check and recorder --------------------------------------------------------------------------------------

    @Bean
    public static HistorySettingsCheck historySettingsCheck(ProcessEngineConfiguration configuration) {
        return new HistorySettingsCheck(configuration);
    }

    @Bean
    @ConditionalOnMissingBean
    public SequenceFlowTracker sequenceFlowTracker(RestCoreProperties properties) {
        return new SequenceFlowTracker(properties.getSequenceFlows().getMaxInstances(), properties.getSequenceFlows().getMaxFlowsPerInstance());
    }

    @Bean
    public ProcessEngineConfigurationConfigurer sequenceFlowTrackerConfigurer(SequenceFlowTracker tracker) {
        return (SpringProcessEngineConfiguration configuration) -> {
            Map<String, List<ActivitiEventListener>> typed = configuration.getTypedEventListeners();
            if (typed == null) {
                typed = new HashMap<>();
            }
            typed.computeIfAbsent(ActivitiEventType.SEQUENCEFLOW_TAKEN.name(), k -> new ArrayList<>()).add(tracker);
            configuration.setTypedEventListeners(typed);
        };
    }

    // ---- security and errors ---------------------------------------------------------------------------------------------

    @Bean
    @ConditionalOnMissingBean
    public AccessPolicy restAccessPolicy(RestCoreProperties properties) {
        return new AccessPolicy(properties);
    }

    @Bean
    @ConditionalOnMissingBean
    public ProblemWriter restProblemWriter(ObjectProvider<ObjectMapper> mapper) {
        return new ProblemWriter(mapper::getObject);
    }

    @Bean
    public StrictRequestBodyAdvice restStrictRequestBodyAdvice(ObjectProvider<ObjectMapper> mapper) {
        return new StrictRequestBodyAdvice(mapper::getObject);
    }

    @Bean
    public RestExceptionHandler restExceptionHandler(ObjectProvider<ProblemMapping> mappings) {
        return new RestExceptionHandler(mappings.orderedStream().toList());
    }

    @Bean
    public WebMvcConfigurer restAccessConfigurer(AccessPolicy policy, ProblemWriter problems) {
        AccessInterceptor interceptor = new AccessInterceptor(policy, problems);
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(interceptor).addPathPatterns("/**");
            }
        };
    }

    /** Sets and clears Activiti's thread-local user for every request under the base path; runs after the host's security filters. */
    @Bean
    public FilterRegistrationBean<AuthenticationBridgeFilter> restAuthenticationBridge(RestCoreProperties properties) {
        FilterRegistrationBean<AuthenticationBridgeFilter> registration = new FilterRegistrationBean<>(new AuthenticationBridgeFilter());
        String base = properties.getBasePath().replaceAll("/+$", "");
        registration.addUrlPatterns(base + "/*");
        registration.setDispatcherTypes(DispatcherType.REQUEST);
        registration.setOrder(Ordered.LOWEST_PRECEDENCE - 100);
        registration.setName("activitiRestAuthenticationBridge");
        return registration;
    }

    // ---- services ----------------------------------------------------------------------------------------------------------

    @Bean
    @ConditionalOnMissingBean(DecisionCatalog.class)
    public DecisionCatalog restDecisionCatalog() {
        return DecisionCatalog.NONE;
    }

    @Bean
    public EngineInfoService restEngineInfoService(ProcessEngineConfiguration configuration, ConfigurableApplicationContext context,
                                                   ObjectProvider<ActivitiProperties> activitiProperties, RestCoreProperties properties,
                                                   DecisionCatalog decisions) {
        return new EngineInfoService(configuration, context, activitiProperties, properties, decisions);
    }

    @Bean
    public DefinitionService restDefinitionService(RepositoryService repository, RuntimeService runtime, ObjectMapper mapper, DecisionCatalog decisions) {
        return new DefinitionService(repository, runtime, mapper, decisions);
    }

    @Bean
    public TaskViews restTaskViews(TaskService taskService, SecurityManager security, ObjectMapper mapper) {
        return new TaskViews(taskService, security, mapper);
    }

    @Bean
    public JobService restJobService(ManagementService management, RuntimeService runtime) {
        return new JobService(management, runtime);
    }

    @Bean
    public InstanceService restInstanceService(ProcessRuntime processRuntime, RuntimeService runtime, HistoryService history, RepositoryService repository,
                                               TaskViews tasks, JobService jobs, SequenceFlowTracker flows,
                                               ObjectProvider<ProcessVariablesPayloadValidator> validator, ObjectMapper mapper) {
        return new InstanceService(processRuntime, runtime, history, repository, tasks, jobs, flows, validator, mapper);
    }

    /** The DMN decisions of a deployment, when the DMN connector is on the class path. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(DmnEvaluator.class)
    static class DmnCatalogConfiguration {

        @Bean
        @ConditionalOnBean(DmnEvaluator.class)
        public DecisionCatalog restDmnDecisionCatalog(RepositoryService repository, DmnEvaluator evaluator) {
            return new DmnDecisionCatalog(repository, evaluator);
        }
    }
}
