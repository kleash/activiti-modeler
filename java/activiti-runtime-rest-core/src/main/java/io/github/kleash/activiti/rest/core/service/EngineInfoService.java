package io.github.kleash.activiti.rest.core.service;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;

import javax.script.ScriptEngineFactory;
import javax.script.ScriptEngineManager;

import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.ProcessEngine;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.impl.history.HistoryLevel;
import org.activiti.spring.boot.ActivitiProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.boot.SpringBootVersion;
import org.springframework.context.ConfigurableApplicationContext;

import io.github.kleash.activiti.rest.core.RestCoreProperties;
import io.github.kleash.activiti.rest.core.dto.EngineDtos;

/** Builds the answer of {@code GET /engine}. */
public class EngineInfoService {

    private static final String ENGINE_POM_PROPERTIES = "/META-INF/maven/org.activiti/activiti-engine/pom.properties";
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*");

    private final ProcessEngineConfiguration configuration;
    private final ConfigurableApplicationContext context;
    private final ObjectProvider<ActivitiProperties> activitiProperties;
    private final RestCoreProperties properties;
    private final DecisionCatalog decisions;

    public EngineInfoService(ProcessEngineConfiguration configuration, ConfigurableApplicationContext context,
                             ObjectProvider<ActivitiProperties> activitiProperties, RestCoreProperties properties, DecisionCatalog decisions) {
        this.configuration = configuration;
        this.context = context;
        this.activitiProperties = activitiProperties;
        this.properties = properties;
        this.decisions = decisions;
    }

    /** @return versions, history level, async executor state, DMN engine, connectors, beans and script engines */
    public EngineDtos.EngineInfo info() {
        HistoryLevel level = configuration.getHistoryLevel();
        ActivitiProperties boot = activitiProperties.getIfAvailable();
        boolean executorActive = configuration.getAsyncExecutor() != null && configuration.getAsyncExecutor().isActive();
        return new EngineDtos.EngineInfo(
                activitiVersion(),
                SpringBootVersion.getVersion(),
                Runtime.version().toString(),
                level == null ? null : level.getKey(),
                configuration.isDbHistoryUsed(),
                boot == null ? null : boot.getDeploymentMode(),
                new EngineDtos.EngineAsyncExecutor(configuration.isAsyncExecutorActivate(), executorActive),
                decisions.engine(),
                connectorNames(),
                properties.isExposeBeanNames() ? juelBeanNames() : List.of(),
                scriptEngines(),
                properties.getBasePath());
    }

    /**
     * {@code ProcessEngine.VERSION} cannot be used: it is a stale constant (it still reads 8.1.4 in 9.0.0), so the version
     * comes from the engine jar's Maven metadata.
     */
    static String activitiVersion() {
        try (InputStream in = ProcessEngine.class.getResourceAsStream(ENGINE_POM_PROPERTIES)) {
            if (in == null) {
                return "unknown";
            }
            Properties props = new Properties();
            props.load(in);
            return props.getProperty("version", "unknown");
        } catch (IOException e) {
            return "unknown";
        }
    }

    private List<String> connectorNames() {
        return java.util.Arrays.stream(context.getBeanFactory().getBeanNamesForType(Connector.class, true, false)).sorted().toList();
    }

    /** Beans an expression can name: application beans with a plain identifier as name ({@code greeter}, not {@code echo.EXECUTE}). */
    private List<String> juelBeanNames() {
        ConfigurableListableBeanFactory factory = context.getBeanFactory();
        List<String> names = new ArrayList<>();
        for (String name : factory.getBeanDefinitionNames()) {
            if (!IDENTIFIER.matcher(name).matches()) {
                continue;
            }
            BeanDefinition definition = factory.getBeanDefinition(name);
            if (definition.getRole() != BeanDefinition.ROLE_APPLICATION) {
                continue;
            }
            names.add(name);
        }
        names.sort(String::compareTo);
        return names;
    }

    private static List<EngineDtos.EngineScriptEngine> scriptEngines() {
        List<EngineDtos.EngineScriptEngine> engines = new ArrayList<>();
        engines.add(new EngineDtos.EngineScriptEngine("Activiti JUEL", List.of("juel"), List.of()));
        Set<String> seen = new LinkedHashSet<>();
        for (ScriptEngineFactory factory : new ScriptEngineManager().getEngineFactories()) {
            if (seen.add(factory.getEngineName() + "/" + factory.getEngineVersion())) {
                engines.add(new EngineDtos.EngineScriptEngine(factory.getEngineName() + " " + factory.getEngineVersion(),
                        List.copyOf(factory.getNames()), List.copyOf(factory.getExtensions())));
            }
        }
        return engines;
    }
}
