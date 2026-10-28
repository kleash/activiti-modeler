package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.impl.history.HistoryLevel;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import io.github.kleash.activiti.scenario.run.EngineSettings;
import io.github.kleash.activiti.scenario.run.ScenarioEngine;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;
import io.github.kleash.activiti.scenario.testapp.TestApplication;

/** The runner refuses to start on an engine that does not keep full history in the database. */
class EngineSettingsTest {

    private static ProcessEngineConfiguration configuration(HistoryLevel level, boolean dbHistory) {
        ProcessEngineConfiguration configuration = mock(ProcessEngineConfiguration.class);
        when(configuration.getHistoryLevel()).thenReturn(level);
        when(configuration.isDbHistoryUsed()).thenReturn(dbHistory);
        return configuration;
    }

    @Test
    void fullHistoryInTheDatabaseIsAccepted() {
        EngineSettings.verify(configuration(HistoryLevel.FULL, true));
    }

    @Test
    void otherHistoryLevelsAreRejectedWithTheExactPropertiesToSet() {
        assertThatThrownBy(() -> EngineSettings.verify(configuration(HistoryLevel.AUDIT, true)))
                .isInstanceOf(EngineSettings.InsufficientHistoryException.class)
                .hasMessageContaining("history level 'audit' and db-history-used=true")
                .hasMessageContaining("spring.activiti.history-level=full")
                .hasMessageContaining("spring.activiti.db-history-used=true");
        assertThatThrownBy(() -> EngineSettings.verify(configuration(HistoryLevel.NONE, false)))
                .hasMessageContaining("history level 'none' and db-history-used=false");
    }

    @Test
    void databaseHistoryMustBeOnToo() {
        assertThatThrownBy(() -> EngineSettings.verify(configuration(HistoryLevel.FULL, false)))
                .isInstanceOf(EngineSettings.InsufficientHistoryException.class)
                .hasMessageContaining("history level 'full' and db-history-used=false");
    }

    @Test
    void theRunnerConstructorChecksToo() {
        ScenarioEngine engine = new ScenarioEngine(null, null, null, null, null, null, null, configuration(HistoryLevel.ACTIVITY, true),
                null, null, null, null, null);
        assertThatThrownBy(() -> new ScenarioRunner(engine)).isInstanceOf(EngineSettings.InsufficientHistoryException.class);
    }

    @Test
    void anApplicationWithoutFullHistoryFailsToStartWithAClearMessage() {
        SpringApplication application = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.NONE)
                .build();
        // command line arguments outrank the application.properties of the test classpath
        String[] arguments = {"--spring.datasource.url=jdbc:h2:mem:runner-nohistory;DB_CLOSE_DELAY=-1",
                "--spring.activiti.history-level=none", "--spring.activiti.db-history-used=false",
                "--spring.activiti.check-process-definitions=false"};
        assertThatThrownBy(() -> {
            try (ConfigurableApplicationContext ignored = application.run(arguments)) {
                throw new AssertionError("the context must not start");
            }
        }).hasStackTraceContaining("spring.activiti.history-level=full").hasStackTraceContaining("spring.activiti.db-history-used=true");
        assertThat(EngineSettings.MESSAGE).contains("Activiti defaults to history level NONE");
    }
}
