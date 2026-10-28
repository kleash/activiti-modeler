package io.github.kleash.activiti.dmn.kie;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.activiti.engine.RepositoryService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import io.github.kleash.activiti.dmn.DmnConnectorAutoConfiguration;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.OperatonDmnEvaluator;

/** Engine selection by {@code activiti.dmn.engine}, with both engine modules on the classpath. */
class KieDmnAutoConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(KieDmnAutoConfiguration.class, DmnConnectorAutoConfiguration.class))
        .withBean(RepositoryService.class, () -> mock(RepositoryService.class));

    @Test
    void operatonIsTheDefaultEvenWhenKieIsOnTheClasspath() {
        runner.run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(DmnEvaluator.class);
            assertThat(context.getBean(DmnEvaluator.class)).isInstanceOf(OperatonDmnEvaluator.class);
        });
    }

    @Test
    void kieIsSelectedByProperty() {
        runner.withPropertyValues("activiti.dmn.engine=kie", "activiti.dmn.cache-size=4").run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(DmnEvaluator.class);
            assertThat(context.getBean(DmnEvaluator.class)).isInstanceOf(KieDmnEvaluator.class);
            assertThat(context).hasBean("dmn-connector.EXECUTE_TABLE");
        });
    }

    @Test
    void operatonCanBeSelectedExplicitly() {
        runner.withPropertyValues("activiti.dmn.engine=operaton").run(context ->
            assertThat(context.getBean(DmnEvaluator.class)).isInstanceOf(OperatonDmnEvaluator.class));
    }
}
