package io.github.kleash.activiti.rest.core;

import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.impl.history.HistoryLevel;
import org.springframework.beans.factory.InitializingBean;

/**
 * Fails the application start, with a message that names the properties to set, unless the engine keeps full history in the
 * database. The REST API reads the path of an instance, the data of ended instances and variable history from the history
 * tables; Activiti's defaults (history level {@code NONE}, no history tables) would give empty or wrong answers instead of an error.
 */
public final class HistorySettingsCheck implements InitializingBean {

    /** The message of the failure. */
    public static final String MESSAGE = """
            The runtime REST API needs full history in the database, but this engine has history level '%s' and db-history-used=%s. Set
              spring.activiti.history-level=full
              spring.activiti.db-history-used=true
            (Activiti defaults to history level NONE and does not even create the history tables when db-history-used is false.)""";

    /** Thrown when the engine does not keep full history in the database. */
    public static class InsufficientHistoryException extends IllegalStateException {

        public InsufficientHistoryException(String message) {
            super(message);
        }
    }

    private final ProcessEngineConfiguration configuration;

    public HistorySettingsCheck(ProcessEngineConfiguration configuration) {
        this.configuration = configuration;
    }

    @Override
    public void afterPropertiesSet() {
        verify(configuration);
    }

    /** @throws InsufficientHistoryException when history is not {@code full} with database history on */
    public static void verify(ProcessEngineConfiguration configuration) {
        HistoryLevel level = configuration.getHistoryLevel();
        if (level != HistoryLevel.FULL || !configuration.isDbHistoryUsed()) {
            throw new InsufficientHistoryException(MESSAGE.formatted(level == null ? "null" : level.getKey(), configuration.isDbHistoryUsed()));
        }
    }
}
