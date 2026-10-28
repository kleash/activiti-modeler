package io.github.kleash.activiti.scenario.run;

import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.impl.history.HistoryLevel;

/**
 * The engine settings the runner depends on (docs/adr/0005-scenario-format.md, "Required engine configuration"):
 * paths, ended-instance variables and child-instance assertions all read the history tables.
 */
public final class EngineSettings {

    public static final String MESSAGE = """
            The scenario runner needs full history in the database, but this engine has history level '%s' and \
            db-history-used=%s. Set
              spring.activiti.history-level=full
              spring.activiti.db-history-used=true
            (Activiti defaults to history level NONE and does not even create the history tables when db-history-used is false.)""";

    /** Thrown when the engine does not keep full history in the database. */
    public static class InsufficientHistoryException extends IllegalStateException {
        public InsufficientHistoryException(String message) {
            super(message);
        }
    }

    private EngineSettings() {
    }

    /** @throws InsufficientHistoryException with a message that names the properties to set, when history is not full. */
    public static void verify(ProcessEngineConfiguration configuration) {
        HistoryLevel level = configuration.getHistoryLevel();
        if (level != HistoryLevel.FULL || !configuration.isDbHistoryUsed()) {
            throw new InsufficientHistoryException(MESSAGE.formatted(level == null ? "null" : level.getKey(), configuration.isDbHistoryUsed()));
        }
    }
}
