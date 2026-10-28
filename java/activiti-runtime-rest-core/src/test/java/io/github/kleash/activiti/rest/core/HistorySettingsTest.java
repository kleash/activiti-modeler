package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;

import io.github.kleash.activiti.rest.core.testapp.TestApplication;

/** The REST API refuses to start on an engine that does not keep full history in the database. */
class HistorySettingsTest {

    /** Command line arguments beat the test resources' application.properties; builder properties would lose against them. */
    private static String[] withArguments(String... properties) {
        java.util.List<String> args = new java.util.ArrayList<>(java.util.List.of("--server.port=0",
                "--spring.datasource.url=jdbc:h2:mem:rest-history-" + System.nanoTime(), "--spring.activiti.async-executor-activate=false"));
        for (String property : properties) {
            args.add("--" + property);
        }
        return args.toArray(String[]::new);
    }

    private static Throwable startWith(String... properties) {
        return org.assertj.core.api.Assertions.catchThrowable(() -> new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .run(withArguments(properties)).close());
    }

    @Test
    void historyLevelNoneFailsTheStartWithTheSettingsToChange() {
        Throwable failure = startWith("spring.activiti.history-level=none", "spring.activiti.db-history-used=false");

        assertThat(rootMessages(failure)).contains("history level 'none'").contains("spring.activiti.history-level=full").contains("spring.activiti.db-history-used=true");
    }

    @Test
    void fullHistoryThatIsNotWrittenToTheDatabaseFailsToo() {
        Throwable failure = startWith("spring.activiti.history-level=full", "spring.activiti.db-history-used=false");

        assertThat(rootMessages(failure)).contains("db-history-used=false");
    }

    @Test
    void aMissingRequirementIsNotSilentlyIgnored() {
        assertThatThrownBy(() -> HistorySettingsCheck.verify(new org.activiti.engine.impl.cfg.StandaloneInMemProcessEngineConfiguration()))
                .isInstanceOf(HistorySettingsCheck.InsufficientHistoryException.class);
    }

    private static String rootMessages(Throwable failure) {
        StringBuilder all = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) {
            all.append(t.getMessage()).append('\n');
        }
        return all.toString();
    }
}
