package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.Map;

import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.RepositoryService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class DmnConnectorAutoConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(DmnConnectorAutoConfiguration.class))
        .withBean(RepositoryService.class, () -> mock(RepositoryService.class));

    @Test
    void registersTheConnectorBeanTheEvaluatorAndTheServiceByDefault() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasBean("dmn-connector.EXECUTE_TABLE");
            assertThat(context.getBean("dmn-connector.EXECUTE_TABLE", Connector.class)).isInstanceOf(DmnConnector.class);
            assertThat(context.getBean(DmnEvaluator.class).engineName()).isEqualTo("operaton");
            assertThat(context).hasSingleBean(DmnEvaluationService.class).hasSingleBean(DmnDeploymentResolver.class);
        });
    }

    @Test
    void canBeSwitchedOff() {
        runner.withPropertyValues("activiti.dmn.enabled=false").run(context -> {
            assertThat(context).doesNotHaveBean("dmn-connector.EXECUTE_TABLE");
            assertThat(context).doesNotHaveBean(DmnEvaluator.class);
        });
    }

    @Test
    void operatonCanBeNamedExplicitly() {
        runner.withPropertyValues("activiti.dmn.engine=Operaton", "activiti.dmn.cache-size=3").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(DmnEvaluator.class)).isInstanceOf(OperatonDmnEvaluator.class);
            assertThat(context.getBean(DmnConnectorProperties.class).getCacheSize()).isEqualTo(3);
        });
    }

    @Test
    void anEngineThatIsNotOnTheClasspathFailsTheStartupWithAnExplanation() {
        runner.withPropertyValues("activiti.dmn.engine=kie").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(IllegalStateException.class)
                .hasMessageContaining("activiti.dmn.engine=kie is not available");
        });
    }

    @Test
    void anApplicationEvaluatorReplacesTheDefault() {
        DmnEvaluator custom = new DmnEvaluator() {
            @Override
            public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                throw new UnsupportedOperationException();
            }

            @Override
            public String engineName() {
                return "custom";
            }
        };

        runner.withBean(DmnEvaluator.class, () -> custom).run(context -> assertThat(context.getBean(DmnEvaluator.class)).isSameAs(custom));
    }

    @Test
    void anApplicationConnectorWithTheSameNameWins() {
        Connector mine = integrationContext -> integrationContext;

        runner.withBean("dmn-connector.EXECUTE_TABLE", Connector.class, () -> mine)
            .run(context -> assertThat(context.getBean("dmn-connector.EXECUTE_TABLE")).isSameAs(mine));
    }
}
