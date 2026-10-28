package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/** Response of {@code GET /engine}. */
public final class EngineDtos {

    private EngineDtos() {
    }

    /**
     * What the embedded runtime is and what a model can rely on.
     *
     * @param activitiVersion  Activiti version (from the engine jar's Maven metadata; {@code ProcessEngine.VERSION} is stale)
     * @param springBootVersion Spring Boot version
     * @param javaVersion      the JVM
     * @param historyLevel     history level of the engine; the REST API requires {@code full}
     * @param dbHistoryUsed    whether history is written to the database; the REST API requires {@code true}
     * @param deploymentMode   {@code spring.activiti.deployment-mode}, {@code null} when it is not a Boot application
     * @param asyncExecutor    whether the async executor is configured to run and is running
     * @param dmn              the DMN support
     * @param connectors       names of the {@code Connector} beans, the values a service task's {@code implementation} can take
     * @param beans            names of the Spring beans an expression can reference ({@code ${name.method()}})
     * @param scriptEngines    the script languages a script task can use
     * @param basePath         the base path of this API
     */
    @Schema(requiredProperties = {"activitiVersion", "springBootVersion", "javaVersion", "dbHistoryUsed", "asyncExecutor", "dmn", "connectors", "beans", "scriptEngines", "basePath"})
    public record EngineInfo(
            String activitiVersion,
            String springBootVersion,
            String javaVersion,
            String historyLevel,
            boolean dbHistoryUsed,
            String deploymentMode,
            EngineAsyncExecutor asyncExecutor,
            EngineDmn dmn,
            List<String> connectors,
            List<String> beans,
            List<EngineScriptEngine> scriptEngines,
            String basePath) {
    }

    /**
     * @param configured {@code true} when the engine is configured to run the async executor
     * @param active     {@code true} when the executor is running now; without it asynchronous jobs and timers wait for someone to execute them
     */
    @Schema(requiredProperties = {"configured", "active"})
    public record EngineAsyncExecutor(boolean configured, boolean active) {
    }

    /**
     * @param available {@code true} when the DMN connector is on the class path
     * @param engine    the engine in use ({@code operaton}, {@code kie}), {@code null} when not available
     */
    @Schema(requiredProperties = {"available"})
    public record EngineDmn(boolean available, String engine) {
    }

    /**
     * @param name       engine name
     * @param languages  language names the engine answers to ({@code javascript}, {@code juel})
     * @param extensions file extensions
     */
    @Schema(requiredProperties = {"name", "languages", "extensions"})
    public record EngineScriptEngine(String name, List<String> languages, List<String> extensions) {
    }
}
