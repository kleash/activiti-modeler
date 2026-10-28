package io.github.kleash.activiti.dmn;

import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.RepositoryService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the decision task support in a Spring Boot application with embedded Activiti 9:
 * <ul>
 *   <li>the {@link Connector} bean named {@value DmnConnector#IMPLEMENTATION};</li>
 *   <li>a {@link DmnEvaluationService} for direct evaluation (REST, scenario runner, tests);</li>
 *   <li>a {@link ScenarioDecisionEvaluator} (the scenario runner's {@code DecisionEvaluator}) when the scenario runner is
 *       on the classpath;</li>
 *   <li>a {@link DmnEvaluator}: Operaton by default, KIE when {@code activiti.dmn.engine=kie} and the module
 *       {@code activiti-dmn-connector-kie} is on the classpath. Define your own {@link DmnEvaluator} bean to replace it.</li>
 * </ul>
 */
@AutoConfiguration(afterName = "org.activiti.spring.boot.ProcessEngineAutoConfiguration")
@ConditionalOnClass({Connector.class, RepositoryService.class})
@ConditionalOnProperty(prefix = "activiti.dmn", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(DmnConnectorProperties.class)
public class DmnConnectorAutoConfiguration {

    /**
     * The default evaluator. Skipped when another auto-configuration (the KIE module) or the application supplies one.
     *
     * @param properties the {@code activiti.dmn} properties
     * @return the Operaton evaluator
     * @throws IllegalStateException when {@code activiti.dmn.engine} names an engine that is not on the classpath
     */
    @Bean
    @ConditionalOnMissingBean(DmnEvaluator.class)
    public DmnEvaluator dmnEvaluator(DmnConnectorProperties properties) {
        if (OperatonDmnEvaluator.NAME.equalsIgnoreCase(properties.getEngine())) {
            return new OperatonDmnEvaluator(properties.getCacheSize());
        }
        throw new IllegalStateException("activiti.dmn.engine=" + properties.getEngine() + " is not available: supported "
            + "values are 'operaton' and, with the module activiti-dmn-connector-kie on the classpath, 'kie'");
    }

    /**
     * @param repositoryService the Activiti repository service
     * @param properties        the {@code activiti.dmn} properties
     * @return the resolver of decision references
     */
    @Bean
    @ConditionalOnMissingBean
    public DmnDeploymentResolver dmnDeploymentResolver(RepositoryService repositoryService, DmnConnectorProperties properties) {
        return new DmnDeploymentResolver(repositoryService, properties.getCacheSize());
    }

    /**
     * @param evaluator the engine
     * @param resolver  the reference resolver
     * @return the direct evaluation service
     */
    @Bean
    @ConditionalOnMissingBean
    public DmnEvaluationService dmnEvaluationService(DmnEvaluator evaluator, DmnDeploymentResolver resolver) {
        return new DmnEvaluationService(evaluator, resolver);
    }

    /**
     * The connector bean. Its name is what a service task's {@code implementation} attribute must equal.
     * It is declared as a plain {@link Connector} so that wrapping post-processors (for example the scenario
     * runner's recording wrapper) can replace it.
     *
     * @param service           the evaluation service
     * @param repositoryService the Activiti repository service
     * @param properties        the {@code activiti.dmn} properties
     * @return the connector
     */
    @Bean(name = DmnConnector.IMPLEMENTATION)
    @ConditionalOnMissingBean(name = DmnConnector.IMPLEMENTATION)
    public Connector dmnConnector(DmnEvaluationService service, RepositoryService repositoryService,
                                  DmnConnectorProperties properties) {
        return new DmnConnector(service, repositoryService, properties.getCacheSize());
    }

    /**
     * The scenario runner's decision port. A separate nested configuration so that the runner is an optional dependency:
     * without it on the classpath this class is never loaded.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = "io.github.kleash.activiti.scenario.run.DecisionEvaluator")
    static class ScenarioRunnerDecisions {

        /**
         * @param service           the direct evaluation service
         * @param repositoryService the Activiti repository service
         * @return the adapter used by the {@code decisions} section of scenario files
         */
        @Bean
        @ConditionalOnMissingBean(io.github.kleash.activiti.scenario.run.DecisionEvaluator.class)
        public ScenarioDecisionEvaluator scenarioDecisionEvaluator(DmnEvaluationService service, RepositoryService repositoryService) {
            return new ScenarioDecisionEvaluator(service, repositoryService);
        }
    }
}
