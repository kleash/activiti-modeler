package io.github.kleash.activiti.rest.dev.validate;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import org.activiti.engine.ProcessEngine;
import org.activiti.engine.impl.cfg.StandaloneInMemProcessEngineConfiguration;
import org.activiti.engine.impl.history.HistoryLevel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A throw-away process engine on an in-memory H2 database of its own, for trial deployments. It shares nothing with the running
 * engine: not the database, not the deployments, not the jobs, so a trial can neither collide with what is deployed nor leave
 * anything behind. {@link #close()} stops the engine and drops the database.
 *
 * <p>It is a plain Activiti engine with the default behaviour factory and the default process validators, so deployment-time
 * failures of the model itself (a {@code businessRuleTask}, a malformed element, a validator error) happen here exactly as
 * they do when the model is deployed for real. Beans, connectors and delegates are not needed to deploy, and they are not there.
 */
final class ScratchEngine implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(ScratchEngine.class);

    private final String url;
    private final ProcessEngine engine;

    ScratchEngine() {
        this.url = "jdbc:h2:mem:modeler-scratch-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1";
        StandaloneInMemProcessEngineConfiguration configuration = new StandaloneInMemProcessEngineConfiguration();
        configuration.setJdbcUrl(url);
        configuration.setJdbcDriver("org.h2.Driver");
        configuration.setJdbcUsername("sa");
        configuration.setJdbcPassword("");
        configuration.setDatabaseSchemaUpdate("true");
        configuration.setHistoryLevel(HistoryLevel.NONE);
        configuration.setAsyncExecutorActivate(false);
        this.engine = configuration.buildProcessEngine();
    }

    ProcessEngine engine() {
        return engine;
    }

    @Override
    public void close() {
        try {
            engine.close();
        } catch (RuntimeException e) {
            LOG.debug("Closing the scratch engine failed", e);
        }
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("SHUTDOWN");
        } catch (SQLException e) {
            LOG.debug("Dropping the scratch database failed", e);
        }
    }
}
